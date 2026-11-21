import { it } from "vitest";
import { performance } from "node:perf_hooks";
import { resolveVisibility, type DepthPlane } from "./depthResolver.js";
it.skipIf(!process.env.DEPTH_BENCH)(
  "reports planar resolver timing",
  () => {
    for (const mode of ["separate", "overlap", "cross"] as const)
      for (const n of [1, 2, 5, 10, 20]) {
        const planes: DepthPlane[] = Array.from({ length: n }, (_, i) => {
          const angle = mode === "cross" ? (i % 2 ? 0.2 : -0.2) : 0;
          return {
            key: String(i).padStart(2, "0"),
            geometry: {
              resolution: { width: 100, height: 100 },
              metersPerPixel: 0.01,
              pose: {
                position: [
                  mode === "separate" ? i * 2 : i * 0.03,
                  0,
                  -2 - i * 0.04,
                ],
                rotation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)],
                scale: 1,
              },
            },
          };
        });
        const times: number[] = [];
        let pieces = 0,
          vertices = 0;
        for (let iteration = 0; iteration < 25; iteration++) {
          const t = performance.now();
          let ps = 0,
            vs = 0;
          for (const plane of planes) {
            const result = resolveVisibility(plane, planes, [0, 0, 0]);
            ps += result.pieces.length;
            vs += result.pieces.reduce((a, p) => a + p.length, 0);
          }
          const elapsed = performance.now() - t;
          if (iteration >= 5) times.push(elapsed);
          pieces = ps;
          vertices = vs;
        }
        times.sort((a, b) => a - b);
        console.log(
          JSON.stringify({
            mode,
            n,
            median_ms: times[10],
            p95_ms: times[18],
            pieces,
            vertices,
          }),
        );
      }
  },
  60000,
);
