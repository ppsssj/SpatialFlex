/**
 * Development and test tooling: optionally installs the IWER WebXR emulator
 * as the browser's WebXR runtime (`navigator.xr`) before any XR host loads.
 * Hosts never configure emulation; to them an installed emulator is just a
 * WebXR runtime. This is the only place that knows about it.
 *
 * Guard rails:
 * - Only on request: `?xr-emulator=iwer`.
 * - Only in development or in builds made with `VITE_XR_LAB_TEST_HOOKS=1`
 *   (the E2E builds). A normal production build never installs it.
 * - Never over a working runtime: if the browser already supports immersive
 *   VR (for example a headset), the emulator is not installed.
 */
export interface EmulatorStatus {
  readonly requested: boolean;
  readonly installed: boolean;
  readonly detail: string;
}

export const emulatorAllowed =
  import.meta.env.DEV || import.meta.env.VITE_XR_LAB_TEST_HOOKS === "1";

export async function setupEmulator(search: string): Promise<EmulatorStatus> {
  const requested = new URLSearchParams(search).get("xr-emulator") === "iwer";
  if (!requested) {
    return { requested, installed: false, detail: "not requested" };
  }
  if (!emulatorAllowed) {
    return { requested, installed: false, detail: "disabled in this build" };
  }
  const native =
    (await navigator.xr
      ?.isSessionSupported("immersive-vr")
      .catch(() => false)) ?? false;
  if (native) {
    return {
      requested,
      installed: false,
      detail: "not installed: the browser already provides immersive VR",
    };
  }

  const [{ XRDevice, metaQuest3 }, { DevUI }] = await Promise.all([
    import("iwer"),
    import("@iwer/devui"),
  ]);
  const device = new XRDevice(metaQuest3);
  // Chromium exposes a native `navigator.xr` even without a headset, and IWER
  // does not install over an existing one unless forced. The native runtime
  // reported no immersive support above, so forcing cannot hide a headset.
  device.installRuntime({ forceInstall: true });
  device.installDevUI(DevUI);
  (window as unknown as { __xrLabDevtools?: unknown }).__xrLabDevtools = {
    emulator: device,
  };
  return {
    requested,
    installed: true,
    detail: "IWER emulator installed as the WebXR runtime (development only)",
  };
}
