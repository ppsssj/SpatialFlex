import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { EngineId, HostModule } from "./contracts/xrHost";
import { setupEmulator } from "./devtools/emulator";
import { createLabStore } from "./fixtures";
import type { IntegrationId, IntegrationModule } from "./integrations/contract";
import { LabShell } from "./shell/LabShell";
import "./styles.css";

// Every engine and integration is a separate chunk: only the selected engine
// is downloaded, and baseline mode never loads SpatialFlex.
const engines: Record<EngineId, () => Promise<HostModule>> = {
  three: () => import("./hosts/three/three-host").then((m) => m.threeHost),
  babylon: () =>
    import("./hosts/babylon/babylon-host").then((m) => m.babylonHost),
};
const integrations: Record<IntegrationId, () => Promise<IntegrationModule>> = {
  baseline: () =>
    import("./integrations/baseline").then((m) => m.baselineIntegration),
  spatialflex: () =>
    import("./integrations/spatialflex").then((m) => m.spatialflexIntegration),
};

const params = new URLSearchParams(window.location.search);
const engine: EngineId =
  params.get("engine") === "babylon" ? "babylon" : "three";
const mode: IntegrationId =
  params.get("integration") === "spatialflex" ? "spatialflex" : "baseline";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// The emulator, if requested, must be the WebXR runtime before a host loads.
const emulator = await setupEmulator(window.location.search);
const [host, integration] = await Promise.all([
  params.get("bridge") === "iframe"
    ? import("./bridge/IframeHost").then((m) => m.iframeHost(engine))
    : engines[engine](),
  integrations[mode](),
]);
const store = createLabStore();

const link = (key: string, value: string) => {
  const next = new URLSearchParams(window.location.search);
  next.set(key, value);
  return `?${next}`;
};

createRoot(root).render(
  <StrictMode>
    <LabShell
      integration={integration}
      host={host}
      store={store}
      emulator={emulator.detail}
      surface={params.get("surface") === "website"}
      fixture={
        params.get("fixture") === "hardening" ? "hardening" : "dashboard"
      }
      header={
        <>
          <h1>SpatialFlex XR Lab</h1>
          <p className="hint">
            <a
              href={link(
                "bridge",
                params.get("bridge") === "iframe" ? "off" : "iframe",
              )}
            >
              {params.get("bridge") === "iframe"
                ? "Use same-context Host"
                : "Use cross-context iframe Host"}
            </a>
            {" · "}
            Neutral WebXR test environment. Engine:{" "}
            <strong data-testid="engine-id">{host.id}</strong> (
            <a href={link("engine", engine === "three" ? "babylon" : "three")}>
              switch to {engine === "three" ? "babylon" : "three"}
            </a>
            ) · Integration:{" "}
            <strong data-testid="integration-mode">{integration.id}</strong> (
            <a
              href={link(
                "integration",
                mode === "baseline" ? "spatialflex" : "baseline",
              )}
            >
              switch to {mode === "baseline" ? "spatialflex" : "baseline"}
            </a>
            )
          </p>
        </>
      }
    />
  </StrictMode>,
);
