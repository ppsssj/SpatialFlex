import { useEffect, useRef, useState } from "react";
import { hostMounted } from "../../contracts/hostProbe";
import type { HostEvents, XRHostProps } from "../../contracts/xrHost";
import { describeError, HostToolbar } from "../shared/HostToolbar";
import { useXRAvailability } from "../shared/useXRAvailability";
import { BabylonLabScene, isVRSupported } from "./scene";

/**
 * Babylon.js XR host. Follows Babylon's React integration pattern: the
 * engine and scene are created in an effect on a canvas ref and disposed on
 * unmount. Depends only on the neutral host contract.
 */
export function BabylonHost({
  panels,
  onPanelButton,
  onPanelSelect,
  onPanelClose,
  onCameraFrame,
}: XRHostProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BabylonLabScene | null>(null);
  const eventsRef = useRef<HostEvents>({
    onPanelButton,
    onPanelSelect,
    onPanelClose,
  });
  const availability = useXRAvailability(isVRSupported);
  const [sessionMode, setSessionMode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Engine and scene: created once, disposed on unmount.
  useEffect(() => {
    const scene = new BabylonLabScene(canvasRef.current!, eventsRef.current);
    scene.onSessionModeChange = setSessionMode;
    sceneRef.current = scene;
    const unregister = hostMounted("babylon");
    return () => {
      scene.dispose();
      sceneRef.current = null;
      unregister();
    };
  }, []);

  useEffect(() => {
    eventsRef.current = { onPanelButton, onPanelSelect, onPanelClose };
    sceneRef.current?.setEvents(eventsRef.current);
  }, [onPanelButton, onPanelSelect, onPanelClose]);

  useEffect(() => {
    sceneRef.current?.setPanels(panels);
  }, [panels]);

  useEffect(() => {
    const scene = sceneRef.current;
    scene?.setCameraFrameListener(onCameraFrame ?? null);
    return () => scene?.setCameraFrameListener(null);
  }, [onCameraFrame]);

  const enterVR = async () => {
    setError(null);
    if (availability !== "available") {
      setError("Immersive VR is not supported in this browser.");
      return;
    }
    try {
      await sceneRef.current?.enterVR();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  return (
    <div className="xr-host">
      <HostToolbar
        engine="babylon"
        availability={availability}
        sessionMode={sessionMode}
        error={error}
        onEnterVR={enterVR}
        onExitVR={() => void sceneRef.current?.exitVR()}
        onResetView={() => sceneRef.current?.resetView()}
      />
      <canvas
        ref={canvasRef}
        className="xr-host-canvas"
        data-testid="xr-canvas"
      />
    </div>
  );
}
