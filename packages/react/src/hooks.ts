import type {
  SpatialItemId,
  SpatialItemRecord,
  SpatialRegistry,
  SpatialRegistryListener,
} from "@spatialflex/core";
import { useCallback, useSyncExternalStore } from "react";
import { useSpatialRegistry } from "./context";

/** Items registered in the current workspace, in registration order. */
export function useSpatialItems(): readonly SpatialItemRecord[] {
  const registry = useSpatialRegistry();
  const getSnapshot = useCallback(() => registry.list(), [registry]);
  return useSyncExternalStore(useSubscribe(registry), getSnapshot);
}

/** The item registered under `id` in the current workspace, if any. */
export function useSpatialItem(
  id: SpatialItemId,
): SpatialItemRecord | undefined {
  const registry = useSpatialRegistry();
  const getSnapshot = useCallback(() => registry.get(id), [registry, id]);
  return useSyncExternalStore(useSubscribe(registry), getSnapshot);
}

// A stable subscribe function keeps useSyncExternalStore from resubscribing
// on every render.
function useSubscribe(registry: SpatialRegistry) {
  return useCallback(
    (listener: SpatialRegistryListener) => registry.subscribe(listener),
    [registry],
  );
}
