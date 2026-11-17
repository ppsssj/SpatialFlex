import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createLabXRStore, readEmulatorMode } from "./devtools/xrRuntime";
import { createLabStore } from "./fixtures";
import type { IntegrationId, IntegrationModule } from "./integrations/contract";
import { LabShell } from "./shell/LabShell";
import "./styles.css";

// Each integration is a separate chunk: baseline mode never loads SpatialFlex.
const loaders: Record<IntegrationId, () => Promise<IntegrationModule>> = {
  baseline: () =>
    import("./integrations/baseline").then((m) => m.baselineIntegration),
  spatialflex: () =>
    import("./integrations/spatialflex").then((m) => m.spatialflexIntegration),
};

const params = new URLSearchParams(window.location.search);
const mode: IntegrationId =
  params.get("integration") === "spatialflex" ? "spatialflex" : "baseline";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const integration = await loaders[mode]();
const store = createLabStore();
const xrStore = createLabXRStore(readEmulatorMode(window.location.search));

const link = (target: IntegrationId) => {
  const next = new URLSearchParams(window.location.search);
  next.set("integration", target);
  return `?${next}`;
};

createRoot(root).render(
  <StrictMode>
    <LabShell
      integration={integration}
      store={store}
      xrStore={xrStore}
      header={
        <>
          <h1>SpatialFlex XR Lab</h1>
          <p className="hint">
            Neutral WebXR test environment. Integration:{" "}
            <strong data-testid="integration-mode">{integration.id}</strong> (
            {mode === "baseline" ? (
              <a href={link("spatialflex")}>switch to spatialflex</a>
            ) : (
              <a href={link("baseline")}>switch to baseline</a>
            )}
            )
          </p>
        </>
      }
    />
  </StrictMode>,
);
