import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  HANDLED_PANEL_BOUNDS,
  PANEL_SIZE,
  type HostCameraFrame,
  type HostPanel,
  type Quat,
  type Vec3,
} from "../contracts/xrHost";
import type { LabNativeHost } from "../integrations/contract";
import { DEFAULT_SURFACE_POSE, SURFACE_RESOLUTION } from "./surfaceConfig";
import {
  occlusionClipPath,
  pageClipPath,
  planeVisibility,
  surfaceMatrix,
  transformedQuad,
  type Occluder,
  type SpatialWebSurfacePose,
  type SurfaceVisibility,
} from "./surfaceMath";

export type SurfaceStatus = "waiting" | SurfaceVisibility;

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

/**
 * The page surface of the Spatial Website: the original webpage placed as
 * a plane in the 3D world. It owns the page only: its pose, its per-frame
 * CSS transform (written directly, without React renders), its occlusion
 * clip and its visibility.
 *
 * Natively extracted elements are not composited here. While active, the
 * surface connects to the integration's presentation runtime as its Native
 * DOM host (`connectNativeHost`, P1-07B3) and reports each camera frame
 * with the page as the elements' containing surface; the runtime's single
 * `NativeCompositor` owns their transform, clip, visibility and handles,
 * and returns their page footprints, which this page clip keeps. When the
 * surface deactivates (split mode, workspace unmounted) the host
 * disconnects and the runtime ends the Native presentations.
 */
export function useSurfaceCompositor(
  active: boolean,
  panels: readonly HostPanel[],
  poseOf: PoseResolver = noPose,
  connectNativeHost?: () => LabNativeHost,
) {
  const layerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [pose, setPose] = useState<SpatialWebSurfacePose>(DEFAULT_SURFACE_POSE);
  const [status, setStatus] = useState<SurfaceStatus>("waiting");
  const state = useRef({
    pose,
    panels: [] as readonly HostPanel[],
    poseOf: noPose,
    host: null as LabNativeHost | null,
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
    state.current.panels = panels;
  }, [panels]);
  useLayoutEffect(() => {
    state.current.poseOf = poseOf;
  }, [poseOf]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const page = pageRef.current;
    if (!active || !layer || !page) return;
    // Nothing is shown until the first camera frame positions the page.
    page.style.visibility = "hidden";
    page.dataset.surfaceVisibility = "waiting";
    const current = state.current;
    current.border = parseFloat(getComputedStyle(page).borderTopWidth) || 0;
    // The Native DOM host of this surface (SpatialFlex only).
    current.host = connectNativeHost?.() ?? null;
    return () => {
      // Before paint: a restored element is never drawn with a stale
      // spatial transform.
      current.host?.disconnect();
      current.host = null;
      for (const property of ["left", "top", "width", "height"] as const)
        layer.style.removeProperty(property);
      for (const property of ["transform", "clip-path", "visibility"])
        page.style.removeProperty(property);
      delete page.dataset.surfaceVisibility;
      current.layer = current.transform = current.clip = "";
      current.visibility = "waiting";
      setStatus("waiting");
    };
  }, [active, connectNativeHost]);

  const onCameraFrame = useCallback((frame: HostCameraFrame) => {
    const layer = layerRef.current;
    const page = pageRef.current;
    if (!layer || !page) return;
    const s = state.current;
    const { left, top, width, height } = frame.viewport;
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
    // Native elements: composited by the presentation runtime through
    // this page (its pose is cancelled by their transforms).
    const keep =
      s.host?.frame(frame, {
        surface: {
          element: page,
          pose: s.pose,
          resolution: SURFACE_RESOLUTION,
          border: s.border,
        },
        occluders,
      }).keep ?? [];
    if (visibility === "visible") {
      // The page clip only cuts out occluders in front of the page. With
      // none, it is `none` even while native elements are composited: their
      // footprints (`keep`) only exempt them from a clip that cuts holes.
      // A path clip on the transformed page with 3D-transformed descendants
      // is the dominant browser-side cost of Native DOM presentations
      // (P1-07C benchmark), so it is written only when it cuts something.
      const holes = occlusionClipPath(
        frame,
        s.pose,
        SURFACE_RESOLUTION,
        occluders,
      );
      const clip =
        holes === "none" || keep.length === 0
          ? holes
          : pageClipPath(frame, s.pose, SURFACE_RESOLUTION, occluders, keep);
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
    /** The page element (the native elements' required containing block). */
    pageElement: () => pageRef.current,
  };
}

export type SurfaceCompositor = ReturnType<typeof useSurfaceCompositor>;
