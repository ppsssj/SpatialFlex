import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  PANEL_SIZE,
  type HostCameraFrame,
  type HostPanel,
  type Vec3,
} from "../contracts/xrHost";
import { DEFAULT_SURFACE_POSE, SURFACE_RESOLUTION } from "./surfaceConfig";
import {
  nativePanelTransform,
  occlusionClipPath,
  pageClipPath,
  planeVisibility,
  surfaceMatrix,
  surfaceQuad,
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

interface Written {
  transform: string;
  clip: string;
  visibility: string;
  pose: string;
}

/** Inline presentation properties the compositor owns on a native element. */
const NATIVE_PROPERTIES = ["transform", "clip-path", "visibility"] as const;

function release(element: HTMLElement) {
  for (const property of NATIVE_PROPERTIES)
    element.style.removeProperty(property);
  delete element.dataset.spatialPlaced;
  delete element.dataset.spatialPose;
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
    occluders: [] as Occluder[],
    natives: [] as string[],
    resolve: (() => null) as NativeResolver,
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
    state.current.occluders = panels.map((panel) => ({
      center: panel.position,
      width: PANEL_SIZE.width,
      height: PANEL_SIZE.height,
    }));
  }, [panels]);

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
    for (const element of [...s.written.keys()])
      if (!current.has(element)) {
        release(element);
        s.written.delete(element);
      }
    s.natives = natives.map((n) => n.id);
    // Not placed until the next camera frame.
    for (const { element } of natives)
      if (!s.written.has(element)) element.style.visibility = "hidden";
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
      for (const element of current.written.keys()) release(element);
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
    for (const id of s.natives) {
      // Resolved per frame: only the controller's current native element.
      const element = s.resolve(id);
      if (!element) continue;
      const w = element.offsetWidth;
      const h = element.offsetHeight;
      const anchor = s.anchors.get(id);
      const written = s.written.get(element) ?? {
        transform: "",
        clip: "",
        visibility: "",
        pose: "",
      };
      s.written.set(element, written);
      const panelPose: SpatialWebSurfacePose | null = anchor
        ? {
            position: anchor.position,
            rotation: anchor.rotation,
            width: w * anchor.metersPerPixel,
            height: h * anchor.metersPerPixel,
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
          element.style.transform = placed.matrix3d;
          written.transform = placed.matrix3d;
        }
        // 3D panels in front of it are cut out; so is the page when the
        // element lies behind the page plane.
        const clip = occlusionClipPath(
          frame,
          panelPose!,
          { width: w, height: h },
          placed.behindPage
            ? [...s.occluders, surfaceQuad(s.pose, SURFACE_RESOLUTION)]
            : s.occluders,
        );
        if (clip !== written.clip) {
          element.style.clipPath = clip;
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
        element.style.visibility = shown;
        written.visibility = shown;
      }
    }
    if (visibility === "visible") {
      const clip = pageClipPath(
        frame,
        s.pose,
        SURFACE_RESOLUTION,
        s.occluders,
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
  };
}

export type SurfaceCompositor = ReturnType<typeof useSurfaceCompositor>;
