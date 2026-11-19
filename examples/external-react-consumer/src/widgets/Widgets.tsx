import {
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
} from "@mui/material";
import { SpatialItem } from "@spatialflex/react";
import { useContext, useState } from "react";
import { Line, LineChart, XAxis, YAxis } from "recharts";
import { RegionContext, useMountCount, useOps, useOpsStore } from "../store";

/**
 * The application's own components. The only SpatialFlex code here is the
 * `SpatialItem` wrapper (one per component) and, where an XR Adaptive
 * presentation makes sense, its semantic `xr` view.
 */

export function IncidentCounter() {
  useMountCount("incident-counter");
  const incidents = useOps((s) => s.incidents);
  const { actions } = useOpsStore();
  const region = useContext(RegionContext);
  const [acknowledged, setAcknowledged] = useState(0);
  return (
    <SpatialItem
      id="incident-counter"
      label="Open incidents"
      detachable
      presentation="native"
      xr={{
        title: "Open incidents",
        body: { kind: "value", label: "Open", value: String(incidents) },
        actions: [
          { id: "report", label: "+1", invoke: actions.reportIncident },
        ],
      }}
    >
      <article className="card" aria-label="Open incidents">
        <h3>Open incidents</h3>
        <p className="big" data-testid="incidents">
          {incidents}
        </p>
        <p className="muted" data-testid="region">
          Region: {region}
        </p>
        <div className="row">
          <Button
            variant="contained"
            size="small"
            data-testid="report-incident"
            onClick={actions.reportIncident}
          >
            Report
          </Button>
          <Button
            variant="outlined"
            size="small"
            data-testid="acknowledge"
            onClick={() => setAcknowledged((n) => n + 1)}
          >
            Acknowledged: {acknowledged}
          </Button>
        </div>
      </article>
    </SpatialItem>
  );
}

export function ShiftNotes() {
  useMountCount("shift-notes");
  const [summary, setSummary] = useState("Night shift: all quiet");
  const [onCall, setOnCall] = useState(true);
  const [priority, setPriority] = useState("normal");
  return (
    <SpatialItem id="shift-notes" label="Shift notes" detachable>
      <article className="card" aria-label="Shift notes">
        <h3>Shift notes</h3>
        <TextField
          label="Summary"
          size="small"
          fullWidth
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          slotProps={{ htmlInput: { "data-testid": "summary" } }}
        />
        <output className="muted" data-testid="summary-echo">
          {summary}
        </output>
        <textarea
          data-testid="handover"
          rows={2}
          defaultValue="Handover: check queue depth"
        />
        <div className="row">
          <FormControlLabel
            control={
              <Switch
                checked={onCall}
                onChange={(event) => setOnCall(event.target.checked)}
                slotProps={{ input: { "data-testid": "on-call" } as object }}
              />
            }
            label={onCall ? "On call" : "Off call"}
          />
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <InputLabel id="priority-label">Priority</InputLabel>
            <Select
              labelId="priority-label"
              label="Priority"
              value={priority}
              data-testid="priority"
              onChange={(event) => setPriority(event.target.value)}
            >
              <MenuItem value="low">Low</MenuItem>
              <MenuItem value="normal">Normal</MenuItem>
              <MenuItem value="high">High</MenuItem>
            </Select>
          </FormControl>
        </div>
        <output className="muted" data-testid="priority-value">
          {priority}
        </output>
      </article>
    </SpatialItem>
  );
}

export function ThroughputChart() {
  useMountCount("throughput-chart");
  const throughput = useOps((s) => s.throughput);
  const { actions } = useOpsStore();
  const data = throughput.map((value, i) => ({ i, value }));
  return (
    <SpatialItem
      id="throughput-chart"
      label="Throughput"
      detachable
      presentation="native"
      xr={{
        title: "Throughput",
        body: { kind: "bars", label: "req/s", values: throughput },
        actions: [
          { id: "sample", label: "Sample", invoke: actions.recordSample },
        ],
      }}
    >
      <article className="card" aria-label="Throughput">
        <h3>Throughput (req/s)</h3>
        <div data-testid="chart" data-values={throughput.join(",")}>
          <LineChart width={280} height={130} data={data}>
            <XAxis dataKey="i" hide />
            <YAxis width={30} domain={[0, 80]} />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#1976d2"
              strokeWidth={2}
              isAnimationActive={false}
              dot={false}
            />
          </LineChart>
        </div>
        <Button
          size="small"
          data-testid="record-sample"
          onClick={actions.recordSample}
        >
          Record sample
        </Button>
      </article>
    </SpatialItem>
  );
}

/**
 * Lives in an animated carousel whose container uses
 * `will-change: transform`: Native DOM cannot place it (the container
 * captures fixed positioning), which SpatialFlex reports.
 */
export function RegionStatus() {
  useMountCount("region-status");
  const region = useContext(RegionContext);
  return (
    <div className="carousel" data-testid="carousel">
      <SpatialItem
        id="region-status"
        label="Region status"
        detachable
        xr={{
          title: "Region status",
          body: { kind: "value", label: region, value: "Healthy" },
        }}
      >
        <article className="card" aria-label="Region status">
          <h3>Region status</h3>
          <Chip label="Healthy" color="success" size="small" />
          <p className="muted">{region}</p>
        </article>
      </SpatialItem>
    </div>
  );
}
