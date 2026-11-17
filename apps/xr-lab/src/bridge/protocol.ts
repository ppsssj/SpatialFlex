import type { HostPanel } from "../contracts/xrHost";

export const PROTOCOL_VERSION = 1;
export const CAPABILITY = "host-panels-v1";
export const HEARTBEAT_MS = 500;
export const LEASE_MS = 2500;
export const MAX_REQUESTS = 1024;

interface Envelope {
  protocolVersion: 1;
  appSessionId: string;
  viewId: string;
  connectionId: string;
  revision: number;
}
export type BridgeMessage = Envelope &
  (
    | { type: "hello" | "welcome"; capabilities: string[] }
    | { type: "snapshot" | "update"; panels: readonly HostPanel[] }
    | {
        type: "register" | "unregister";
        itemId: string;
        panels: readonly HostPanel[];
      }
    | {
        type: "action-request";
        itemId: string;
        requestId: string;
        action: string;
      }
    | {
        type: "action-result";
        itemId: string;
        requestId: string;
        status: "ok" | "denied" | "capacity" | "conflict";
      }
    | { type: "ping" | "pong" | "disconnect" | "resync" }
  );

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;
const str = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 256;
const num = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).length === expected.length &&
  expected.every((k) => Object.hasOwn(v, k));
const array = (v: unknown, check: (x: unknown) => boolean, max: number) =>
  Array.isArray(v) && v.length <= max && Array.from(v).every(check);

export function isPanel(v: unknown): v is HostPanel {
  if (
    !record(v) ||
    !keys(v, ["id", "title", "position", "body", "buttons", "selected"])
  )
    return false;
  if (!str(v.id) || !str(v.title) || typeof v.selected !== "boolean")
    return false;
  if (
    !Array.isArray(v.position) ||
    v.position.length !== 3 ||
    !Array.from(v.position).every(num)
  )
    return false;
  if (
    !array(
      v.buttons,
      (b) => record(b) && keys(b, ["id", "label"]) && str(b.id) && str(b.label),
      8,
    )
  )
    return false;
  const buttons = v.buttons as { id: string }[];
  if (new Set(buttons.map((b) => b.id)).size !== buttons.length) return false;
  const b = v.body;
  if (!record(b)) return false;
  if (b.kind === "value")
    return (
      keys(b, ["kind", "label", "value"]) &&
      str(b.label) &&
      typeof b.value === "string" &&
      b.value.length <= 256
    );
  if (b.kind === "bars")
    return (
      keys(b, ["kind", "label", "values"]) &&
      str(b.label) &&
      array(b.values, num, 64)
    );
  return (
    b.kind === "swatch" &&
    keys(b, ["kind", "color", "caption"]) &&
    typeof b.color === "string" &&
    /^#[0-9a-f]{6}$/i.test(b.color) &&
    str(b.caption)
  );
}

/** Strict allowlist at both boundaries; no extra keys or executable values. */
export function isMessage(v: unknown): v is BridgeMessage {
  if (
    !record(v) ||
    v.protocolVersion !== PROTOCOL_VERSION ||
    !str(v.appSessionId) ||
    !str(v.viewId) ||
    !str(v.connectionId)
  )
    return false;
  if (!Number.isSafeInteger(v.revision) || (v.revision as number) < 0)
    return false;
  const base = [
    "protocolVersion",
    "appSessionId",
    "viewId",
    "connectionId",
    "revision",
    "type",
  ];
  switch (v.type) {
    case "hello":
    case "welcome":
      return (
        keys(v, [...base, "capabilities"]) && array(v.capabilities, str, 8)
      );
    case "snapshot":
    case "update":
    case "register":
    case "unregister": {
      const item = v.type === "register" || v.type === "unregister";
      if (
        !keys(v, [...base, "panels", ...(item ? ["itemId"] : [])]) ||
        (item && !str(v.itemId))
      )
        return false;
      if (!array(v.panels, isPanel, 32)) return false;
      const panels = v.panels as HostPanel[];
      return new Set(panels.map((p) => p.id)).size === panels.length;
    }
    case "action-request":
      return (
        keys(v, [...base, "itemId", "requestId", "action"]) &&
        str(v.itemId) &&
        str(v.requestId) &&
        str(v.action)
      );
    case "action-result":
      return (
        keys(v, [...base, "itemId", "requestId", "status"]) &&
        str(v.itemId) &&
        str(v.requestId) &&
        ["ok", "denied", "capacity", "conflict"].includes(v.status as string)
      );
    case "ping":
    case "pong":
    case "disconnect":
    case "resync":
      return keys(v, base);
    default:
      return false;
  }
}

export function envelope(
  appSessionId: string,
  viewId: string,
  revision: number,
  connectionId = "pending",
): Envelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    appSessionId,
    viewId,
    revision,
    connectionId,
  };
}

export function trustedEvent(
  event: Pick<MessageEvent, "origin" | "source">,
  origin: string,
  source: MessageEventSource | null,
) {
  return source !== null && event.origin === origin && event.source === source;
}
