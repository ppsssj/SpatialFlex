import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HostModule, HostPanel } from "../contracts/xrHost";
import { applyState } from "./replica";
import {
  CAPABILITY,
  envelope,
  HEARTBEAT_MS,
  isMessage,
  LEASE_MS,
  trustedEvent,
  type BridgeMessage,
} from "./protocol";
import "../styles.css";

// This entrypoint imports no fixture, integration, React Context or app store.
const params = new URLSearchParams(location.hash.slice(1));
const appSessionId = params.get("appSessionId") ?? "";
const viewId = params.get("viewId") ?? "";
const origin = location.origin;
const host: HostModule =
  new URLSearchParams(location.search).get("engine") === "babylon"
    ? (await import("../hosts/babylon/babylon-host")).babylonHost
    : (await import("../hosts/three/three-host")).threeHost;

function BridgeView() {
  const [state, setState] = useState({
    revision: -1,
    panels: [] as readonly HostPanel[],
    connected: false,
  });
  const [result, setResult] = useState("none");
  const [hidden, setHidden] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const request = useRef<
    ((itemId: string, action: string, observedRevision: number) => void) | null
  >(null);
  useEffect(() => {
    let active = false;
    let connectionId = "pending";
    let welcomed = false;
    let lastSeen = 0;
    let lastStateAt = 0;
    let current = { revision: -1, panels: [] as readonly HostPanel[] };
    const pending = new Map<string, BridgeMessage>();
    const send = (m: BridgeMessage) => window.parent.postMessage(m, origin);
    const base = () =>
      envelope(
        appSessionId,
        viewId,
        Math.max(0, current.revision),
        connectionId,
      );
    const hello = () =>
      send({ ...base(), type: "hello", capabilities: [CAPABILITY] });
    const stop = () => {
      active = false;
      welcomed = false;
      pending.clear();
      setState({ ...current, connected: false });
    };
    request.current = (
      itemId: string,
      action: string,
      observedRevision: number,
    ) => {
      if (
        !active ||
        observedRevision < 0 ||
        observedRevision > current.revision ||
        Date.now() - lastSeen > LEASE_MS ||
        Date.now() - lastStateAt > LEASE_MS ||
        pending.size >= 32
      )
        return;
      const m: BridgeMessage = {
        ...envelope(appSessionId, viewId, observedRevision, connectionId),
        type: "action-request",
        itemId,
        action,
        requestId: crypto.randomUUID(),
      };
      pending.set(m.requestId, m);
      send(m);
    };
    const receive = (event: MessageEvent) => {
      if (!trustedEvent(event, origin, window.parent) || !isMessage(event.data))
        return;
      const m = event.data;
      if (m.appSessionId !== appSessionId || m.viewId !== viewId) return;
      if (m.type === "welcome") {
        if (!m.capabilities.includes(CAPABILITY)) return;
        connectionId = m.connectionId;
        for (const [id, request] of pending)
          pending.set(id, { ...request, connectionId });
        welcomed = true;
        lastSeen = Date.now();
        send({ ...base(), type: "resync" });
        return;
      }
      if (!welcomed || m.connectionId !== connectionId) return;
      if (m.type === "disconnect") {
        stop();
        return;
      }
      if (m.type === "ping") {
        lastSeen = Date.now();
        send({ ...base(), type: "pong" });
      }
      if ("panels" in m) {
        if (!active && m.type !== "snapshot") return;
        const next = applyState(current, m);
        if (next === current) return;
        current = next;
        active = true;
        lastSeen = Date.now();
        lastStateAt = lastSeen;
        setState({ ...current, connected: true });
      }
      if (m.type === "action-result" && pending.has(m.requestId)) {
        pending.delete(m.requestId);
        setResult(m.status);
      }
    };
    window.addEventListener("message", receive);
    const timer = window.setInterval(() => {
      if (welcomed && Date.now() - lastSeen > LEASE_MS) stop();
      if (active && Date.now() - lastStateAt > LEASE_MS) stop();
      if (!active) hello();
      else for (const m of pending.values()) send(m);
    }, HEARTBEAT_MS);
    const unload = () => send({ ...base(), type: "disconnect" });
    window.addEventListener("pagehide", unload);
    hello();
    return () => {
      unload();
      pending.clear();
      window.clearInterval(timer);
      window.removeEventListener("message", receive);
      window.removeEventListener("pagehide", unload);
    };
  }, []);
  const { Host } = host;
  return (
    <>
      <p className="hint" role="status" data-testid="view-status">
        {state.connected ? "connected" : "stale / disconnected"} · revision{" "}
        <span data-testid="view-revision">{state.revision}</span> · action{" "}
        <span data-testid="action-result">{result}</span>
      </p>
      <button type="button" onClick={() => setHidden([])}>
        Restore locally closed panels
      </button>
      <Host
        panels={
          state.connected
            ? state.panels
                .filter((p) => !hidden.includes(p.id))
                .map((p) => ({ ...p, selected: selected === p.id }))
            : []
        }
        // An event belongs to this committed Host view, even if a newer
        // network snapshot has arrived before React commits its replacement.
        onPanelButton={(id, action) =>
          request.current?.(id, action, state.revision)
        }
        onPanelSelect={setSelected}
        onPanelClose={(id) => setHidden((ids) => [...ids, id])}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<BridgeView />);
