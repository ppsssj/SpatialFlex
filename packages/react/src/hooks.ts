import type {
  SpatialItemId,
  SpatialItemRecord,
  SpatialRegistry,
  SpatialRegistryListener,
  SpatialViewRecord,
} from "@spatialflex/core";
import { useCallback, useSyncExternalStore } from "react";
import { useSpatialRegistry } from "./context.js";

// Server rendering policy: <SpatialItem> registers in an effect, and effects
// never run on the server, so the server snapshot is always the empty state.
// It ignores the registry's contents, even for a pre-populated injected
// registry, so server markup and the client's hydration render always match.
// Registered items appear in a re-render right after hydration.
const SERVER_ITEMS: readonly SpatialItemRecord[] = Object.freeze([]);
const getServerItems = () => SERVER_ITEMS;
const getServerItem = () => undefined;
const SERVER_VIEWS: readonly SpatialViewRecord[] = Object.freeze([]);
const getServerViews = () => SERVER_VIEWS;

/** @experimental Mounted, explicitly declared views. Empty during SSR/hydration. */
export function useSpatialViews(): readonly SpatialViewRecord[] {
  const registry = useSpatialRegistry();
  return useSyncExternalStore(
    useCallback(
      (listener: SpatialRegistryListener) => registry.subscribeViews(listener),
      [registry],
    ),
    useCallback(() => registry.views(), [registry]),
    getServerViews,
  );
}

/**
 * Items registered in the current workspace, in registration order.
 *
 * Returns an empty list during server rendering and hydration.
 */
export function useSpatialItems(): readonly SpatialItemRecord[] {
  const registry = useSpatialRegistry();
  const getSnapshot = useCallback(() => registry.list(), [registry]);
  return useSyncExternalStore(
    useSubscribe(registry),
    getSnapshot,
    getServerItems,
  );
}

/**
 * The item registered under `id` in the current workspace, if any.
 *
 * Returns `undefined` during server rendering and hydration.
 */
export function useSpatialItem(
  id: SpatialItemId,
): SpatialItemRecord | undefined {
  const registry = useSpatialRegistry();
  const getSnapshot = useCallback(() => registry.get(id), [registry, id]);
  return useSyncExternalStore(
    useSubscribe(registry),
    getSnapshot,
    getServerItem,
  );
}

// A stable subscribe function keeps useSyncExternalStore from resubscribing
// on every render.
function useSubscribe(registry: SpatialRegistry) {
  return useCallback(
    (listener: SpatialRegistryListener) => registry.subscribe(listener),
    [registry],
  );
}
