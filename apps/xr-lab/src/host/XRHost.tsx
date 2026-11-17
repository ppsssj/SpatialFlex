import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { XR, type XRStore } from "@react-three/xr";
import { useEffect, useRef, useState } from "react";
import { Mesh, Vector3, type PerspectiveCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Panel3D } from "./Panel3D";
import { getProbe } from "./probe";
import { CAMERA, type HostEvents, type HostPanel } from "./types";
import {
  useXRAvailability,
  useXRSessionMode,
  type XRAvailability,
} from "./xrAvailability";

export interface XRHostProps extends HostEvents {
  /** WebXR store created by the embedding app (see devtools/xrRuntime). */
  store: XRStore;
  /** Panels to render. The host keeps no copy of their content. */
  panels: readonly HostPanel[];
}

/**
 * Neutral XR host: a Three.js scene with a desktop camera, floor, lighting
 * and floating panels, which can also be entered as an immersive WebXR
 * session. It depends only on React Three Fiber, Three.js and
 * @react-three/xr.
 */
export function XRHost({ store, panels, ...events }: XRHostProps) {
  const availability = useXRAvailability(store);
  const sessionMode = useXRSessionMode(store);
  const [error, setError] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState(0);

  const enterVR = async () => {
    setError(null);
    try {
      const session = await store.enterVR();
      if (!session) setError("Immersive VR is not supported in this browser.");
    } catch (cause) {
      setError(
        `The VR session request was rejected: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };
  const exitVR = () => void store.getState().session?.end();

  return (
    <div className="xr-host">
      <div
        className="xr-host-bar"
        role="toolbar"
        aria-label="Spatial workspace"
      >
        {sessionMode ? (
          <button type="button" onClick={exitVR}>
            Exit VR
          </button>
        ) : (
          // Never disabled: support can appear later (for example when an
          // emulator is injected), and unsupported requests are reported.
          <button type="button" onClick={enterVR}>
            Enter VR
          </button>
        )}
        <button type="button" onClick={() => setViewKey((k) => k + 1)}>
          Reset view
        </button>
        <span data-testid="xr-availability" data-value={availability}>
          XR: {describeAvailability(availability)}
        </span>
        <span data-testid="xr-session" data-value={sessionMode ?? "none"}>
          Session: {sessionMode ?? "none"}
        </span>
        {error && (
          <span role="alert" data-testid="xr-error">
            {error}
          </span>
        )}
      </div>
      <Canvas
        className="xr-host-canvas"
        data-testid="xr-canvas"
        camera={{ position: [...CAMERA.position], fov: CAMERA.fov }}
      >
        <XR store={store}>
          <color attach="background" args={["#dde3ea"]} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[2, 4, 3]} intensity={1.2} />
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[10, 10]} />
            <meshStandardMaterial color="#c8d1dc" />
          </mesh>
          <gridHelper
            args={[10, 20, "#7d8590", "#a5adb8"]}
            position={[0, 0.001, 0]}
          />
          {panels.map((panel) => (
            <Panel3D key={panel.id} panel={panel} events={events} />
          ))}
          <DesktopControls enabled={!sessionMode} resetKey={viewKey} />
          <ProbeBinder panels={panels} sessionMode={sessionMode} />
        </XR>
      </Canvas>
    </div>
  );
}

function describeAvailability(value: XRAvailability) {
  switch (value) {
    case "checking":
      return "checking...";
    case "native":
      return "immersive VR available";
    case "emulated":
      return "immersive VR available (emulated)";
    case "unavailable":
      return "immersive VR unavailable (desktop 3D only)";
  }
}

/** Mouse orbit around the deterministic target; off during XR sessions. */
function DesktopControls({
  enabled,
  resetKey,
}: {
  enabled: boolean;
  resetKey: number;
}) {
  const { camera, gl } = useThree();
  useEffect(() => {
    if (!enabled) return;
    resetCamera(camera as PerspectiveCamera);
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(...CAMERA.target);
    controls.update();
    return () => controls.dispose();
  }, [camera, gl, enabled, resetKey]);
  return null;
}

function resetCamera(camera: PerspectiveCamera) {
  camera.position.set(...CAMERA.position);
  camera.fov = CAMERA.fov;
  camera.updateProjectionMatrix();
}

/** Keeps the read-only host probe up to date. */
function ProbeBinder({
  panels,
  sessionMode,
}: {
  panels: readonly HostPanel[];
  sessionMode: string | null;
}) {
  const { camera, gl, scene } = useThree();
  const last = useRef<number | null>(null);

  useEffect(() => {
    const probe = getProbe();
    const find = (panelId: string, part: string) => {
      let found: Mesh | undefined;
      scene.traverse((object) => {
        if (
          object instanceof Mesh &&
          object.userData.hostPanelId === panelId &&
          object.userData.hostPart === part
        ) {
          found = object;
        }
      });
      return found;
    };
    probe.locate = (panelId, part) => {
      const mesh = find(panelId, part);
      if (!mesh) return null;
      const ndc = mesh.getWorldPosition(new Vector3()).project(camera);
      if (ndc.z > 1) return null;
      const rect = gl.domElement.getBoundingClientRect();
      return {
        x: rect.left + ((ndc.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - ndc.y) / 2) * rect.height,
      };
    };
    probe.worldPosition = (panelId, part) => {
      const mesh = find(panelId, part);
      return mesh ? mesh.getWorldPosition(new Vector3()).toArray() : null;
    };
    probe.hovered = (panelId, part) =>
      find(panelId, part)?.userData.hovered === true;
  }, [camera, gl, scene]);

  useEffect(() => {
    const probe = getProbe();
    probe.panels = panels.map((panel) => panel.id);
    probe.sessionMode = sessionMode;
  }, [panels, sessionMode]);

  useFrame(() => {
    const probe = getProbe();
    const now = performance.now();
    probe.frames++;
    if (last.current !== null) probe.frameTimes.push(now - last.current);
    if (probe.frameTimes.length > 600) probe.frameTimes.shift();
    last.current = now;
  });
  return null;
}
