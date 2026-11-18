import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { testHooksEnabled } from "../contracts/hostProbe";
import type { HostModule } from "../contracts/xrHost";
import { Dashboard, LabStoreContext, type LabStore } from "../fixtures";
import type {
  IntegrationModule,
  LabIntegration,
} from "../integrations/contract";
import { XRControls } from "./XRControls";
import { StrategyControls } from "./StrategyControls";
import { SpatialWebSurface } from "../surface/SpatialWebSurface";
import { SurfaceInspector } from "../surface/SurfaceInspector";
import { useSurfaceCompositor } from "../surface/useSurfaceCompositor";
import { ManipulatedHost } from "../manipulation/ManipulatedHost";
import { ManipulationInspector } from "../manipulation/ManipulationInspector";
import { useNativeHandles } from "../manipulation/useNativeHandles";

const noElement = () => null;

export interface LabShellProps {
  integration: IntegrationModule;
  host: HostModule;
  store: LabStore;
  /** Status of the development emulator, shown in the workspace. */
  emulator: string;
  header?: ReactNode;
  /** Start in Spatial Website mode, if supported (`?surface=website`). */
  surface?: boolean;
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
  surface = false,
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
          surfaceRequested={surface}
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
  surfaceRequested,
}: {
  integration: IntegrationModule;
  host: HostModule;
  emulator: string;
  header: ReactNode;
  surfaceRequested: boolean;
}) {
  const lab: LabIntegration = integration.useIntegration();
  // Unmounting the workspace disposes the host's engine, scene and render
  // loop; used to check resource cleanup.
  const [workspaceMounted, setWorkspaceMounted] = useState(true);
  const { Host } = host;
  const surfaceSupport = !host.webSurface
    ? "Spatial Website needs the same-context Host: the iframe Host renders in another JavaScript realm, which cannot composite this document's live DOM."
    : !lab.extract
      ? "Spatial Website needs SpatialFlex component registrations (integration=spatialflex)."
      : null;
  const [surfaceMode, setSurfaceMode] = useState(surfaceRequested);
  const website = surfaceMode && !surfaceSupport;
  const surfaceActive = website && workspaceMounted;
  // Natively extracted originals, positioned by the surface compositor.
  const nativeList = (lab.surfaceItems ?? [])
    .filter((item) => item.extraction?.presentation === "native")
    .map((item) => item.id);
  const nativeIds = JSON.stringify(nativeList);
  const manipulation = lab.manipulation;
  const surface = useSurfaceCompositor(
    surfaceActive,
    lab.panels,
    nativeList,
    lab.nativeElement ?? noElement,
    manipulation?.poseOf,
  );
  // Native DOM handles feed the same manipulation controller as 3D handles.
  useNativeHandles(
    surfaceActive ? manipulation : undefined,
    nativeList,
    lab.nativeElement ?? noElement,
    surface.rayAt,
  );
  // Read-only test hook: poses and sessions, never a way to change them.
  useEffect(() => {
    if (!testHooksEnabled || !manipulation) return;
    const target = window as unknown as {
      __xrLabManipulation?: Pick<
        typeof manipulation,
        "targets" | "getSnapshot" | "poseOf"
      >;
    };
    target.__xrLabManipulation = {
      targets: manipulation.targets,
      getSnapshot: manipulation.getSnapshot,
      poseOf: manipulation.poseOf,
    };
    return () => {
      delete target.__xrLabManipulation;
    };
  }, [manipulation]);
  // Without an active surface (mode off, workspace unmounted) there is no
  // compositor to place them: the originals return to their place.
  useLayoutEffect(() => {
    if (surfaceActive) return;
    for (const id of JSON.parse(nativeIds) as string[]) lab.restore?.(id);
    // `lab` is rebuilt every render; the effect depends on its native ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceActive, nativeIds]);
  const toggleSurface = () => {
    const next = !website;
    // Same-document Move uses fixed positioning, which a transformed surface
    // would capture: moved components return to their place first.
    if (next)
      for (const item of lab.items) if (item.detached) lab.attach?.(item.id);
    setSurfaceMode(next);
    const url = new URL(window.location.href);
    url.searchParams.set("surface", next ? "website" : "split");
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <div
      className="lab"
      data-integration={integration.id}
      data-engine={host.id}
      data-surface={website ? "website" : "split"}
    >
      <header className="lab-header">{header}</header>
      <div className="lab-columns">
        <div className="lab-left">
          {website ? (
            <>
              <SurfaceInspector
                surface={surface}
                lab={lab}
                engine={host.id}
                workspaceMounted={workspaceMounted}
              />
              {manipulation && (
                <ManipulationInspector manipulation={manipulation} lab={lab} />
              )}
            </>
          ) : (
            lab.detach && <StrategyControls lab={lab} />
          )}
          <SpatialWebSurface active={surfaceActive} surface={surface} lab={lab}>
            <Dashboard
              {...(lab.renderWidget && { renderWidget: lab.renderWidget })}
            />
          </SpatialWebSurface>
          {!website && <XRControls lab={lab} />}
        </div>
        <div className="lab-right">
          <div className="workspace-bar">
            <button
              type="button"
              onClick={() => setWorkspaceMounted((mounted) => !mounted)}
            >
              {workspaceMounted ? "Unmount workspace" : "Mount workspace"}
            </button>
            <button
              type="button"
              data-testid="surface-toggle"
              aria-pressed={website}
              disabled={!!surfaceSupport}
              onClick={toggleSurface}
            >
              Spatial Website
            </button>
            {surfaceSupport && (
              <span className="hint" data-testid="surface-support">
                {surfaceSupport}
              </span>
            )}
            <span className="hint" data-testid="xr-emulator">
              Emulator: {emulator}
            </span>
          </div>
          {workspaceMounted && (
            <ManipulatedHost
              Host={Host}
              manipulation={manipulation}
              // Handles on the Spatial Website only (desktop, same document).
              handles={surfaceActive}
              props={{
                ...(lab.actionOwners && { actionOwners: lab.actionOwners }),
                panels: lab.panels,
                onPanelButton: lab.onPanelButton,
                onPanelSelect: lab.onPanelSelect,
                onPanelClose: lab.onPanelClose,
                ...(surfaceActive && { onCameraFrame: surface.onCameraFrame }),
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
