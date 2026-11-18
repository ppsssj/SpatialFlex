import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { createXRStore, XR, type XRStore } from "@react-three/xr";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Matrix4, Mesh, Vector3, type PerspectiveCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getProbe, hostMounted, recordFrame } from "../../contracts/hostProbe";
import {
  CAMERA,
  type HostCameraFrame,
  type HostPanel,
  type XRHostProps,
} from "../../contracts/xrHost";
import { describeError, HostToolbar } from "../shared/HostToolbar";
import { useXRAvailability } from "../shared/useXRAvailability";
import { Panel3D } from "./Panel3D";

const isVRSupported = async () =>
  (await navigator.xr?.isSessionSupported("immersive-vr")) ?? false;

function createHostXRStore() {
  return createXRStore({
    // The host never injects an emulator; development tooling installs one
    // as the browser's WebXR runtime when explicitly requested.
    emulate: false,
    // Sessions start from the Enter VR button only.
    offerSession: false,
    // Draw rays only; controller and hand models load from a remote CDN.
    controller: { model: false },
    hand: { model: false },
  });
}

/**
 * Three.js XR host: React Three Fiber scene with a desktop camera, floor,
 * lighting and floating panels, which can also be entered as an immersive
 * WebXR session through @react-three/xr. Depends only on the neutral host
 * contract.
 */
export function ThreeHost({ panels, onCameraFrame, ...events }: XRHostProps) {
  const [store] = useState(createHostXRStore);
  useEffect(() => () => store.destroy(), [store]);
  useEffect(() => hostMounted("three"), []);

  const availability = useXRAvailability(isVRSupported);
  const sessionMode = useSyncExternalStore(
    store.subscribe,
    () => store.getState().mode ?? null,
    () => null,
  );
  const [error, setError] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState(0);

  const enterVR = async () => {
    setError(null);
    try {
      const session = await store.enterVR();
      if (!session) setError("Immersive VR is not supported in this browser.");
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  return (
    <div className="xr-host">
      <HostToolbar
        engine="three"
        availability={availability}
        sessionMode={sessionMode}
        error={error}
        onEnterVR={enterVR}
        onExitVR={() => void store.getState().session?.end()}
        onResetView={() => setViewKey((k) => k + 1)}
      />
      <Canvas
        className="xr-host-canvas"
        data-testid="xr-canvas"
        camera={{ position: [...CAMERA.position], fov: CAMERA.fov }}
      >
        <Scene
          store={store}
          panels={panels}
          events={events}
          sessionMode={sessionMode}
          viewKey={viewKey}
        />
        <CameraFrameReporter onCameraFrame={onCameraFrame} />
      </Canvas>
    </div>
  );
}

function Scene({
  store,
  panels,
  events,
  sessionMode,
  viewKey,
}: {
  store: XRStore;
  panels: readonly HostPanel[];
  events: Omit<XRHostProps, "panels">;
  sessionMode: string | null;
  viewKey: number;
}) {
  return (
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
  );
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

/**
 * Publishes the final desktop camera of each frame for same-document DOM
 * compositing. Plain numbers only; objects are reused between frames.
 */
function CameraFrameReporter({
  onCameraFrame,
}: {
  onCameraFrame: XRHostProps["onCameraFrame"];
}) {
  const listener = useRef(onCameraFrame);
  useEffect(() => {
    listener.current = onCameraFrame;
  }, [onCameraFrame]);
  // Reused between frames; created on the first frame.
  const scratch = useRef<{
    vp: Matrix4;
    eye: Vector3;
    frame: {
      viewProjection: ArrayLike<number>;
      viewport: { left: number; top: number; width: number; height: number };
      eye: [number, number, number];
    };
  } | null>(null);
  useFrame(({ camera, gl }) => {
    const report = listener.current;
    if (!report) return;
    const state = (scratch.current ??= {
      vp: new Matrix4(),
      eye: new Vector3(),
      frame: {
        viewProjection: [],
        viewport: { left: 0, top: 0, width: 0, height: 0 },
        eye: [0, 0, 0],
      },
    });
    camera.updateMatrixWorld();
    state.vp.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    camera.getWorldPosition(state.eye);
    const rect = gl.domElement.getBoundingClientRect();
    const { frame } = state;
    frame.viewProjection = state.vp.elements;
    frame.viewport.left = rect.left;
    frame.viewport.top = rect.top;
    frame.viewport.width = rect.width;
    frame.viewport.height = rect.height;
    frame.eye[0] = state.eye.x;
    frame.eye[1] = state.eye.y;
    frame.eye[2] = state.eye.z;
    report(frame satisfies HostCameraFrame);
  });
  return null;
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
    probe.project = ([x, y, z]) => {
      const ndc = new Vector3(x, y, z).project(camera);
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
    const now = performance.now();
    recordFrame(last.current === null ? null : now - last.current);
    last.current = now;
  });
  return null;
}
