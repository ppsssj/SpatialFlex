import { SpatialWorkspace, useSpatialItems } from "@spatialflex/react";
import { useState } from "react";
import { SpatialView } from "./spatial/SpatialView";
import {
  useSpatialRuntime,
  type Extraction,
  type SpatialRuntime,
} from "./spatial/useSpatialRuntime";
import { createOpsStore, OpsProvider, useDiagnostics } from "./store";
import {
  IncidentCounter,
  RegionStatus,
  ShiftNotes,
  ThroughputChart,
} from "./widgets/Widgets";

const LABELS: Readonly<Record<string, string>> = {
  "incident-counter": "Open incidents",
  "shift-notes": "Shift notes",
  "throughput-chart": "Throughput",
  "region-status": "Region status",
};

export function App() {
  const [store] = useState(createOpsStore);
  return (
    <OpsProvider store={store}>
      <SpatialWorkspace>
        <OperationsMonitor />
      </SpatialWorkspace>
    </OpsProvider>
  );
}

function OperationsMonitor() {
  const runtime = useSpatialRuntime();
  const [viewOpen, setViewOpen] = useState(true);
  const [notesMounted, setNotesMounted] = useState(true);
  return (
    <div className="app">
      <header>
        <h1>Operations Monitor</h1>
        <p className="muted">
          An ordinary React application (MUI, Recharts, Context) that uses
          SpatialFlex through its package entry points only.
        </p>
      </header>
      <main className="columns">
        <section className="dashboard" aria-label="Dashboard">
          <div className="grid">
            <IncidentCounter />
            {notesMounted && <ShiftNotes />}
            <ThroughputChart />
            <RegionStatus />
          </div>
          <label className="muted">
            <input
              type="checkbox"
              data-testid="notes-mounted"
              checked={notesMounted}
              onChange={(event) => setNotesMounted(event.target.checked)}
            />{" "}
            Show shift notes
          </label>
          <Diagnostics />
        </section>
        <section className="spatial" aria-label="Spatial workspace">
          <SpatialControls runtime={runtime} />
          <button
            type="button"
            data-testid="toggle-view"
            // Closing the view disconnects the last host: the SDK restores
            // every presentation.
            onClick={() => setViewOpen((open) => !open)}
          >
            {viewOpen ? "Close 3D view" : "Open 3D view"}
          </button>
          {viewOpen && <SpatialView runtime={runtime.runtime} />}
        </section>
      </main>
    </div>
  );
}

function SpatialControls({ runtime }: { runtime: SpatialRuntime }) {
  const records = useSpatialItems();
  const [selected, setSelected] = useState<string | null>(null);
  const [blocker, setBlocker] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const current = records.find((r) => r.id === selected) ?? null;
  const extracted = current && runtime.kindOf(current.id);
  const issue = current ? runtime.issues.get(current.id) : undefined;

  const choose = (id: string) => {
    setSelected(id);
    setMessage(null);
    // Native DOM compatibility, checked when a component is selected.
    setBlocker(runtime.nativeBlocker(id));
  };
  const extract = (as: Extraction) => {
    if (!current) return;
    const refused = runtime.extract(current.id, as);
    if (as === "native") setBlocker(runtime.nativeBlocker(current.id));
    setMessage(
      refused ??
        `${LABELS[current.id] ?? current.id} extracted as ${
          as === "native" ? "Native DOM (the original element)" : "XR Adaptive"
        }.`,
    );
  };

  return (
    <div className="controls" role="group" aria-label="Spatial controls">
      <fieldset>
        <legend>Registered components</legend>
        {records.map((record) => (
          <label key={record.id}>
            <input
              type="radio"
              name="component"
              data-testid={`select-${record.id}`}
              checked={selected === record.id}
              onChange={() => choose(record.id)}
            />{" "}
            {LABELS[record.id] ?? record.id}
            {runtime.kindOf(record.id) === "native" && " · Native DOM in space"}
            {runtime.kindOf(record.id) === "adaptive" &&
              " · XR Adaptive in space"}
          </label>
        ))}
      </fieldset>
      {current && (
        <>
          <p data-testid="compatibility" data-supported={!blocker}>
            {blocker
              ? blocker
              : "Native DOM: compatible (no ancestor captures or clips it)."}
          </p>
          <div className="row">
            <button
              type="button"
              data-testid="extract-native"
              disabled={extracted === "native" || !!blocker}
              onClick={() => extract("native")}
            >
              Extract as Native DOM
            </button>
            <button
              type="button"
              data-testid="extract-adaptive"
              disabled={extracted === "adaptive"}
              onClick={() => extract("adaptive")}
            >
              Extract as XR Adaptive
            </button>
            <button
              type="button"
              data-testid="restore"
              disabled={!extracted}
              onClick={() => {
                runtime.restore(current.id);
                setMessage(`${LABELS[current.id] ?? current.id} restored.`);
              }}
            >
              Restore
            </button>
          </div>
        </>
      )}
      {message && (
        <p role="status" data-testid="spatial-message">
          {message}
        </p>
      )}
      {issue && (
        <p role="alert" className="issue" data-testid="native-issue">
          Not composited, hidden until restored: {issue[0]!.element} has{" "}
          {issue[0]!.property}.
        </p>
      )}
    </div>
  );
}

function Diagnostics() {
  const d = useDiagnostics();
  return (
    <dl className="diagnostics" aria-label="Diagnostics">
      <dt>Active store subscriptions</dt>
      <dd
        data-testid="active-subscriptions"
        data-total-subscribes={d.totalSubscribes}
      >
        {d.activeSubscriptions}
      </dd>
      <dt>Store actions</dt>
      <dd data-testid="action-calls">{d.actionCalls}</dd>
      <dt>Component mounts</dt>
      <dd data-testid="mounts">{JSON.stringify(d.mounts)}</dd>
    </dl>
  );
}
