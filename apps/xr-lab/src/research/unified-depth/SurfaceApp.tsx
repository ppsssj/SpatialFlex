/**
 * P1-08A2 research: the content of one Surface. Each Surface is a separate
 * React root (`createRoot`) with its own state; nothing is shared or
 * duplicated between A and B. The layout (CSS px of a 400×300 page):
 *
 *   0–40    header (non-interactive text on the page background)
 *   50–140  two buttons `<id>-left` / `<id>-right` with click counters
 *   150–190 a controlled text input `<id>-input`
 *   195–225 a live value `<id>-value` (10 Hz ticker when enabled)
 *   230–300 empty page background (no control), u < 240
 *
 * plus A's extractable Native element `A-native` (a card with a button),
 * whose page slot is u 250–390, v 205–295 until it is extracted.
 * Every control reports React handler calls to `recordHandler`; the actual
 * DOM dispatch target is recorded by the lab's capture listeners.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { recordHandler, recordLifecycle } from "./events.js";

export const SURFACE_COLORS = {
  A: {
    bg: "#dc3c3c",
    left: "#a00000",
    right: "#ff8a8a",
    input: "#ffd2d2",
    native: "#f0c828",
  },
  B: {
    bg: "#3c5adc",
    left: "#0000a0",
    right: "#8a8aff",
    input: "#d2dcff",
    native: "#28c8c8",
  },
} as const;

export interface SurfaceAppProps {
  readonly id: "A" | "B";
  /** Epoch of the Surface incarnation (SurfaceRef.epoch). */
  readonly epoch: number;
  /** 10 Hz content updates (S8). */
  readonly ticking?: boolean;
  /** Where the Native element is rendered: in its page slot, or extracted
   *  (still in this React tree; the track positions it). */
  readonly nativeExtracted?: boolean;
  /** Marks the Native card drawable (HTML-in-Canvas track). */
  readonly nativeDrawable?: boolean;
  /** Layout position (u) of the extracted Native card in the page. The DOM
   *  track places it from the page origin (0); the HTML-in-Canvas track
   *  moves its layout box outside the page (see NATIVE_LAYOUT_LEFT). */
  readonly nativeLayoutLeft?: number;
}

const abs = (
  left: number,
  top: number,
  width: number,
  height: number,
): CSSProperties => ({
  position: "absolute",
  left,
  top,
  width,
  height,
  boxSizing: "border-box",
  margin: 0,
});

export function SurfaceApp({
  id,
  epoch,
  ticking = false,
  nativeExtracted = false,
  nativeDrawable = false,
  nativeLayoutLeft = 0,
}: SurfaceAppProps) {
  const colors = SURFACE_COLORS[id];
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  const [nativeClicks, setNativeClicks] = useState(0);
  const [text, setText] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    recordLifecycle(id, epoch, "mount");
    return () => recordLifecycle(id, epoch, "unmount");
  }, [id, epoch]);

  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(timer);
  }, [ticking]);

  const button = (which: "left" | "right"): CSSProperties => ({
    ...abs(which === "left" ? 0 : 205, 50, 195, 90),
    background: colors[which],
    border: 0,
    color: "#000",
    font: "16px sans-serif",
    cursor: "pointer",
    // Avoid UA focus rings changing the captured pixels between probes.
    outline: "none",
  });

  return (
    <>
      <div
        data-role="header"
        style={{
          ...abs(10, 8, 380, 28),
          font: "bold 16px sans-serif",
          color: "#fff",
          pointerEvents: "none",
        }}
      >
        Surface {id} · epoch {epoch}
      </div>
      <button
        id={`${id}-left`}
        type="button"
        style={button("left")}
        onClick={() => {
          setLeft((n) => n + 1);
          recordHandler(id, epoch, `${id}-left`);
        }}
      >
        L {left}
      </button>
      <button
        id={`${id}-right`}
        type="button"
        style={button("right")}
        onClick={() => {
          setRight((n) => n + 1);
          recordHandler(id, epoch, `${id}-right`);
        }}
      >
        R {right}
      </button>
      <input
        id={`${id}-input`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          recordHandler(id, epoch, `${id}-input`);
        }}
        style={{
          ...abs(10, 150, 380, 40),
          font: "16px monospace",
          background: colors.input,
          color: "#000",
          border: 0,
          outline: "none",
          padding: "0 8px",
        }}
      />
      <div
        id={`${id}-value`}
        data-tick={tick}
        style={{
          ...abs(10, 195, 230, 30),
          font: "16px monospace",
          color: "#fff",
          pointerEvents: "none",
        }}
      >
        tick {tick}
      </div>
      <div
        id={`${id}-native`}
        {...(nativeDrawable ? { drawable: "" } : {})}
        data-extracted={nativeExtracted ? "true" : "false"}
        style={{
          ...abs(250, 205, 140, 90),
          ...(nativeExtracted ? { left: nativeLayoutLeft, top: 0 } : {}),
          background: colors.native,
          visibility: id === "A" ? "visible" : "hidden",
          display: id === "A" ? "block" : "none",
        }}
      >
        <button
          id={`${id}-native-btn`}
          type="button"
          style={{
            ...abs(10, 10, 120, 70),
            background: colors.native,
            border: "4px solid #000",
            font: "14px sans-serif",
            outline: "none",
          }}
          onClick={() => {
            setNativeClicks((n) => n + 1);
            recordHandler(id, epoch, `${id}-native-btn`);
          }}
        >
          N {nativeClicks}
        </button>
      </div>
    </>
  );
}
