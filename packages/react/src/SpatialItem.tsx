import type { SpatialItemId, SpatialItemRegistration } from "@spatialflex/core";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useSpatialRegistry } from "./context";

export interface SpatialItemProps {
  /** Stable ID, unique within the workspace. */
  id: SpatialItemId;
  detachable?: boolean;
  movable?: boolean;
  resizable?: boolean;
  children?: ReactNode;
}

/**
 * Registers its children as a SpatialItem of the enclosing workspace while
 * mounted. Children render in place, without a wrapper element.
 *
 * A duplicate ID throws a `DUPLICATE_ITEM_ID` error from the commit phase,
 * which the nearest error boundary receives.
 */
export function SpatialItem({
  id,
  detachable = false,
  movable = false,
  resizable = false,
  children,
}: SpatialItemProps) {
  const registry = useSpatialRegistry();
  const capabilities = useMemo(
    () => ({ detachable, movable, resizable }),
    [detachable, movable, resizable],
  );
  const capabilitiesRef = useRef(capabilities);
  const registrationRef = useRef<SpatialItemRegistration | null>(null);

  // Declared before the registration effect so that, when the ID and the
  // capabilities change together, the new registration reads fresh values.
  useEffect(() => {
    capabilitiesRef.current = capabilities;
    registrationRef.current?.update(capabilities);
  }, [capabilities]);

  useEffect(() => {
    const registration = registry.register({
      id,
      capabilities: capabilitiesRef.current,
    });
    registrationRef.current = registration;
    return () => {
      registration.unregister();
      registrationRef.current = null;
    };
  }, [registry, id]);

  return children;
}
