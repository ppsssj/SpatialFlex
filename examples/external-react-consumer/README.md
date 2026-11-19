# External React consumer (P1-07B)

An operations monitoring dashboard: an ordinary React + TypeScript + Vite application with MUI, Recharts and a Context store. It integrates SpatialFlex **only through package entry points** (`@spatialflex/core`, `@spatialflex/dom`, `@spatialflex/react`). It imports nothing from `apps/xr-lab`, and its Vite config has no aliases or `source` condition.

```bash
pnpm -r --filter "./packages/*" build   # the app resolves the SDK's dist
pnpm --filter external-react-consumer dev
pnpm --filter external-react-consumer test:e2e   # E1–E5, Chromium and Firefox
pnpm smoke:pack                          # packed tarballs, installed outside the workspace
```

- **SpatialFlex code in the app:**
  - `SpatialItem` wrappers in `src/widgets/Widgets.tsx`.
  - The glue hook `src/spatial/useSpatialRuntime.ts`.
  - The renderer adapter `src/spatial/SpatialView.tsx`. It reports camera frames and rays, and draws XR Adaptive panels.
- **Try it:**
  1. Select **Open incidents**, then choose **Extract as Native DOM**. The original component appears in the 3D view.
  2. Drag its title bar, ⟲ handle or corner to move, turn or resize it.
  3. Its buttons still work.
  4. **Region status** is refused: it sits in a `will-change: transform` carousel.

See [docs/p1-07b-external-react-integration.md](../../docs/p1-07b-external-react-integration.md).
