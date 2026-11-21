# P1-08A2 evidence: unified depth compositing feasibility

These files come from the research page `apps/xr-lab/research-depth.html`
(source: `apps/xr-lab/src/research/unified-depth/`). Viewport: 1000 × 700.
Browsers: Playwright Chromium 159.0.8154.6 and Firefox 159.0.

```bash
cd apps/xr-lab
# Correctness evidence (40 px probe grid). Writes results-*.json and the screenshots.
P1_08A2_EVIDENCE=1 npx playwright test e2e/unified-depth.spec.ts
# Performance (opt-in; never part of CI). Writes perf-*.json.
pnpm research:depth                  # headless (Chromium: SwiftShader)
BENCH_HEADED=1 pnpm research:depth   # headed (Chromium: hardware GPU)
node scripts/summarize-p1-08a2-results.mjs
node scripts/summarize-p1-08a2-perf.mjs
```

The normal E2E run (without `P1_08A2_EVIDENCE`) writes only to
`test-results/`, so this directory is never overwritten by accident.

## Files

### `results-<browser>.json`

One record per test:

- capability detection;
- per probe run:
  - safe probe count;
  - mismatch counts (depth≠visual, visual≠click, click, efp≠down);
  - every mismatching probe, with the expected owner and target, the painted
    owner, the `elementFromPoint` result, and the real pointerdown and click
    targets;
  - track statistics;
- the keyboard and selection, A5, S7/S9 and S8 results.

### `perf-<browser>-<headless|headed>.json`

The benchmark runs, 3 per configuration.

### `s<scenario>-<track>-<mode>-<browser>.png`

The scene before probing.

- S3 is the X crossing; both sides of the intersection are visible in each
  screenshot.
- Tracks:
  - `hic`: raw WebGL + HTML-in-Canvas.
  - `dom`: DOM compositor (`order` = ADR 0002 baseline, `split` = depth
    regions).
  - `three-stock`, `three-adapter`.
  - `babylon`.

Firefox has no HTML-in-Canvas, so it has no `hic` or `three-adapter`
screenshots. Its `three-stock` screenshot shows the same black planes as
Chromium.

## Colors

| Color | Meaning |
| --- | --- |
| red | Surface A (background, buttons in dark and light red, input in pink) |
| blue | Surface B |
| yellow | A's Native element |
| green | the WebGL Adaptive panel |
| grey | canvas / background |

Scenario definitions: `apps/xr-lab/src/research/unified-depth/scene.ts`.
Results and interpretation: `docs/p1-08a2-unified-depth-feasibility.md`.
