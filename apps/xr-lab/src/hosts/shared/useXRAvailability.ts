import { useEffect, useState } from "react";
import type { XRAvailability } from "./HostToolbar";

/**
 * Detects immersive VR support with the engine's own check, and checks again
 * when the browser reports a device change, so a runtime that appears later
 * is picked up.
 */
export function useXRAvailability(
  isSupported: () => Promise<boolean>,
): XRAvailability {
  const [availability, setAvailability] = useState<XRAvailability>("checking");

  useEffect(() => {
    let current = 0;
    const check = async () => {
      const run = ++current;
      const supported = await isSupported().catch(() => false);
      if (run === current)
        setAvailability(supported ? "available" : "unavailable");
    };
    void check();
    const xr = typeof navigator === "undefined" ? undefined : navigator.xr;
    xr?.addEventListener("devicechange", check);
    return () => {
      current++;
      xr?.removeEventListener("devicechange", check);
    };
  }, [isSupported]);

  return availability;
}
