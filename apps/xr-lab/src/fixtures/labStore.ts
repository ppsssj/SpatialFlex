/**
 * Application fixture: the web app's own state and business actions.
 *
 * Identical for every integration mode, and the single source of truth for
 * domain state. Neither the XR host nor an integration keeps a copy of it.
 */

export type ImageVariant = "sunrise" | "night" | "mono";

export interface LabState {
  readonly sharedCount: number;
  /** Domain actions processed by the app. */
  readonly actionCount: number;
  /** Recent `sharedCount` values, for the chart. */
  readonly history: readonly number[];
  readonly imageVariant: ImageVariant;
  /** Whether the dashboard currently shows the image widget. */
  readonly imageMounted: boolean;
  /** Manual baseline lifecycle accounting; SpatialFlex uses actual registrations. */
  readonly imageEpoch: number;
  readonly thermostatMounted: boolean;
  readonly thermostatEpoch: number;
  readonly temperature: number;
  readonly heatStep: number;
}

export interface LabActions {
  increment(): void;
  setImageVariant(variant: ImageVariant): void;
  setImageMounted(mounted: boolean): void;
  heat(step: number): void;
  setHeatStep(step: number): void;
  setThermostatMounted(mounted: boolean): void;
}

export interface LabDiagnostics {
  readonly componentMounts: Readonly<Record<string, number>>;
  readonly activeComponents: Readonly<Record<string, number>>;
  readonly actionCalls: Readonly<Record<keyof LabActions, number>>;
  readonly activeSubscriptions: number;
  readonly totalSubscribes: number;
  readonly totalUnsubscribes: number;
  /** `performance.now()` of the last `increment()`. */
  readonly lastIncrementAt: number | null;
}

export interface LabStore {
  /** Demo diagnostics only; does not register another application subscription. */
  componentMounted(id: string): () => void;
  getState(): LabState;
  subscribe(listener: () => void): () => void;
  readonly actions: LabActions;
  getDiagnostics(): LabDiagnostics;
  /** Listeners here are not counted as state subscriptions. */
  subscribeDiagnostics(listener: () => void): () => void;
}

export const HISTORY_LENGTH = 8;

export const INITIAL_LAB_STATE: LabState = {
  sharedCount: 0,
  actionCount: 0,
  history: [0],
  imageVariant: "sunrise",
  imageMounted: true,
  imageEpoch: 1,
  thermostatMounted: false,
  thermostatEpoch: 0,
  temperature: 20,
  heatStep: 1,
};

export function createLabStore(
  initial: LabState = INITIAL_LAB_STATE,
): LabStore {
  let state = initial;
  const listeners = new Set<() => void>();
  const diagnosticListeners = new Set<() => void>();
  const counts = {
    componentMounts: {} as Record<string, number>,
    activeComponents: {} as Record<string, number>,
    actionCalls: {
      increment: 0,
      setImageVariant: 0,
      setImageMounted: 0,
      heat: 0,
      setHeatStep: 0,
      setThermostatMounted: 0,
    },
    totalSubscribes: 0,
    totalUnsubscribes: 0,
    lastIncrementAt: null as number | null,
  };
  let diagnostics = snapshot();

  function snapshot(): LabDiagnostics {
    return Object.freeze({
      componentMounts: Object.freeze({ ...counts.componentMounts }),
      activeComponents: Object.freeze({ ...counts.activeComponents }),
      actionCalls: Object.freeze({ ...counts.actionCalls }),
      activeSubscriptions: listeners.size,
      totalSubscribes: counts.totalSubscribes,
      totalUnsubscribes: counts.totalUnsubscribes,
      lastIncrementAt: counts.lastIncrementAt,
    });
  }
  function diagnosticsChanged() {
    diagnostics = snapshot();
    for (const listener of [...diagnosticListeners]) listener();
  }
  function run(action: keyof LabActions, next: LabState) {
    counts.actionCalls[action]++;
    if (next !== state) {
      state = next;
      for (const listener of [...listeners]) listener();
    }
    diagnosticsChanged();
  }

  return {
    componentMounted(id) {
      counts.componentMounts[id] = (counts.componentMounts[id] ?? 0) + 1;
      counts.activeComponents[id] = (counts.activeComponents[id] ?? 0) + 1;
      diagnosticsChanged();
      return () => {
        counts.activeComponents[id]!--;
        diagnosticsChanged();
      };
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      counts.totalSubscribes++;
      diagnosticsChanged();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        counts.totalUnsubscribes++;
        diagnosticsChanged();
      };
    },
    actions: {
      increment() {
        counts.lastIncrementAt = performance.now();
        const sharedCount = state.sharedCount + 1;
        run("increment", {
          ...state,
          sharedCount,
          actionCount: state.actionCount + 1,
          history: [...state.history, sharedCount].slice(-HISTORY_LENGTH),
        });
      },
      setImageVariant(imageVariant) {
        run(
          "setImageVariant",
          imageVariant === state.imageVariant
            ? state
            : { ...state, imageVariant },
        );
      },
      setImageMounted(imageMounted) {
        run(
          "setImageMounted",
          imageMounted === state.imageMounted
            ? state
            : {
                ...state,
                imageMounted,
                imageEpoch: state.imageEpoch + (imageMounted ? 1 : 0),
              },
        );
      },
      heat(step) {
        run("heat", { ...state, temperature: state.temperature + step });
      },
      setHeatStep(heatStep) {
        run("setHeatStep", { ...state, heatStep });
      },
      setThermostatMounted(thermostatMounted) {
        run(
          "setThermostatMounted",
          thermostatMounted === state.thermostatMounted
            ? state
            : {
                ...state,
                thermostatMounted,
                thermostatEpoch:
                  state.thermostatEpoch + (thermostatMounted ? 1 : 0),
              },
        );
      },
    },
    getDiagnostics: () => diagnostics,
    subscribeDiagnostics(listener) {
      diagnosticListeners.add(listener);
      return () => {
        diagnosticListeners.delete(listener);
      };
    },
  };
}
