import { useState, type ReactNode } from "react";
import type { HostModule } from "../contracts/xrHost";
import { Dashboard, LabStoreContext, type LabStore } from "../fixtures";
import type {
  IntegrationModule,
  LabIntegration,
} from "../integrations/contract";
import { XRControls } from "./XRControls";
import { StrategyControls } from "./StrategyControls";

export interface LabShellProps {
  integration: IntegrationModule;
  host: HostModule;
  store: LabStore;
  /** Status of the development emulator, shown in the workspace. */
  emulator: string;
  header?: ReactNode;
}

/**
 * Lays out the original dashboard and the spatial workspace. The same shell
 * and fixture are used for every engine and integration; only `host` and
 * `integration` change.
 */
export function LabShell({
  integration,
  host,
  store,
  emulator,
  header,
}: LabShellProps) {
  const { Provider } = integration;
  return (
    <LabStoreContext value={store}>
      <Provider>
        <ShellLayout
          integration={integration}
          host={host}
          emulator={emulator}
          header={header}
        />
      </Provider>
    </LabStoreContext>
  );
}

function ShellLayout({
  integration,
  host,
  emulator,
  header,
}: {
  integration: IntegrationModule;
  host: HostModule;
  emulator: string;
  header: ReactNode;
}) {
  const lab: LabIntegration = integration.useIntegration();
  // Unmounting the workspace disposes the host's engine, scene and render
  // loop; used to check resource cleanup.
  const [workspaceMounted, setWorkspaceMounted] = useState(true);
  const { Host } = host;

  return (
    <div
      className="lab"
      data-integration={integration.id}
      data-engine={host.id}
    >
      <header className="lab-header">{header}</header>
      <div className="lab-columns">
        <div className="lab-left">
          {lab.detach && <StrategyControls lab={lab} />}
          <Dashboard
            {...(lab.renderWidget && { renderWidget: lab.renderWidget })}
          />
          <XRControls lab={lab} />
        </div>
        <div className="lab-right">
          <div className="workspace-bar">
            <button
              type="button"
              onClick={() => setWorkspaceMounted((mounted) => !mounted)}
            >
              {workspaceMounted ? "Unmount workspace" : "Mount workspace"}
            </button>
            <span className="hint" data-testid="xr-emulator">
              Emulator: {emulator}
            </span>
          </div>
          {workspaceMounted && (
            <Host
              {...(lab.actionOwners && { actionOwners: lab.actionOwners })}
              panels={lab.panels}
              onPanelButton={lab.onPanelButton}
              onPanelSelect={lab.onPanelSelect}
              onPanelClose={lab.onPanelClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
