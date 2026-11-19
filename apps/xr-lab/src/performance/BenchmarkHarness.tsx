import { useEffect, useLayoutEffect, useRef } from "react";
import { getProbe } from "../contracts/hostProbe";
import { PANEL_SIZE, type Vec3 } from "../contracts/xrHost";
import {
  benchComponents,
  benchData,
  benchItemId,
} from "../fixtures/BenchmarkPage";
import type { LabIntegration } from "../integrations/contract";
import { activeCollector } from "./collector";

/**
 * P1-07C benchmark harness (benchmark mode only): the controller the
 * benchmark runner drives through `window.__spatialBench`. Presentations
 * are started and ended through the lab's own `LabIntegration` (the same
 * calls the Spatial Website UI makes), at deterministic, non-overlapping
 * world positions, so every scenario presents exactly the requested panels.
 */

/** Height of the SDK panel bar above a natively extracted element (px). */
const NATIVE_BAR = 34;
/** World width of every panel: Adaptive panels are 0.6 m; Native matches. */
const PANEL_WORLD_WIDTH = PANEL_SIZE.width;
const COLUMNS = 5;
/** The benchmark camera: looks at the panel grid from 4.4 m. */
export const BENCH_CAMERA = {
  position: [0, 1.42, 4] as Vec3,
  target: [0, 1.42, -0.4] as Vec3,
};
/** Deterministic camera path (W2): yaw ±0.14 rad, 240-frame period. */
export const CAMERA_PATH = { amplitude: 0.14, period: 240 } as const;

export const gridPosition = (index: number): Vec3 => [
  ((index % COLUMNS) - 2) * 0.7,
  2.35 - Math.floor(index / COLUMNS) * 0.62,
  -0.4,
];

type Kind = "native" | "adaptive";
type Rect = { left: number; top: number; right: number; bottom: number };

export function BenchmarkHarness({
  lab,
  panels,
}: {
  lab: LabIntegration;
  panels: number;
}) {
  const labRef = useRef(lab);
  useLayoutEffect(() => {
    labRef.current = lab;
  });
  useEffect(() => {
    const collector = activeCollector();
    if (!collector) return;
    const current = () => labRef.current;
    const ids = Array.from({ length: panels }, (_, i) => benchItemId(i));

    // Interaction latency: inputs that can move a pose, and the commits.
    const onInput = (event: Event) => collector.input(event.timeStamp);
    const types = ["pointerdown", "pointermove", "keydown"] as const;
    for (const type of types)
      window.addEventListener(type, onInput, { capture: true });
    const unsubscribe = current().manipulation?.subscribe(() =>
      collector.committed(),
    );

    let stopPath: (() => void) | null = null;
    const extractOne = (id: string, index: number, kind: Kind) => {
      const lab = current();
      const source = lab.sourceElement?.(id);
      const metersPerPixel = source
        ? PANEL_WORLD_WIDTH / source.offsetWidth
        : 0.00375;
      return lab.extract!(id, {
        presentation: kind,
        source: "reserved",
        position: gridPosition(index),
        rotation: [0, 0, 0],
        ...(kind === "native" && {
          metersPerPixel,
          extent: {
            width: (source?.offsetWidth ?? 160) * metersPerPixel,
            height:
              ((source?.offsetHeight ?? 100) + NATIVE_BAR) * metersPerPixel,
          },
        }),
      });
    };
    const canvasRect = (): Rect | null => {
      const canvas = document.querySelector('[data-testid="xr-canvas"]');
      const r = canvas?.getBoundingClientRect();
      return r
        ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
        : null;
    };
    const rectOf = (id: string, kind: Kind): Rect | null => {
      if (kind === "native") {
        const el = current().nativeElement?.(id);
        if (!el || el.dataset.spatialVisibility !== "visible") return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
      const pose = current().manipulation?.poseOf(id);
      if (!pose) return null;
      const probe = getProbe();
      const [x, y, z] = pose.position;
      const w = (PANEL_SIZE.width / 2) * pose.scale;
      const h = (PANEL_SIZE.height / 2) * pose.scale;
      const corners = [
        [x - w, y - h, z],
        [x + w, y - h, z],
        [x + w, y + h, z],
        [x - w, y + h, z],
      ].map((c) => probe.project(c as unknown as Vec3));
      if (corners.some((c) => !c)) return null;
      const xs = corners.map((c) => c!.x);
      const ys = corners.map((c) => c!.y);
      return {
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
      };
    };

    const bench = {
      panels,
      ids,
      grid: ids.map((_, i) => gridPosition(i)),
      extractAll(kind: Kind) {
        return ids.map((id, i) => extractOne(id, i, kind));
      },
      restoreAll() {
        return ids.map((id) => current().restore!(id));
      },
      /** Presentations by kind, as the lab reports them. */
      presentations() {
        const items = current().surfaceItems ?? [];
        const of = (kind: Kind) =>
          items.filter(
            (i) => ids.includes(i.id) && i.extraction?.presentation === kind,
          ).length;
        return {
          native: of("native"),
          adaptive: of("adaptive"),
          instances: items
            .filter((i) => ids.includes(i.id) && i.extraction)
            .map((i) => i.extraction!.presentationId ?? null),
        };
      },
      /**
       * Validity of a scenario: exactly `panels` presentations of `kind`,
       * each visible inside the canvas, none overlapping another.
       */
      validate(kind: Kind) {
        const issues: string[] = [];
        const counts = bench.presentations();
        if (counts[kind] !== panels)
          issues.push(
            `expected ${panels} ${kind} presentations, found ${counts[kind]}`,
          );
        const other = kind === "native" ? "adaptive" : "native";
        if (counts[other] !== 0)
          issues.push(`unexpected ${counts[other]} ${other} presentations`);
        if (kind === "adaptive") {
          const drawn = getProbe().panels.filter((p) => ids.includes(p));
          if (drawn.length !== panels)
            issues.push(`renderer draws ${drawn.length} of ${panels} panels`);
        }
        const canvas = canvasRect();
        const rects: [string, Rect][] = [];
        for (const id of ids) {
          const rect = rectOf(id, kind);
          if (!rect) {
            issues.push(`${id}: not visible`);
            continue;
          }
          if (
            canvas &&
            (rect.left < canvas.left - 1 ||
              rect.top < canvas.top - 1 ||
              rect.right > canvas.right + 1 ||
              rect.bottom > canvas.bottom + 1)
          )
            issues.push(`${id}: outside the canvas`);
          rects.push([id, rect]);
        }
        for (let i = 0; i < rects.length; i++)
          for (let j = i + 1; j < rects.length; j++) {
            const [a, ra] = rects[i]!;
            const [b, rb] = rects[j]!;
            const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
            const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
            if (w > 0.5 && h > 0.5) issues.push(`${a} overlaps ${b}`);
          }
        return { valid: issues.length === 0, issues, canvas, rects };
      },
      /** Resource and lifecycle state (B6, W4). */
      state() {
        const lab = current();
        const probe = getProbe();
        const marked = ids.filter((id) => {
          const el = document.querySelector<HTMLElement>(
            `[data-spatialflex-item="${id}"] [data-spatialflex-panel]`,
          );
          return (
            !!el &&
            (el.style.transform !== "" ||
              el.style.clipPath !== "" ||
              Object.keys(el.dataset).some((k) => /^spatial[A-Z]/.test(k)))
          );
        }).length;
        return {
          presentations: bench.presentations(),
          manipulationTargets: lab.manipulation?.targets().length ?? 0,
          activeSession: lab.manipulation?.getSnapshot().active !== null,
          sdkMarkedElements: marked,
          domNodes: document.getElementsByTagName("*").length,
          liveComponents: benchComponents.live,
          componentMounts: benchComponents.mounts,
          dataSubscriptions: benchData.subscriptions,
          liveTextures: probe.liveTextures,
          activeHosts: probe.activeHosts,
          drawnPanels: probe.panels.length,
        };
      },
      /** Client point of a manipulation handle of a presentation. */
      handlePoint(id: string, mode: "translate" | "rotate" | "resize") {
        const el = current().nativeElement?.(id);
        if (el) {
          const handle = el.querySelector(
            mode === "translate"
              ? '[data-spatialflex-handle="translate"][role=button]'
              : `[data-spatialflex-handle="${mode}"]`,
          );
          const r = handle?.getBoundingClientRect();
          return r
            ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
            : null;
        }
        return getProbe().locate(id, `handle:${mode}`);
      },
      pose(id: string) {
        return current().manipulation?.poseOf(id) ?? null;
      },
      setCamera(position: Vec3, target: Vec3) {
        const set = getProbe().setCamera;
        if (!set) return false;
        set(position, target);
        return true;
      },
      /** Starts (true) or stops the deterministic camera path (W2). */
      cameraPath(on: boolean) {
        stopPath?.();
        stopPath = null;
        if (!on) {
          bench.setCamera(BENCH_CAMERA.position, BENCH_CAMERA.target);
          return;
        }
        let first: number | null = null;
        const [tx, ty, tz] = BENCH_CAMERA.target;
        const radius = BENCH_CAMERA.position[2] - tz;
        stopPath = collector.onFrame((_, index) => {
          first ??= index;
          const k = index - first;
          const yaw =
            CAMERA_PATH.amplitude *
            Math.sin((2 * Math.PI * k) / CAMERA_PATH.period);
          bench.setCamera(
            [tx + radius * Math.sin(yaw), ty, tz + radius * Math.cos(yaw)],
            BENCH_CAMERA.target,
          );
        });
      },
      data: benchData,
      collector,
    };
    (window as unknown as { __spatialBench?: typeof bench }).__spatialBench =
      bench;
    return () => {
      stopPath?.();
      unsubscribe?.();
      for (const type of types)
        window.removeEventListener(type, onInput, { capture: true });
      delete (window as unknown as { __spatialBench?: unknown }).__spatialBench;
    };
  }, [panels]);
  return null;
}
