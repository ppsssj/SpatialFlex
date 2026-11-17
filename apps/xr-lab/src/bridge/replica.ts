import type { HostPanel } from "../contracts/xrHost";
import type { BridgeMessage } from "./protocol";

/** Full-state messages make dropped/reordered incremental events harmless. */
export function applyState(
  current: { revision: number; panels: readonly HostPanel[] },
  message: BridgeMessage,
) {
  if (!("panels" in message) || message.revision <= current.revision)
    return current;
  return { revision: message.revision, panels: message.panels };
}
