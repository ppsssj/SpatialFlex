/**
 * Immersive VR availability, as reported by the browser's WebXR runtime
 * (`navigator.xr`). A development emulator, when installed, is a WebXR
 * runtime like any other; the lab shell reports separately whether one is.
 */
export type XRAvailability = "checking" | "available" | "unavailable";

export interface HostToolbarProps {
  engine: string;
  availability: XRAvailability;
  sessionMode: string | null;
  error: string | null;
  onEnterVR(): void;
  onExitVR(): void;
  onResetView(): void;
}

/** Spatial workspace toolbar, identical for every engine. DOM only. */
export function HostToolbar({
  engine,
  availability,
  sessionMode,
  error,
  onEnterVR,
  onExitVR,
  onResetView,
}: HostToolbarProps) {
  return (
    <div className="xr-host-bar" role="toolbar" aria-label="Spatial workspace">
      {sessionMode ? (
        <button type="button" onClick={onExitVR}>
          Exit VR
        </button>
      ) : (
        // Never disabled: support can appear later (for example when a
        // runtime is installed), and unsupported requests are reported.
        <button type="button" onClick={onEnterVR}>
          Enter VR
        </button>
      )}
      <button type="button" onClick={onResetView}>
        Reset view
      </button>
      <span data-testid="xr-engine">Engine: {engine}</span>
      <span data-testid="xr-availability" data-value={availability}>
        XR: {describe(availability)}
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
  );
}

function describe(value: XRAvailability) {
  switch (value) {
    case "checking":
      return "checking...";
    case "available":
      return "immersive VR available";
    case "unavailable":
      return "immersive VR unavailable (desktop 3D only)";
  }
}

export function describeError(cause: unknown) {
  return `The VR session request was rejected: ${cause instanceof Error ? cause.message : String(cause)}`;
}
