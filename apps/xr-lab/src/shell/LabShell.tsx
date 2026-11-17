import type { XRStore } from "@react-three/xr";
import type { ComponentType, ReactNode } from "react";
import { Dashboard, LabStoreContext, type LabStore } from "../fixtures";
import { XRHost, type XRHostProps } from "../host";
import type {
  IntegrationModule,
  LabIntegration,
} from "../integrations/contract";
import { XRControls } from "./XRControls";

export interface LabShellProps {
  integration: IntegrationModule;
  store: LabStore;
  xrStore: XRStore;
  /** Replaces the XR host (unit tests run without WebGL). */
  Host?: ComponentType<XRHostProps>;
  header?: ReactNode;
}

/**
 * Lays out the original dashboard and the spatial workspace. The same shell,
 * host and fixture are used for every integration; only `integration`
 * changes.
 */
export function LabShell({
  integration,
  store,
  xrStore,
  Host = XRHost,
  header,
}: LabShellProps) {
  const { Provider } = integration;
  return (
    <LabStoreContext value={store}>
      <Provider>
        <ShellLayout
          integration={integration}
          xrStore={xrStore}
          Host={Host}
          header={header}
        />
      </Provider>
    </LabStoreContext>
  );
}

function ShellLayout({
  integration,
  xrStore,
  Host,
  header,
}: {
  integration: IntegrationModule;
  xrStore: XRStore;
  Host: ComponentType<XRHostProps>;
  header: ReactNode;
}) {
  const lab: LabIntegration = integration.useIntegration();
  return (
    <div className="lab" data-integration={integration.id}>
      <header className="lab-header">{header}</header>
      <div className="lab-columns">
        <div className="lab-left">
          <Dashboard
            {...(lab.renderWidget && { renderWidget: lab.renderWidget })}
          />
          <XRControls lab={lab} />
        </div>
        <div className="lab-right">
          <Host
            store={xrStore}
            panels={lab.panels}
            onPanelButton={lab.onPanelButton}
            onPanelSelect={lab.onPanelSelect}
            onPanelClose={lab.onPanelClose}
          />
        </div>
      </div>
    </div>
  );
}
