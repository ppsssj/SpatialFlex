import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  HANDLED_PANEL_BOUNDS,
  PANEL_SIZE,
  type HostCameraFrame,
  type HostPanel,
  type HostRay,
  type Quat,
  type Vec3,
} from "../contracts/xrHost";
import { DEFAULT_SURFACE_POSE, SURFACE_RESOLUTION } from "./surfaceConfig";
import {
  eulerFromQuaternion,
  nativePanelTransform,
  occlusionClipPath,
  pageClipPath,
  planeVisibility,
  surfaceMatrix,
  surfaceQuad,
  transformedQuad,
  viewportRay,
  type Occluder,
  type SpatialWebSurfacePose,
  type SurfaceVisibility,
} from "./surfaceMath";

export type SurfaceStatus = "waiting" | SurfaceVisibility;

/** World anchor of a natively extracted element; its size follows its layout. */
export interface NativeAnchor {
  readonly position: Vec3;
  readonly rotation: Vec3;
  /** World meters per CSS pixel (the surface's scale at extraction). */
  readonly metersPerPixel: number;
}

/** Resolves a natively extracted id to its original element. */
export type NativeResolver = (id: string) => HTMLElement | null;

/**
 * Manipulated pose of an item's presentation (Native DOM element or XR
 * panel), read every frame: poses change without React renders.
 */
export type PoseResolver = (
  id: string,
) =>
  | { readonly position: Vec3; readonly rotation: Quat; readonly scale: number }
  | undefined;

const noPose: PoseResolver = () => undefined;

interface Written {
  transform: string;
  clip: string;
  visibility: string;
  pose: string;
  /**
   * Inline values as the compositor last left them (serialized by the
   * browser), per owned property: release removes a property only while it
   * still holds that value, so a value that another owner set in the
   * meantime is kept.
   */
  owned: Map<NativeProperty, string>;
}

/**
 * Inline properties the compositor owns on a native element. Visibility is
 * not one of them: it is the `data-spatial-visibility` attribute (styled by
 * the surface's stylesheet), so the compositor never writes or removes the
 * inline `visibility` that React owns, such as the SDK's reserved-source
 * `visibility: hidden`, committed in the same React commit that ends a
 * native extraction.
 */
const NATIVE_PROPERTIES = ["transform", "clip-path"] as const;
type NativeProperty = (typeof NATIVE_PROPERTIES)[number];

const newWritten = (): Written => ({
  transform: "",
  clip: "",
  visibility: "",
  pose: "",
  owned: new Map(),
});

function write(
  element: HTMLElement,
  written: Written,
  property: NativeProperty,
  value: string,
) {
  element.style.setProperty(property, value);
  written.owned.set(property, element.style.getPropertyValue(property));
}

function release(element: HTMLElement, written: Written | undefined) {
  for (const property of NATIVE_PROPERTIES) {
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
}

/**
 * The DOM compositor of the spatial web surface. It owns presentation only:
 * camera alignment (per-frame CSS transforms written directly to elements,
 * without React renders), occlusion clipping and pointer routing.
 *
 * It composites the page and, for Native DOM extraction, the original
 * elements that the SpatialFlex controller placed externally. Those stay
 * where React rendered them (inside the page); only their transform, clip
 * and visibility are written here, and removed again on restore. Nothing is
 * moved, cloned or remounted.
 */
export function useSurfaceCompositor(
  active: boolean,
  panels: readonly HostPanel[],
  nativeIds: readonly string[],
  resolveNative: NativeResolver,
  poseOf: PoseResolver = noPose,
) {
  const layerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [pose, setPose] = useState<SpatialWebSurfacePose>(DEFAULT_SURFACE_POSE);
  const [status, setStatus] = useState<SurfaceStatus>("waiting");
  const [anchors, setAnchors] = useState<ReadonlyMap<string, NativeAnchor>>(
    () => new Map(),
  );
  const state = useRef({
    pose,
    panels: [] as readonly HostPanel[],
    natives: [] as string[],
    resolve: (() => null) as NativeResolver,
    poseOf: noPose,
    /** Copy of the last camera frame (hosts reuse their frame objects). */
    camera: null as {
      viewProjection: number[];
      viewport: { left: number; top: number; width: number; height: number };
      eye: [number, number, number];
    } | null,
    anchors: new Map() as ReadonlyMap<string, NativeAnchor>,
    written: new Map<HTMLElement, Written>(),
    border: 0,
    layer: "",
    transform: "",
    clip: "",
    visibility: "waiting" as SurfaceStatus,
  });

  useLayoutEffect(() => {
    state.current.pose = pose;
  }, [pose]);
  useLayoutEffect(() => {
    state.current.anchors = anchors;
  }, [anchors]);
  useLayoutEffect(() => {
    state.current.panels = panels;
  }, [panels]);
  useLayoutEffect(() => {
    state.current.poseOf = poseOf;
  }, [poseOf]);

  // Release elements that are no longer natively extracted (restore,
  // unmount): before paint, so a restored element is never drawn with a
  // stale spatial transform.
  const nativeKey = JSON.stringify(nativeIds);
  useLayoutEffect(() => {
    state.current.resolve = resolveNative;
  }, [resolveNative]);
  useLayoutEffect(() => {
    const s = state.current;
    const natives = (JSON.parse(nativeKey) as string[]).flatMap((id) => {
      const element = resolveNative(id);
      return element ? [{ id, element }] : [];
    });
    const current = new Set(natives.map((n) => n.element));
    for (const [element, written] of [...s.written])
      if (!current.has(element)) {
        release(element, written);
        s.written.delete(element);
      }
    s.natives = natives.map((n) => n.id);
    // Not placed until the next camera frame.
    for (const { element } of natives)
      if (!s.written.has(element)) {
        const written = newWritten();
        written.visibility = "hidden";
        element.dataset.spatialVisibility = "hidden";
        s.written.set(element, written);
      }
    // The resolver may change identity every render; the id list decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeKey]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const page = pageRef.current;
    if (!active || !layer || !page) return;
    // Nothing is shown until the first camera frame positions the page.
    page.style.visibility = "hidden";
    page.dataset.surfaceVisibility = "waiting";
    const current = state.current;
    current.border = parseFloat(getComputedStyle(page).borderTopWidth) || 0;
    return () => {
      for (const property of ["left", "top", "width", "height"] as const)
        layer.style.removeProperty(property);
      for (const property of ["transform", "clip-path", "visibility"])
        page.style.removeProperty(property);
      delete page.dataset.surfaceVisibility;
      for (const [element, written] of current.written)
        release(element, written);
      current.written.clear();
      current.layer = current.transform = current.clip = "";
      current.visibility = "waiting";
      setStatus("waiting");
    };
  }, [active]);

  const onCameraFrame = useCallback((frame: HostCameraFrame) => {
    const layer = layerRef.current;
    const page = pageRef.current;
    if (!layer || !page) return;
    const s = state.current;
    const { left, top, width, height } = frame.viewport;
    // Copied into one reused buffer: hosts reuse their frame objects.
    const camera = (s.camera ??= {
      viewProjection: new Array<number>(16).fill(0),
      viewport: { left: 0, top: 0, width: 0, height: 0 },
      eye: [0, 0, 0],
    });
    for (let i = 0; i < 16; i++)
      camera.viewProjection[i] = frame.viewProjection[i]!;
    Object.assign(camera.viewport, frame.viewport);
    camera.eye[0] = frame.eye[0];
    camera.eye[1] = frame.eye[1];
    camera.eye[2] = frame.eye[2];
    // XR panels in front of the page (or of a native element) cut it out,
    // at their current (possibly manipulated) pose.
    const occluders: Occluder[] = s.panels.map((panel) => {
      const p = s.poseOf(panel.id);
      // A manipulable panel also shows its handle row below its face.
      return p
        ? transformedQuad(
            p.position,
            p.rotation,
            HANDLED_PANEL_BOUNDS.width * p.scale,
            HANDLED_PANEL_BOUNDS.height * p.scale,
            [0, HANDLED_PANEL_BOUNDS.center[1] * p.scale, 0],
          )
        : {
            center: panel.position,
            width: PANEL_SIZE.width,
            height: PANEL_SIZE.height,
          };
    });
    const layerKey = `${left},${top},${width},${height}`;
    if (layerKey !== s.layer) {
      // The layer covers exactly the canvas, clipping the page to it.
      layer.style.left = `${left}px`;
      layer.style.top = `${top}px`;
      layer.style.width = `${width}px`;
      layer.style.height = `${height}px`;
      s.layer = layerKey;
    }
    const visibility = planeVisibility(frame, s.pose, SURFACE_RESOLUTION);
    // Natively extracted elements are composited through the page's
    // transform, so it stays current even when the page itself is hidden
    // (seen from behind).
    if (visibility !== "behind") {
      const matrix = surfaceMatrix(frame, s.pose, SURFACE_RESOLUTION);
      if (matrix !== s.transform) {
        page.style.transform = matrix;
        s.transform = matrix;
      }
    }
    const keep: [number, number][][] = [];
    const composited = new Set<HTMLElement>();
    for (const id of s.natives) {
      // Resolved per frame: only the controller's current native element.
      const element = s.resolve(id);
      if (!element) continue;
      composited.add(element);
      const w = element.offsetWidth;
      const h = element.offsetHeight;
      const anchor = s.anchors.get(id);
      const written = s.written.get(element) ?? newWritten();
      s.written.set(element, written);
      // The manipulated pose, once the manipulator owns it; until then the
      // extraction anchor. Scale is spatial: the element's CSS layout size
      // (w × h) is unchanged, only its world size.
      const manipulated = s.poseOf(id);
      const panelPose: SpatialWebSurfacePose | null = anchor
        ? {
            position: manipulated?.position ?? anchor.position,
            rotation: manipulated
              ? eulerFromQuaternion(manipulated.rotation)
              : anchor.rotation,
            width: w * anchor.metersPerPixel * (manipulated?.scale ?? 1),
            height: h * anchor.metersPerPixel * (manipulated?.scale ?? 1),
          }
        : null;
      const placed =
        panelPose && w > 0 && h > 0 && visibility !== "behind"
          ? nativePanelTransform(
              frame,
              {
                pose: s.pose,
                resolution: SURFACE_RESOLUTION,
                border: s.border,
              },
              { pose: panelPose, resolution: { width: w, height: h } },
            )
          : null;
      const shown = placed?.visibility === "visible" ? "visible" : "hidden";
      if (placed?.visibility === "visible") {
        if (placed.matrix3d !== written.transform) {
          write(element, written, "transform", placed.matrix3d);
          written.transform = placed.matrix3d;
        }
        // 3D panels in front of it are cut out; so is the page when the
        // element lies behind the page plane.
        const clip = occlusionClipPath(
          frame,
          panelPose!,
          { width: w, height: h },
          placed.behindPage
            ? [...occluders, surfaceQuad(s.pose, SURFACE_RESOLUTION)]
            : occluders,
        );
        if (clip !== written.clip) {
          write(element, written, "clip-path", clip);
          written.clip = clip;
        }
        if (!placed.behindPage) keep.push(placed.pageQuad);
        const poseKey = JSON.stringify({
          ...panelPose,
          resolution: { width: w, height: h },
        });
        if (poseKey !== written.pose) {
          element.dataset.spatialPose = poseKey;
          element.dataset.spatialPlaced = "";
          written.pose = poseKey;
        }
      }
      if (shown !== written.visibility) {
        // Explicit: the page may be hidden while this element is not.
        element.dataset.spatialVisibility = shown;
        written.visibility = shown;
      }
    }
    // An element that is no longer the current element of any natively
    // extracted id (replaced while the id list stayed the same) is released.
    for (const [element, written] of s.written)
      if (!composited.has(element)) {
        release(element, written);
        s.written.delete(element);
      }
    if (visibility === "visible") {
      const clip = pageClipPath(
        frame,
        s.pose,
        SURFACE_RESOLUTION,
        occluders,
        keep,
      );
      if (clip !== s.clip) {
        page.style.clipPath = clip;
        s.clip = clip;
      }
    }
    if (visibility !== s.visibility) {
      page.style.visibility = visibility === "visible" ? "" : "hidden";
      page.dataset.surfaceVisibility = visibility;
      s.visibility = visibility;
      setStatus(visibility);
    }
  }, []);

  /** World ray under a client point, from the last rendered camera. */
  const rayAt = useCallback((clientX: number, clientY: number) => {
    const camera = state.current.camera;
    return camera
      ? (viewportRay(camera, clientX, clientY) as HostRay | null)
      : null;
  }, []);

  const placeNative = useCallback((id: string, anchor: NativeAnchor) => {
    setAnchors((current) => new Map(current).set(id, anchor));
  }, []);

  // Callback refs: the compositor writes to these elements outside React.
  const attachLayer = useCallback((element: HTMLDivElement | null) => {
    layerRef.current = element;
  }, []);
  const attachPage = useCallback((element: HTMLDivElement | null) => {
    pageRef.current = element;
  }, []);

  return {
    attachLayer,
    attachPage,
    pose,
    setPose,
    status,
    onCameraFrame,
    anchors,
    placeNative,
    rayAt,
  };
}

export type SurfaceCompositor = ReturnType<typeof useSurfaceCompositor>;
