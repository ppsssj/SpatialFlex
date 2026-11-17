import { createXRStore, type XRStore } from "@react-three/xr";

/**
 * Development tooling: creates the WebXR store and decides whether the IWER
 * emulator (bundled with @react-three/xr) is injected. This is the only place
 * that configures emulation; the XR host stays device-neutral.
 *
 * `?xr-emulator=` selects:
 * - `auto` (default): the library's default, which injects the emulator on
 *   `localhost` when the browser has no immersive WebXR support.
 * - `iwer`: always inject the emulator (used by tests on 127.0.0.1).
 * - `off`: never inject it.
 */
export type EmulatorMode = "auto" | "iwer" | "off";

export function readEmulatorMode(search: string): EmulatorMode {
  const value = new URLSearchParams(search).get("xr-emulator");
  return value === "iwer" || value === "off" ? value : "auto";
}

export function createLabXRStore(mode: EmulatorMode): XRStore {
  const store = createXRStore({
    emulate:
      mode === "off"
        ? false
        : {
            type: "metaQuest3",
            // No synthetic room: it would load extra assets.
            syntheticEnvironment: false,
            ...(mode === "iwer" && { inject: true }),
          },
    // Sessions start from the lab's explicit Enter VR button. The automatic
    // browser offer is re-requested after emulator injection and after each
    // session, and the superseded offer is an unhandled rejection in
    // @react-three/xr 6.6.
    offerSession: false,
    // Draw rays only; controller and hand models load from a remote CDN.
    controller: { model: false },
    hand: { model: false },
  });
  // Compatibility fix: IWER 2.8 does not install itself over an existing
  // native `navigator.xr`, and @react-three/xr 6.6 calls installRuntime()
  // without `forceInstall`. Chromium exposes `navigator.xr` even without a
  // headset, so the emulator would never take over there. The library only
  // injects the emulator after the native runtime reported no immersive VR
  // or AR support, so forcing the install cannot hide a real headset.
  store.subscribe((state, previous) => {
    const emulator = state.emulator;
    if (
      emulator &&
      emulator !== previous.emulator &&
      emulator.isNativeXRAvailable()
    ) {
      emulator.installRuntime({ forceInstall: true });
    }
  });
  // Exposed for tests that drive the emulated device.
  (window as unknown as { __xrLabDevtools?: unknown }).__xrLabDevtools = {
    store,
    mode,
  };
  return store;
}
