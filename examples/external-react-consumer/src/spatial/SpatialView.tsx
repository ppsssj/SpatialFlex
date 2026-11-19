import { trackManipulationPointer } from "@spatialflex/dom";
import { useEffect, useRef } from "react";
import {
  CanvasTexture,
  Color,
  GridHelper,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { AdaptivePanel, SpatialRuntime } from "./useSpatialRuntime";

/**
 * This application's renderer adapter (Three.js). It draws its own scene
 * and the XR Adaptive panels, and reports to SpatialFlex only:
 * - a camera frame after each render (`runtime.onCameraFrame`), from which
 *   the SDK places the native elements and derives world rays;
 * - world rays from its own picking, fed to the shared `ItemManipulator`.
 * It keeps no copy of application state and has no manipulation logic.
 */

const PANEL = { width: 0.6, height: 0.4 };
const TEXTURE = { width: 600, height: 400 };
/** The action button area of a panel texture (uv, y up). */
const ACTION = { x0: 0.3, x1: 0.7, y0: 0.06, y1: 0.24 };
/** Renderers alive right now (disposal is checked by the tests). */
let liveRenderers = 0;

/** Read-only probe for the end-to-end tests. */
declare global {
  interface Window {
    __spatialView?: {
      frames: number;
      liveRenderers: number;
      liveTextures: number;
      project(p: [number, number, number]): { x: number; y: number } | null;
      locate(id: string, u: number, v: number): { x: number; y: number } | null;
    };
  }
}

function drawPanel(context: CanvasRenderingContext2D, panel: AdaptivePanel) {
  const { width: w, height: h } = TEXTURE;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, w, h);
  context.fillStyle = "#1565c0";
  context.fillRect(0, 0, w, 64);
  context.fillStyle = "#ffffff";
  context.font = "bold 32px sans-serif";
  context.fillText(panel.view.title, 20, 44);
  const body = panel.view.body;
  context.fillStyle = "#1f2328";
  if (body.kind === "value") {
    context.font = "28px sans-serif";
    context.fillText(body.label, 20, 120);
    context.font = "bold 72px sans-serif";
    context.fillText(body.value, 20, 200);
  } else if (body.kind === "bars") {
    const max = Math.max(1, ...body.values);
    body.values.forEach((value, i) => {
      const bh = (150 * value) / max;
      context.fillStyle = "#1976d2";
      context.fillRect(20 + i * 44, 250 - bh, 34, bh);
    });
  }
  const action = panel.view.actions[0];
  if (action) {
    context.fillStyle = "#1976d2";
    context.fillRect(
      ACTION.x0 * w,
      (1 - ACTION.y1) * h,
      (ACTION.x1 - ACTION.x0) * w,
      (ACTION.y1 - ACTION.y0) * h,
    );
    context.fillStyle = "#ffffff";
    context.font = "bold 30px sans-serif";
    context.textAlign = "center";
    context.fillText(
      action.label,
      w / 2,
      (1 - (ACTION.y0 + ACTION.y1) / 2) * h + 10,
    );
    context.textAlign = "start";
  }
}

export function SpatialView({ runtime }: { runtime: SpatialRuntime }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef(runtime);
  useEffect(() => {
    runtimeRef.current = runtime;
  });

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.domElement.dataset.testid = "spatial-canvas";
    host.append(renderer.domElement);
    const scene = new Scene();
    scene.background = new Color("#dde3ea");
    scene.add(new GridHelper(10, 20, "#8c959f", "#c3cbd3"));
    scene.add(new HemisphereLight("#ffffff", "#888888", 1));
    const camera = new PerspectiveCamera(
      50,
      host.clientWidth / host.clientHeight,
      0.01,
      100,
    );
    camera.position.set(0, 1.45, 0.9);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.35, -1);
    controls.update();

    // XR Adaptive panels, drawn from their semantic view records.
    const panels = new Map<
      string,
      { mesh: Mesh; texture: CanvasTexture; key: string; panel: AdaptivePanel }
    >();
    let liveTextures = 0;
    const geometry = new PlaneGeometry(PANEL.width, PANEL.height);
    const syncPanels = () => {
      const wanted = runtimeRef.current.adaptivePanels;
      for (const [instance, entry] of panels)
        if (!wanted.some((p) => p.instance === instance)) {
          scene.remove(entry.mesh);
          entry.texture.dispose();
          (entry.mesh.material as MeshBasicMaterial).dispose();
          liveTextures--;
          panels.delete(instance);
        }
      for (const panel of wanted) {
        let entry = panels.get(panel.instance);
        if (!entry) {
          const canvas = document.createElement("canvas");
          canvas.width = TEXTURE.width;
          canvas.height = TEXTURE.height;
          const texture = new CanvasTexture(canvas);
          texture.colorSpace = SRGBColorSpace;
          liveTextures++;
          const mesh = new Mesh(
            geometry,
            new MeshBasicMaterial({ map: texture }),
          );
          mesh.userData.instance = panel.instance;
          scene.add(mesh);
          entry = { mesh, texture, key: "", panel };
          panels.set(panel.instance, entry);
        }
        entry.panel = panel;
        const key = JSON.stringify(panel.view);
        if (key !== entry.key) {
          drawPanel(entry.texture.image.getContext("2d")!, panel);
          entry.texture.needsUpdate = true;
          entry.key = key;
        }
        const pose = runtimeRef.current.items.poseOf(panel.id);
        if (pose) {
          entry.mesh.position.set(...pose.position);
          entry.mesh.quaternion.set(...pose.rotation);
          entry.mesh.scale.setScalar(pose.scale);
        }
      }
    };

    // Picking: a press on a panel's action runs it; elsewhere on the panel
    // it starts a translate session. Camera controls are suspended until
    // the press is released (even after Escape).
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const rayAt = (x: number, y: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((x - rect.left) / rect.width) * 2 - 1,
        -((y - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      return raycaster.ray;
    };
    let drag: (() => void) | null = null;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || drag) return;
      const ray = rayAt(event.clientX, event.clientY);
      const hit = raycaster.intersectObjects(
        [...panels.values()].map((p) => p.mesh),
      )[0];
      if (!hit) return;
      const entry = panels.get(hit.object.userData.instance as string)!;
      // Picked: the camera must not take this press.
      event.stopImmediatePropagation();
      const uv = hit.uv!;
      const action = entry.panel.view.actions[0];
      if (
        action &&
        uv.x >= ACTION.x0 &&
        uv.x <= ACTION.x1 &&
        uv.y >= ACTION.y0 &&
        uv.y <= ACTION.y1
      ) {
        runtimeRef.current.invoke(entry.panel, action.id);
        return;
      }
      const items = runtimeRef.current.items;
      const token = items.begin(entry.panel.id, "translate", event.pointerId, {
        origin: [ray.origin.x, ray.origin.y, ray.origin.z],
        direction: [ray.direction.x, ray.direction.y, ray.direction.z],
      });
      if (token === null) return;
      controls.enabled = false;
      drag = trackManipulationPointer({
        token,
        pointerId: event.pointerId,
        toRay: (x, y) => {
          const r = rayAt(x, y);
          return {
            origin: [r.origin.x, r.origin.y, r.origin.z],
            direction: [r.direction.x, r.direction.y, r.direction.z],
          };
        },
        manipulation: items,
        onRelease: () => {
          drag = null;
          controls.enabled = true;
        },
      });
    };
    // Capture phase: before OrbitControls' own listener on the canvas.
    renderer.domElement.addEventListener("pointerdown", down, true);

    const resize = new ResizeObserver(() => {
      renderer.setSize(host.clientWidth, host.clientHeight);
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
    });
    resize.observe(host);

    const viewProjection = new Matrix4();
    const probe = {
      frames: 0,
      get liveRenderers() {
        return liveRenderers;
      },
      get liveTextures() {
        return liveTextures;
      },
      project([x, y, z]: [number, number, number]) {
        const p = new Vector3(x, y, z).project(camera);
        if (p.z > 1) return null;
        const rect = renderer.domElement.getBoundingClientRect();
        return {
          x: rect.left + ((p.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - p.y) / 2) * rect.height,
        };
      },
      /** Client point of a panel's local uv (0..1, y up). */
      locate(id: string, u: number, v: number) {
        const entry = [...panels.values()].find((p) => p.panel.id === id);
        if (!entry) return null;
        const local = new Vector3(
          (u - 0.5) * PANEL.width,
          (v - 0.5) * PANEL.height,
          0,
        );
        const world = entry.mesh.localToWorld(local);
        return probe.project([world.x, world.y, world.z]);
      },
    };
    liveRenderers++;
    window.__spatialView = probe;

    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      controls.update();
      syncPanels();
      renderer.render(scene, camera);
      // The camera of this frame, as SpatialFlex expects it.
      camera.updateMatrixWorld();
      viewProjection.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      const rect = renderer.domElement.getBoundingClientRect();
      runtimeRef.current.onCameraFrame({
        viewProjection: viewProjection.elements,
        viewport: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        eye: [camera.position.x, camera.position.y, camera.position.z],
      });
      probe.frames++;
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      drag?.();
      resize.disconnect();
      renderer.domElement.removeEventListener("pointerdown", down, true);
      controls.dispose();
      for (const entry of panels.values()) {
        entry.texture.dispose();
        (entry.mesh.material as MeshBasicMaterial).dispose();
        liveTextures--;
      }
      panels.clear();
      geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      liveRenderers--;
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="spatial-view"
      aria-label="3D workspace"
      data-testid="spatial-view"
    />
  );
}
