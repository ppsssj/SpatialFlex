import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { GalleryThemeContext } from "./GalleryTheme";

// Lifecycle diagnostics kept outside React, so they survive remounts and
// reveal them. In development StrictMode, React mounts effects twice on
// purpose, so the baseline is 2 mounts / 1 unmount.
const lifecycle = { mounts: 0, unmounts: 0 };
let snapshot = { ...lifecycle };
const listeners = new Set<() => void>();
function record(change: Partial<typeof lifecycle>) {
  Object.assign(lifecycle, change);
  snapshot = { ...lifecycle };
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => snapshot;

let nextInstance = 0;

/**
 * Small interactive component for checking that detach/attach keeps React
 * local state, event handlers and context.
 */
export function LiveCounter() {
  // Assigned once per component instance; a remount shows a new number.
  const [instance] = useState(() => ++nextInstance);
  const [count, setCount] = useState(0);
  const theme = useContext(GalleryThemeContext);
  const { mounts, unmounts } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  useEffect(() => {
    record({ mounts: lifecycle.mounts + 1 });
    return () => record({ unmounts: lifecycle.unmounts + 1 });
  }, []);

  return (
    <div className="live-counter" data-testid="live-counter">
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        Local count: <output data-testid="count">{count}</output>
      </button>
      <dl>
        <dt>Theme (context)</dt>
        <dd data-testid="theme">{theme}</dd>
        <dt>Instance</dt>
        <dd data-testid="instance">#{instance}</dd>
        <dt>Mounts / unmounts</dt>
        <dd data-testid="lifecycle">
          {mounts} / {unmounts}
        </dd>
      </dl>
    </div>
  );
}
