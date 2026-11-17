import { createContext, useContext, useSyncExternalStore } from "react";
import type {
  GalleryDiagnostics,
  GalleryState,
  GalleryStore,
} from "./galleryStore";

/** Delivers the application-owned store to the whole tree, detached items included. */
export const GalleryStoreContext = createContext<GalleryStore | null>(null);

export function useGalleryStore(): GalleryStore {
  const store = useContext(GalleryStoreContext);
  if (!store) throw new Error("Missing <GalleryStoreContext>");
  return store;
}

/**
 * Subscribes to the part of the domain state returned by `select`.
 *
 * `select` must return a stable value for unchanged state: a primitive or an
 * object taken from the state as is (the store replaces objects on change).
 * Returning a newly allocated object breaks `useSyncExternalStore`.
 */
export function useGalleryState<T>(select: (state: GalleryState) => T): T {
  const store = useGalleryStore();
  const getSnapshot = () => select(store.getState());
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function useGalleryDiagnostics(): GalleryDiagnostics {
  const store = useGalleryStore();
  return useSyncExternalStore(
    store.subscribeDiagnostics,
    store.getDiagnostics,
    store.getDiagnostics,
  );
}
