import {
  describeElement,
  nativeContainmentIssues,
  type ContainmentIssue,
} from "./containment.js";
import {
  eulerFromQuaternion,
  nativePanelTransform,
  occlusionClipPath,
  planeVisibility,
  surfaceQuad,
  viewportClipPath,
  viewportPanelTransform,
  type CameraFrame,
  type Occluder,
  type Quaternion,
  type SpatialWebSurfacePose,
  type SurfaceResolution,
  type Vec3,
} from "./projection.js";

/** Where a natively extracted element is in the world, read every frame. */
export interface NativePlacement {
  /** Center, in meters. */
  readonly position: Vec3;
  readonly rotation: Quaternion;
  /** Uniform spatial scale (the CSS layout size never changes). */
  readonly scale: number;
  /** World meters per CSS pixel at scale 1. */
  readonly metersPerPixel: number;
}

/** A natively extracted element to composite. */
export interface NativeTarget {
  /** The registered item it presents. */
  readonly id: string;
  /**
   * The original element, as `controller.nativeElement(id)` returns it
   * (`position: fixed; left: 0; top: 0; transform-origin: 0 0`).
   */
  readonly element: HTMLElement;
  /** Its pose; `undefined` keeps it hidden. */
  placement(): NativePlacement | undefined;
}

/**
 * A transformed page that contains the native elements (the XR Lab's
 * spatial web surface): its pose is cancelled by the element transform.
 * Without one, the viewport must be the elements' containing block.
 */
export interface ContainingSurface {
  readonly element: HTMLElement;
  readonly pose: SpatialWebSurfacePose;
  readonly resolution: SurfaceResolution;
  /** The page's border width, in CSS pixels. */
  readonly border: number;
}

export interface CompositeOptions {
  readonly surface?: ContainingSurface;
  /** Renderer-drawn rectangles that cut native elements behind them. */
  readonly occluders?: readonly Occluder[];
}

/** Natively extracted ids that cannot be composited, with the reasons. */
export type NativeIssues = ReadonlyMap<string, readonly ContainmentIssue[]>;

/**
 * Inline properties the compositor owns on a native element. Visibility is
 * the `data-spatial-visibility` attribute instead (styled by a rule this
 * module adds once), so the inline `visibility` that React owns is never
 * written or removed here.
 */
const PROPERTIES = ["transform", "clip-path"] as const;
type Property = (typeof PROPERTIES)[number];

interface Written {
  transform: string;
  clip: string;
  visibility: string;
  pose: string;
  /** Inline values as last written (browser-serialized), per property. */
  owned: Map<Property, string>;
  issues: readonly ContainmentIssue[] | null;
  capturedBy: Element | null;
}

const newWritten = (): Written => ({
  transform: "",
  clip: "",
  visibility: "",
  pose: "",
  owned: new Map(),
  issues: null,
  capturedBy: null,
});

const STYLE_ID = "spatialflex-native-visibility";
/** The rules behind `data-spatial-visibility`, added to the document once. */
function ensureStyles(document: Document) {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    '[data-spatial-visibility="hidden"]{visibility:hidden}' +
    '[data-spatial-visibility="visible"]{visibility:visible}';
  document.head.append(style);
}

function write(
  element: HTMLElement,
  written: Written,
  property: Property,
  value: string,
) {
  element.style.setProperty(property, value);
  written.owned.set(property, element.style.getPropertyValue(property));
}

/** Removes exactly what the compositor owns, and only while it still does. */
function release(element: HTMLElement, written: Written | undefined) {
  for (const property of PROPERTIES) {
    const value = written?.owned.get(property);
    if (
      value !== undefined &&
      element.style.getPropertyValue(property) === value
    )
      element.style.removeProperty(property);
  }
  delete element.dataset.spatialPlaced;
  delete element.dataset.spatialPose;
  delete element.dataset.spatialVisibility;
  delete element.dataset.spatialIssue;
}

/**
 * Places natively extracted elements (the original, still React-owned DOM
 * nodes) at world poses with CSS 3D transforms, once per rendered frame.
 * It owns presentation only: the element's `transform`, `clip-path`, its
 * `data-spatial-*` attributes and nothing else. Elements are never moved,
 * cloned or re-rendered.
 *
 * Elements whose ancestors break containment (see `containment.ts`) are
 * not composited: they are hidden (so they take no input at a wrong
 * position), marked `data-spatial-issue` and reported through `onIssues`.
 * The browser's own containing block (`offsetParent`) is checked every
 * frame; ancestor styles when compositing starts.
 */
export class NativeCompositor {
  readonly #written = new Map<HTMLElement, Written>();
  #targets: readonly NativeTarget[] = [];
  #issueKey = "[]";
  #issues: NativeIssues = new Map();
  readonly #onIssues: ((issues: NativeIssues) => void) | undefined;

  constructor(options: { onIssues?: (issues: NativeIssues) => void } = {}) {
    this.#onIssues = options.onIssues;
  }

  /** Current issues (also reported through `onIssues` when they change). */
  get issues(): NativeIssues {
    return this.#issues;
  }

  /**
   * The elements to composite. Elements no longer listed (restored,
   * unmounted or replaced) are released at once; new ones stay hidden until
   * the first composited frame. Call it before paint (a layout effect) when
   * the set changes; calling it every frame is cheap.
   */
  setTargets(targets: readonly NativeTarget[]) {
    this.#targets = targets;
    const current = new Set(targets.map((t) => t.element));
    for (const [element, written] of [...this.#written])
      if (!current.has(element)) {
        release(element, written);
        this.#written.delete(element);
      }
    for (const { element } of targets)
      if (!this.#written.has(element)) {
        ensureStyles(element.ownerDocument);
        const written = newWritten();
        written.visibility = "hidden";
        element.dataset.spatialVisibility = "hidden";
        this.#written.set(element, written);
      }
  }

  /**
   * Composites every target for a rendered camera frame. Returns, with a
   * containing surface, the elements' footprints in its pixels (for the
   * surface's own clip, which clips descendants too).
   */
  composite(
    frame: CameraFrame,
    { surface, occluders = [] }: CompositeOptions = {},
  ): { keep: [number, number][][] } {
    const keep: [number, number][][] = [];
    const frameIssues: [string, readonly ContainmentIssue[]][] = [];
    const surfaceVisibility = surface
      ? planeVisibility(frame, surface.pose, surface.resolution)
      : "visible";
    // The containing block the placement math assumes.
    const expected = surface?.element ?? null;
    for (const target of this.#targets) {
      const { id, element } = target;
      const written = this.#written.get(element);
      if (!written) continue;
      const w = element.offsetWidth;
      const h = element.offsetHeight;
      written.issues ??= nativeContainmentIssues(
        element.parentElement,
        expected,
      );
      const containingBlock = element.offsetParent;
      if (containingBlock !== expected && containingBlock !== null) {
        if (written.capturedBy !== containingBlock) {
          written.capturedBy = containingBlock;
          const found = nativeContainmentIssues(
            element.parentElement,
            expected,
          );
          written.issues = found.some((i) => i.effect === "containing-block")
            ? found
            : [
                ...found,
                {
                  element: describeElement(containingBlock),
                  property: "containing block",
                  value: "established by an ancestor style",
                  effect: "containing-block",
                },
              ];
        }
      } else if (written.capturedBy) {
        written.capturedBy = null;
        written.issues = nativeContainmentIssues(
          element.parentElement,
          expected,
        );
      }
      const issues = written.issues;
      if (issues.length > 0) {
        frameIssues.push([id, issues]);
        element.dataset.spatialIssue = issues[0]!.effect;
        delete element.dataset.spatialPlaced;
        delete element.dataset.spatialPose;
        written.pose = "";
      } else delete element.dataset.spatialIssue;

      const placement = target.placement();
      const panelPose: SpatialWebSurfacePose | null = placement
        ? {
            position: placement.position,
            rotation: eulerFromQuaternion(placement.rotation),
            width: w * placement.metersPerPixel * placement.scale,
            height: h * placement.metersPerPixel * placement.scale,
          }
        : null;
      const composable =
        issues.length === 0 &&
        panelPose !== null &&
        w > 0 &&
        h > 0 &&
        surfaceVisibility !== "behind";
      const resolution = { width: w, height: h };
      let shown = false;
      if (composable && surface) {
        const placed = nativePanelTransform(
          frame,
          {
            pose: surface.pose,
            resolution: surface.resolution,
            border: surface.border,
          },
          { pose: panelPose, resolution },
        );
        if (placed.visibility === "visible") {
          shown = true;
          this.#place(element, written, placed.matrix3d);
          // A panel behind the page plane is covered by the page.
          this.#clip(
            element,
            written,
            occlusionClipPath(
              frame,
              panelPose,
              resolution,
              placed.behindPage
                ? [...occluders, surfaceQuad(surface.pose, surface.resolution)]
                : occluders,
            ),
          );
          if (!placed.behindPage) keep.push(placed.pageQuad);
        }
      } else if (composable) {
        const placed = viewportPanelTransform(frame, {
          pose: panelPose,
          resolution,
        });
        if (placed.visibility === "visible") {
          shown = true;
          this.#place(element, written, placed.matrix3d);
          this.#clip(
            element,
            written,
            viewportClipPath(frame, panelPose, resolution, occluders),
          );
        }
      }
      if (shown) {
        const poseKey = JSON.stringify({ ...panelPose, resolution });
        if (poseKey !== written.pose) {
          element.dataset.spatialPose = poseKey;
          element.dataset.spatialPlaced = "";
          written.pose = poseKey;
        }
      }
      const visibility = shown ? "visible" : "hidden";
      if (visibility !== written.visibility) {
        // Explicit: a hidden ancestor (a page seen from behind) must not
        // hide an element that is visible on its own.
        element.dataset.spatialVisibility = visibility;
        written.visibility = visibility;
      }
    }
    const issueKey = JSON.stringify(frameIssues);
    if (issueKey !== this.#issueKey) {
      this.#issueKey = issueKey;
      this.#issues = new Map(frameIssues);
      this.#onIssues?.(this.#issues);
    }
    return { keep };
  }

  /** Releases every element (unmount, compositor no longer active). */
  dispose() {
    for (const [element, written] of this.#written) release(element, written);
    this.#written.clear();
    this.#targets = [];
    if (this.#issueKey !== "[]") {
      this.#issueKey = "[]";
      this.#issues = new Map();
      this.#onIssues?.(this.#issues);
    }
  }

  #place(element: HTMLElement, written: Written, matrix: string) {
    if (matrix !== written.transform) {
      write(element, written, "transform", matrix);
      written.transform = matrix;
    }
  }

  #clip(element: HTMLElement, written: Written, clip: string) {
    if (clip !== written.clip) {
      write(element, written, "clip-path", clip);
      written.clip = clip;
    }
  }
}
