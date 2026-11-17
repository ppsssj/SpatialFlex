/**
 * Application-owned domain store for the playground.
 *
 * It stands for the original application's state and business actions.
 * SpatialFlex never sees it: detached SpatialItems read and change it
 * through the same React context and actions as the rest of the app.
 *
 * The diagnostics exist only to prove, in tests and in the browser, that
 * detaching does not duplicate subscriptions or action handling.
 */

export type ImageVariant = "sunrise" | "night" | "mono";

export interface GalleryState {
  readonly sharedCount: number;
  readonly imageB: {
    readonly variant: ImageVariant;
    readonly caption: string;
  };
}

export interface GalleryActions {
  increment(): void;
  setImageVariant(variant: ImageVariant): void;
  setImageCaption(caption: string): void;
}

export interface GalleryDiagnostics {
  /** Calls per domain action. */
  readonly actionCalls: Readonly<Record<keyof GalleryActions, number>>;
  /** Listeners currently subscribed to the state. */
  readonly activeSubscriptions: number;
  readonly totalSubscribes: number;
  readonly totalUnsubscribes: number;
}

export interface GalleryStore {
  getState(): GalleryState;
  subscribe(listener: () => void): () => void;
  readonly actions: GalleryActions;
  getDiagnostics(): GalleryDiagnostics;
  /** Listeners here are not counted as state subscriptions. */
  subscribeDiagnostics(listener: () => void): () => void;
}

export const INITIAL_GALLERY_STATE: GalleryState = {
  sharedCount: 0,
  imageB: { variant: "sunrise", caption: "Image B" },
};

export function createGalleryStore(
  initialState: GalleryState = INITIAL_GALLERY_STATE,
): GalleryStore {
  let state = initialState;
  const listeners = new Set<() => void>();
  const diagnosticListeners = new Set<() => void>();
  const counts = {
    actionCalls: { increment: 0, setImageVariant: 0, setImageCaption: 0 },
    totalSubscribes: 0,
    totalUnsubscribes: 0,
  };
  let diagnostics = snapshotDiagnostics();

  function snapshotDiagnostics(): GalleryDiagnostics {
    return Object.freeze({
      actionCalls: Object.freeze({ ...counts.actionCalls }),
      activeSubscriptions: listeners.size,
      totalSubscribes: counts.totalSubscribes,
      totalUnsubscribes: counts.totalUnsubscribes,
    });
  }

  function diagnosticsChanged() {
    diagnostics = snapshotDiagnostics();
    for (const listener of [...diagnosticListeners]) listener();
  }

  function run(action: keyof GalleryActions, next: GalleryState) {
    counts.actionCalls[action]++;
    if (next !== state) {
      state = next;
      for (const listener of [...listeners]) listener();
    }
    diagnosticsChanged();
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      counts.totalSubscribes++;
      diagnosticsChanged();
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
        counts.totalUnsubscribes++;
        diagnosticsChanged();
      };
    },

    actions: {
      increment() {
        run("increment", { ...state, sharedCount: state.sharedCount + 1 });
      },
      setImageVariant(variant) {
        run(
          "setImageVariant",
          variant === state.imageB.variant
            ? state
            : { ...state, imageB: { ...state.imageB, variant } },
        );
      },
      setImageCaption(caption) {
        run(
          "setImageCaption",
          caption === state.imageB.caption
            ? state
            : { ...state, imageB: { ...state.imageB, caption } },
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
