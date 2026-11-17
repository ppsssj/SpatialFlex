import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EngineId, HostModule, XRHostProps } from "../contracts/xrHost";
import { ActionLedger } from "./authority";
import { ViewAuthorization } from "./viewAuthorization";
import {
  CAPABILITY,
  envelope,
  HEARTBEAT_MS,
  isMessage,
  LEASE_MS,
  trustedEvent,
  type BridgeMessage,
} from "./protocol";

const appSessionId = crypto.randomUUID();
const ledger = new ActionLedger();

export function iframeHost(engine: EngineId): HostModule {
  return {
    id: engine,
    label: `${engine} cross-context`,
    Host: (props) => <IframeHost {...props} engine={engine} />,
  };
}

function IframeHost({ engine, ...props }: XRHostProps & { engine: EngineId }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  const publish = useRef<(() => void) | null>(null);
  const revisionRef = useRef(0);
  const [viewId] = useState(() => crypto.randomUUID());
  const [connected, setConnected] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const origin = window.location.origin;
  const src = `/host.html?engine=${engine}#${new URLSearchParams({ appSessionId, viewId })}`;

  useLayoutEffect(() => {
    latest.current = props;
    publish.current?.();
  }, [props]);

  useEffect(() => {
    if (!enabled) return;
    let active = false;
    let connectionId = crypto.randomUUID();
    let lastSeen = 0;
    let revision = revisionRef.current;
    let previous = "";
    let previousIds: string[] = [];
    const authorization = new ViewAuthorization();
    const send = (message: BridgeMessage) =>
      frame.current?.contentWindow?.postMessage(message, origin);
    const snapshot = (force = false) => {
      if (!active) return;
      const panels = latest.current.panels;
      const serialized = JSON.stringify(panels);
      const ids = panels.map((p) => p.id);
      const ownersChanged = authorization.update(
        latest.current.actionOwners,
        revision,
      );
      if (!force && serialized === previous && !ownersChanged) return;
      revision++;
      revisionRef.current = revision;
      const added = ids.find((id) => !previousIds.includes(id));
      const removed = previousIds.find((id) => !ids.includes(id));
      const base = envelope(appSessionId, viewId, revision, connectionId);
      if (force) send({ ...base, type: "snapshot", panels });
      else if (removed)
        send({ ...base, type: "unregister", itemId: removed, panels });
      else if (added)
        send({ ...base, type: "register", itemId: added, panels });
      else send({ ...base, type: "update", panels });
      previous = serialized;
      previousIds = ids;
    };
    const disconnect = () => {
      active = false;
      setConnected(false);
      send({
        ...envelope(appSessionId, viewId, revision, connectionId),
        type: "disconnect",
      });
    };
    const receive = (event: MessageEvent) => {
      if (
        !trustedEvent(event, origin, frame.current?.contentWindow ?? null) ||
        !isMessage(event.data)
      )
        return;
      const m = event.data;
      if (m.appSessionId !== appSessionId || m.viewId !== viewId) return;
      if (m.type === "hello") {
        if (!m.capabilities.includes(CAPABILITY)) return;
        connectionId = crypto.randomUUID();
        active = true;
        lastSeen = Date.now();
        setConnected(true);
        send({
          ...envelope(appSessionId, viewId, revision, connectionId),
          type: "welcome",
          capabilities: [CAPABILITY],
        });
        snapshot(true);
        return;
      }
      if (m.connectionId !== connectionId) return;
      if (!active || Date.now() - lastSeen > LEASE_MS) {
        disconnect();
        return;
      }
      if (m.type === "pong") lastSeen = Date.now();
      if (m.type === "disconnect") disconnect();
      if (m.type === "resync") snapshot(true);
      if (m.type === "action-request") {
        if (m.revision > revision) return;
        const result = ledger.execute(
          m,
          latest.current.panels,
          latest.current,
          authorization.allows(m.itemId, m.revision),
        );
        send({ ...result, revision });
      }
    };
    publish.current = () => snapshot();
    window.addEventListener("message", receive);
    const timer = window.setInterval(() => {
      if (!active) return;
      if (Date.now() - lastSeen > LEASE_MS) {
        disconnect();
        return;
      }
      send({
        ...envelope(appSessionId, viewId, revision, connectionId),
        type: "ping",
      });
      // Periodic full replacement repairs dropped updates and unregisters.
      snapshot(true);
    }, HEARTBEAT_MS);
    const unload = () => disconnect();
    window.addEventListener("pagehide", unload);
    return () => {
      disconnect();
      publish.current = null;
      window.removeEventListener("message", receive);
      window.removeEventListener("pagehide", unload);
      window.clearInterval(timer);
    };
  }, [enabled, origin, viewId]);

  return (
    <section className="bridge-host">
      <div className="workspace-bar">
        <output data-testid="bridge-status">
          {connected ? "connected" : "disconnected"}
        </output>
        <button type="button" onClick={() => setEnabled((v) => !v)}>
          {enabled ? "Disconnect bridge" : "Reconnect bridge"}
        </button>
      </div>
      <iframe
        ref={frame}
        title="Cross-context XR Host"
        src={src}
        className="bridge-frame"
      />
    </section>
  );
}
