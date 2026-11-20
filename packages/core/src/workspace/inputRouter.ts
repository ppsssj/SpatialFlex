import type { HostLease } from "./frameAuthority.js";
import {
  encodeItemRef,
  sameItem,
  sameSurface,
  type ScopedItemRef,
  type SurfaceRef,
} from "./identity.js";

/**
 * P1-08A input ownership (package-internal, experimental).
 *
 * The router decides WHO owns an interaction; it never delivers DOM
 * events. Native DOM events stay with the browser and the source document
 * that owns the element; Adaptive actions go to the registration that
 * declared them (validated again by the surface runtime's `invoke`).
 */
export type InputOwner =
  /** A presentation (Native DOM element or Adaptive panel) of an item. */
  | {
      readonly kind: "presentation";
      readonly item: ScopedItemRef;
      readonly instanceId: string;
    }
  /** A surface's page itself (its background or its in-page content). */
  | { readonly kind: "surface"; readonly surface: SurfaceRef };

/** One geometric intersection of a pointer ray, in world terms. */
export interface InputHit {
  readonly owner: InputOwner;
  /** World distance along the ray, meters. */
  readonly distance: number;
  /**
   * Whether this target takes input. A nearer non-interactive hit still
   * occludes: the gesture goes to nobody instead of leaking behind it.
   */
  readonly interactive: boolean;
}

/** Equal within this, distances are coplanar (a panel lying on its page). */
export const COPLANAR_EPSILON = 1e-4;

const surfaceOf = (owner: InputOwner) =>
  owner.kind === "surface" ? owner.surface : owner.item.surface;

const keyOf = (owner: InputOwner) =>
  owner.kind === "surface"
    ? JSON.stringify(["surface", owner.surface.surfaceId, owner.surface.epoch])
    : JSON.stringify(["item", encodeItemRef(owner.item), owner.instanceId]);

export const sameOwner = (a: InputOwner, b: InputOwner) =>
  a.kind === "surface"
    ? b.kind === "surface" && sameSurface(a.surface, b.surface)
    : b.kind === "presentation" &&
      sameItem(a.item, b.item) &&
      a.instanceId === b.instanceId;

/**
 * Deterministic hit order: nearest first; at equal (coplanar) distance a
 * presentation is above a surface page; remaining ties by a stable key.
 */
export function orderHits(hits: readonly InputHit[]): InputHit[] {
  return [...hits]
    .filter((h) => Number.isFinite(h.distance) && h.distance > 0)
    .sort((a, b) => {
      const d = a.distance - b.distance;
      if (Math.abs(d) > COPLANAR_EPSILON) return d;
      const rank = (h: InputHit) => (h.owner.kind === "presentation" ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      const ka = keyOf(a.owner);
      const kb = keyOf(b.owner);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}

/** The single owner of a new gesture: the front-most hit, if interactive. */
export function resolveOwner(hits: readonly InputHit[]): InputOwner | null {
  const front = orderHits(hits)[0];
  return front?.interactive ? front.owner : null;
}

export interface Route {
  readonly owner: InputOwner;
  readonly host: HostLease;
  readonly pointerId: number;
  /** Gesture number, unique per router. */
  readonly gesture: number;
}

export interface InputRouterOptions {
  /** Whether an owner is still live (its surface and registration). */
  isLive(owner: InputOwner): boolean;
  /** Whether a host may supply input now (its frame authority). */
  isAuthoritative(host: HostLease): boolean;
}

/**
 * Pointer capture and keyboard focus for one workspace. One gesture has
 * exactly one owner, fixed at pointer down, for its whole life; it ends on
 * up or cancel, when its owner stops being live, or when its host loses
 * authority. Events of an ended gesture are rejected (`null`).
 */
export class InputRouter {
  readonly #options: InputRouterOptions;
  /** Keyed by host lease and pointer id: pointer ids are per host. */
  readonly #captures = new Map<string, Route>();
  #gesture = 0;
  #focus: InputOwner | null = null;

  constructor(options: InputRouterOptions) {
    this.#options = options;
  }

  /** Starts a gesture; `null` when nothing interactive is in front. */
  down(host: HostLease, pointerId: number, hits: readonly InputHit[]) {
    if (!this.#options.isAuthoritative(host)) return null;
    // A pointer has one gesture at a time: a stray down ends the old one.
    this.#captures.delete(captureKey(host, pointerId));
    const owner = resolveOwner(hits);
    if (!owner || !this.#options.isLive(owner)) return null;
    const route: Route = { owner, host, pointerId, gesture: ++this.#gesture };
    this.#captures.set(captureKey(host, pointerId), route);
    return route;
  }

  /** A move of a captured gesture, routed to its owner (or rejected). */
  move(host: HostLease, pointerId: number): Route | null {
    return this.#continue(host, pointerId);
  }

  /** Ends a gesture; returns the route if it was still valid. */
  up(host: HostLease, pointerId: number): Route | null {
    const route = this.#continue(host, pointerId);
    this.#captures.delete(captureKey(host, pointerId));
    return route;
  }

  cancel(host: HostLease, pointerId: number): Route | null {
    const key = captureKey(host, pointerId);
    const route = this.#captures.get(key) ?? null;
    this.#captures.delete(key);
    return route;
  }

  /** Cancels everything owned by a removed surface; returns the routes. */
  surfaceRemoved(surface: SurfaceRef): Route[] {
    const ended = [...this.#captures.values()].filter((r) =>
      sameSurface(surfaceOf(r.owner), surface),
    );
    for (const route of ended)
      this.#captures.delete(captureKey(route.host, route.pointerId));
    if (this.#focus && sameSurface(surfaceOf(this.#focus), surface))
      this.#focus = null;
    return ended;
  }

  /** Cancels every gesture of a host (disconnect or authority handover). */
  hostEnded(host: HostLease): Route[] {
    const ended = [...this.#captures.values()].filter((r) => r.host === host);
    for (const route of ended)
      this.#captures.delete(captureKey(route.host, route.pointerId));
    return ended;
  }

  /** Keyboard focus moves to one owner (selection / click policy). */
  focus(owner: InputOwner | null): boolean {
    if (owner && !this.#options.isLive(owner)) return false;
    this.#focus = owner;
    return true;
  }

  /** Where keyboard input goes: the focused owner if still live, else nobody. */
  keyboardOwner(): InputOwner | null {
    if (this.#focus && !this.#options.isLive(this.#focus)) this.#focus = null;
    return this.#focus;
  }

  /** Active gestures (diagnostics and tests). */
  get captures(): readonly Route[] {
    return [...this.#captures.values()];
  }

  #continue(host: HostLease, pointerId: number): Route | null {
    const key = captureKey(host, pointerId);
    const route = this.#captures.get(key);
    if (!route) return null;
    if (
      !this.#options.isAuthoritative(host) ||
      !this.#options.isLive(route.owner)
    ) {
      // Lost authority or a dead owner: the gesture ends here, for good.
      this.#captures.delete(key);
      return null;
    }
    return route;
  }
}

const captureKey = (host: HostLease, pointerId: number) =>
  JSON.stringify([host.hostId, host.epoch, pointerId]);
