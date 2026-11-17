import type { HostEvents, HostPanel } from "../contracts/xrHost";
import { MAX_REQUESTS, type BridgeMessage } from "./protocol";

type Request = Extract<BridgeMessage, { type: "action-request" }>;
type Result = Extract<BridgeMessage, { type: "action-result" }>;

/** Lives in the parent app session, across iframe reloads and workspace remounts. */
export class ActionLedger {
  private readonly records = new Map<
    string,
    { fingerprint: string; result: Result }
  >();
  constructor(private readonly limit = MAX_REQUESTS) {}
  get size() {
    return this.records.size;
  }

  execute(
    request: Request,
    panels: readonly HostPanel[],
    events: HostEvents,
    authorized = true,
  ): Result {
    const fingerprint = JSON.stringify([
      request.viewId,
      request.itemId,
      request.action,
    ]);
    const key = request.requestId;
    const prior = this.records.get(key);
    if (prior)
      return prior.fingerprint === fingerprint
        ? { ...prior.result, connectionId: request.connectionId }
        : {
            ...prior.result,
            viewId: request.viewId,
            itemId: request.itemId,
            connectionId: request.connectionId,
            status: "conflict",
          };
    const result: Result = {
      protocolVersion: 1,
      appSessionId: request.appSessionId,
      viewId: request.viewId,
      connectionId: request.connectionId,
      revision: request.revision,
      type: "action-result",
      itemId: request.itemId,
      requestId: request.requestId,
      status: "denied",
    };
    if (this.records.size >= this.limit)
      return { ...result, status: "capacity" };
    // Reserve before execution (including rejected requests). Never evict and
    // accidentally execute an old retry. Capacity exhaustion fails closed.
    this.records.set(key, { fingerprint, result });
    const panel = panels.find((p) => p.id === request.itemId);
    if (
      !authorized ||
      !panel ||
      !panel.buttons.some((b) => b.id === request.action)
    )
      return result;
    try {
      events.onPanelButton(request.itemId, request.action);
      result.status = "ok";
    } catch {
      // Failed actions are never retried automatically: they may have mutated.
      result.status = "denied";
    }
    return result;
  }
}
