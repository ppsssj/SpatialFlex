import { createContext, useContext, useSyncExternalStore } from "react";
import type { LabDiagnostics, LabState, LabStore } from "./labStore";

export const LabStoreContext = createContext<LabStore | null>(null);

export function useLabStore(): LabStore {
  const store = useContext(LabStoreContext);
  if (!store) throw new Error("Missing <LabStoreContext>");
  return store;
}

/**
 * Subscribes to the part of the state returned by `select`. `select` must
 * return a stable value for unchanged state (a primitive or an object taken
 * from the state as is).
 */
export function useLabState<T>(select: (state: LabState) => T): T {
  const store = useLabStore();
  const getSnapshot = () => select(store.getState());
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function useLabDiagnostics(): LabDiagnostics {
  const store = useLabStore();
  return useSyncExternalStore(
    store.subscribeDiagnostics,
    store.getDiagnostics,
    store.getDiagnostics,
  );
}
