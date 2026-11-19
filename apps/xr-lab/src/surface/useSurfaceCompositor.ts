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
import {
  NativeCompositor,
  quaternionFromEuler,
  type NativeIssues,
  type NativeTarget,
} from "@spatialflex/dom";
import { DEFAULT_SURFACE_POSE, SURFACE_RESOLUTION } from "./surfaceConfig";
import {
  pageClipPath,
  planeVisibility,
  surfaceMatrix,
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

export type { NativeIssues };

/**
 * The DOM compositor of the spatial web surface. It owns presentation only:
 * camera alignment (per-frame CSS transforms written directly to elements,
 * without React renders), occlusion clipping and pointer routing.
 *
 * It composites the page and, for Native DOM extraction, the original
 * elements that the SpatialFlex controller placed externally, through the
 * SDK's {@link NativeCompositor} (`@spatialflex/dom`) with the page as their
 * containing surface. Those stay where React rendered them (inside the
 * page); only their transform, clip and visibility are written, and removed
 * again on restore. Nothing is moved, cloned or remounted.
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
  const [nativeIssues, setNativeIssues] = useState<NativeIssues>(
    () => new Map(),
  );
  const [natives] = useState(
    () => new NativeCompositor({ onIssues: setNativeIssues }),
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
    s.natives = JSON.parse(nativeKey) as string[];
    natives.setTargets(nativeTargets(s));
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
      natives.dispose();
      current.layer = current.transform = current.clip = "";
      current.visibility = "waiting";
      setStatus("waiting");
    };
  }, [active, natives]);

  const onCameraFrame = useCallback(
    (frame: HostCameraFrame) => {
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
      // Resolved per frame: only the controller's current native elements
      // (a replaced element is released by setTargets).
      natives.setTargets(nativeTargets(s));
      const { keep } = natives.composite(frame, {
        surface: {
          element: page,
          pose: s.pose,
          resolution: SURFACE_RESOLUTION,
          border: s.border,
        },
        occluders,
      });
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
    },
    [natives],
  );

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
    nativeIssues,
    /** The page element (the native elements' required containing block). */
    pageElement: () => pageRef.current,
  };
}

export type SurfaceCompositor = ReturnType<typeof useSurfaceCompositor>;

/**
 * Native targets of the current natively extracted ids: the original
 * element, at its manipulated pose once the manipulator owns it, else at
 * its extraction anchor. Scale is spatial: the CSS layout size is unchanged.
 */
function nativeTargets(s: {
  natives: readonly string[];
  resolve: NativeResolver;
  anchors: ReadonlyMap<string, NativeAnchor>;
  poseOf: PoseResolver;
}): NativeTarget[] {
  return s.natives.flatMap((id) => {
    const element = s.resolve(id);
    if (!element) return [];
    return [
      {
        id,
        element,
        placement: () => {
          const anchor = s.anchors.get(id);
          if (!anchor) return undefined;
          const manipulated = s.poseOf(id);
          return {
            position: manipulated?.position ?? anchor.position,
            rotation:
              manipulated?.rotation ?? quaternionFromEuler(anchor.rotation),
            scale: manipulated?.scale ?? 1,
            metersPerPixel: anchor.metersPerPixel,
          };
        },
      },
    ];
  });
}
