import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  PANEL_SIZE,
  type HostCameraFrame,
  type HostPanel,
} from "../contracts/xrHost";
import { DEFAULT_SURFACE_POSE, SURFACE_RESOLUTION } from "./surfaceConfig";
import {
  occlusionClipPath,
  surfaceTransform,
  type SpatialWebSurfacePose,
  type SurfaceVisibility,
  type WorldRect,
} from "./surfaceMath";

export type SurfaceStatus = "waiting" | SurfaceVisibility;

/**
 * The DOM compositor of the spatial web surface. It owns the page's
 * presentation only: camera alignment (a per-frame CSS transform written
 * directly to the element, without React renders), occlusion clipping and
 * pointer routing. The page's React content is never moved, cloned or
 * remounted; `active` only changes how the same element is presented.
 */
export function useSurfaceCompositor(
  active: boolean,
  panels: readonly HostPanel[],
) {
  const layerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [pose, setPose] = useState<SpatialWebSurfacePose>(DEFAULT_SURFACE_POSE);
  const [status, setStatus] = useState<SurfaceStatus>("waiting");
  const state = useRef({
    pose,
    occluders: [] as WorldRect[],
    layer: "",
    transform: "",
    clip: "",
    visibility: "waiting" as SurfaceStatus,
  });

  useLayoutEffect(() => {
    state.current.pose = pose;
  }, [pose]);
  useLayoutEffect(() => {
    state.current.occluders = panels.map((panel) => ({
      center: panel.position,
      width: PANEL_SIZE.width,
      height: PANEL_SIZE.height,
    }));
  }, [panels]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const page = pageRef.current;
    if (!active || !layer || !page) return;
    // Nothing is shown until the first camera frame positions the page.
    page.style.visibility = "hidden";
    page.dataset.surfaceVisibility = "waiting";
    const current = state.current;
    return () => {
      for (const property of ["left", "top", "width", "height"] as const)
        layer.style.removeProperty(property);
      for (const property of ["transform", "clip-path", "visibility"])
        page.style.removeProperty(property);
      delete page.dataset.surfaceVisibility;
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
    const layerKey = `${left},${top},${width},${height}`;
    if (layerKey !== s.layer) {
      // The layer covers exactly the canvas, clipping the page to it.
      layer.style.left = `${left}px`;
      layer.style.top = `${top}px`;
      layer.style.width = `${width}px`;
      layer.style.height = `${height}px`;
      s.layer = layerKey;
    }
    const result = surfaceTransform(frame, s.pose, SURFACE_RESOLUTION);
    if (result.visibility === "visible") {
      if (result.matrix3d !== s.transform) {
        page.style.transform = result.matrix3d;
        s.transform = result.matrix3d;
      }
      const clip = occlusionClipPath(
        frame,
        s.pose,
        SURFACE_RESOLUTION,
        s.occluders,
      );
      if (clip !== s.clip) {
        page.style.clipPath = clip;
        s.clip = clip;
      }
    }
    if (result.visibility !== s.visibility) {
      page.style.visibility = result.visibility === "visible" ? "" : "hidden";
      page.dataset.surfaceVisibility = result.visibility;
      s.visibility = result.visibility;
      setStatus(result.visibility);
    }
  }, []);

  // Callback refs: the compositor writes to these elements outside React.
  const attachLayer = useCallback((element: HTMLDivElement | null) => {
    layerRef.current = element;
  }, []);
  const attachPage = useCallback((element: HTMLDivElement | null) => {
    pageRef.current = element;
  }, []);

  return { attachLayer, attachPage, pose, setPose, status, onCameraFrame };
}

export type SurfaceCompositor = ReturnType<typeof useSurfaceCompositor>;
