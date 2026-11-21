/**
 * P1-08A2 research: one log of what the browser actually did.
 *
 * - `dispatch`: the real DOM target of trusted pointer/keyboard events,
 *   captured at `window` (capture phase) before any app code runs.
 * - `handler`: React handlers that ran, with the Surface incarnation that
 *   owned them.
 * - `lifecycle`: React mounts and unmounts per Surface incarnation.
 *
 * Tests read this log; nothing here dispatches or simulates events.
 */
export interface DispatchRecord {
  readonly type: string;
  readonly target: string;
  readonly trusted: boolean;
  readonly x: number;
  readonly y: number;
  /** performance.now() when the capture listener ran. */
  readonly t: number;
  /** The event's own timeStamp (input time); t - timeStamp = queueing delay. */
  readonly timeStamp: number;
}
export interface HandlerRecord {
  readonly surface: string;
  readonly epoch: number;
  readonly control: string;
  readonly t: number;
}
export interface LifecycleRecord {
  readonly surface: string;
  readonly epoch: number;
  readonly kind: "mount" | "unmount";
  readonly t: number;
}

export const log = {
  dispatch: [] as DispatchRecord[],
  handler: [] as HandlerRecord[],
  lifecycle: [] as LifecycleRecord[],
};

/** Nearest ancestor-or-self id (the Surface host ids are `surface-A`, ...). */
export function targetId(node: EventTarget | null): string {
  let el = node instanceof Element ? node : null;
  while (el && !el.id) el = el.parentElement;
  return el?.id ?? "(none)";
}

export function recordHandler(surface: string, epoch: number, control: string) {
  log.handler.push({ surface, epoch, control, t: performance.now() });
}

export function recordLifecycle(
  surface: string,
  epoch: number,
  kind: "mount" | "unmount",
) {
  log.lifecycle.push({ surface, epoch, kind, t: performance.now() });
}

const TYPES = [
  "pointerdown",
  "pointerup",
  "click",
  "keydown",
  "focusin",
] as const;

export function installDispatchRecorder(): () => void {
  const on = (e: Event) => {
    const p = e as PointerEvent;
    log.dispatch.push({
      type: e.type,
      target: targetId(e.target),
      trusted: e.isTrusted,
      x: p.clientX ?? 0,
      y: p.clientY ?? 0,
      t: performance.now(),
      timeStamp: e.timeStamp,
    });
  };
  for (const type of TYPES) window.addEventListener(type, on, true);
  return () => {
    for (const type of TYPES) window.removeEventListener(type, on, true);
  };
}

export function clearLog() {
  log.dispatch.length = 0;
  log.handler.length = 0;
}
