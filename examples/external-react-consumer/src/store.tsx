import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/** The application's own state: SpatialFlex never keeps a copy of it. */
export interface OpsState {
  readonly incidents: number;
  readonly throughput: readonly number[];
}

export interface OpsStore {
  getState(): OpsState;
  subscribe(listener: () => void): () => void;
  readonly actions: {
    reportIncident(): void;
    resolveIncident(): void;
    recordSample(): void;
  };
  /** Instrumentation shown in the UI: subscriptions and component mounts. */
  diagnostics(): {
    activeSubscriptions: number;
    totalSubscribes: number;
    actionCalls: number;
    mounts: Readonly<Record<string, number>>;
  };
  componentMounted(id: string): void;
  subscribeDiagnostics(listener: () => void): () => void;
}

const SAMPLES = [42, 48, 45, 51, 49, 55, 53, 58];

export function createOpsStore(): OpsStore {
  let state: OpsState = { incidents: 3, throughput: SAMPLES };
  const listeners = new Set<() => void>();
  const diagnosticListeners = new Set<() => void>();
  const counts = {
    totalSubscribes: 0,
    actionCalls: 0,
    mounts: {} as Record<string, number>,
  };
  let snapshot = take();
  function take() {
    return {
      activeSubscriptions: listeners.size,
      totalSubscribes: counts.totalSubscribes,
      actionCalls: counts.actionCalls,
      mounts: { ...counts.mounts },
    };
  }
  const changed = () => {
    snapshot = take();
    for (const listener of [...diagnosticListeners]) listener();
  };
  const run = (next: OpsState) => {
    counts.actionCalls++;
    state = next;
    for (const listener of [...listeners]) listener();
    changed();
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      counts.totalSubscribes++;
      changed();
      return () => {
        if (listeners.delete(listener)) changed();
      };
    },
    actions: {
      reportIncident: () => run({ ...state, incidents: state.incidents + 1 }),
      resolveIncident: () =>
        run({ ...state, incidents: Math.max(0, state.incidents - 1) }),
      recordSample: () => {
        const last = state.throughput.at(-1) ?? 50;
        const next = 30 + ((last * 7 + 13) % 40);
        run({ ...state, throughput: [...state.throughput, next].slice(-12) });
      },
    },
    diagnostics: () => snapshot,
    componentMounted(id) {
      counts.mounts[id] = (counts.mounts[id] ?? 0) + 1;
      changed();
    },
    subscribeDiagnostics(listener) {
      diagnosticListeners.add(listener);
      return () => diagnosticListeners.delete(listener);
    },
  };
}

const OpsContext = createContext<OpsStore | null>(null);
/** A plain application Context value, read inside extracted components. */
export const RegionContext = createContext("eu-west (Dublin)");

export function OpsProvider({
  store,
  children,
}: {
  store: OpsStore;
  children: ReactNode;
}) {
  return <OpsContext value={store}>{children}</OpsContext>;
}

export function useOpsStore() {
  const store = useContext(OpsContext);
  if (!store) throw new Error("Missing <OpsProvider>");
  return store;
}

export function useOps<T>(select: (state: OpsState) => T): T {
  const store = useOpsStore();
  const get = () => select(store.getState());
  return useSyncExternalStore(store.subscribe, get, get);
}

export function useDiagnostics() {
  const store = useOpsStore();
  return useSyncExternalStore(
    store.subscribeDiagnostics,
    store.diagnostics,
    store.diagnostics,
  );
}

/** Counts React effect mounts of a component (remounts would show here). */
export function useMountCount(id: string) {
  const store = useOpsStore();
  useEffect(() => store.componentMounted(id), [store, id]);
}
