import type { XRStore } from "@react-three/xr";
import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * - `native`: the browser's own WebXR reports immersive VR support.
 * - `emulated`: an emulated runtime was injected (development tooling).
 * - `unavailable`: no immersive VR support.
 */
export type XRAvailability = "checking" | "native" | "emulated" | "unavailable";

/**
 * Detects immersive VR support at runtime. It re-checks when the XR store
 * changes (an emulator can be injected after startup, replacing
 * `navigator.xr`) and when the device list changes, so a missing runtime at
 * startup never disables Enter VR for good.
 */
export function useXRAvailability(store: XRStore): XRAvailability {
  const [availability, setAvailability] = useState<XRAvailability>("checking");

  useEffect(() => {
    let current = 0;
    const check = async () => {
      const run = ++current;
      const set = (value: XRAvailability) => {
        if (run === current) setAvailability(value);
      };
      const xr = typeof navigator === "undefined" ? undefined : navigator.xr;
      if (!xr) return set("unavailable");
      const supported = await xr
        .isSessionSupported("immersive-vr")
        .catch(() => false);
      // An injected emulator only counts if it actually provides the session.
      const emulated = store.getState().emulator != null;
      set(!supported ? "unavailable" : emulated ? "emulated" : "native");
    };
    void check();
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.emulator !== previous.emulator) void check();
    });
    const xr = typeof navigator === "undefined" ? undefined : navigator.xr;
    xr?.addEventListener("devicechange", check);
    return () => {
      current++;
      unsubscribe();
      xr?.removeEventListener("devicechange", check);
    };
  }, [store]);

  return availability;
}

/** Current XR session mode (`immersive-vr`, ...) or null outside a session. */
export function useXRSessionMode(store: XRStore): string | null {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().mode ?? null,
    () => null,
  );
}
