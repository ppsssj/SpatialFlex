import { SpatialFlexError } from "./errors";

/**
 * Renderer-neutral spatial manipulation (P1-06B).
 *
 * World convention, shared with every host: meters, right-handed, y up,
 * -z forward. A presentation's local +z is its facing direction.
 *
 * The {@link SpatialManipulator} owns the spatial transform of every
 * manipulable presentation (Native DOM or XR Adaptive alike). Hosts and DOM
 * handles only report input as world rays; all transform changes happen
 * here, so every renderer applies the same rules.
 */

export type SpatialVector3 = readonly [x: number, y: number, z: number];
/** Unit quaternion, `[x, y, z, w]`. */
export type SpatialQuaternion = readonly [
  x: number,
  y: number,
  z: number,
  w: number,
];

export interface SpatialTransform {
  /** Center of the presentation, in meters. */
  readonly position: SpatialVector3;
  /** Orientation (unit quaternion); local +z faces the viewer. */
  readonly rotation: SpatialQuaternion;
  /**
   * Uniform spatial scale of the presentation's natural size. A spatial
   * scale only: it never changes the CSS layout of Native DOM content.
   */
  readonly scale: number;
}

export type ManipulationMode = "translate" | "rotate" | "resize";

/** A world-space pointing ray (mouse, XR controller or, later, a hand). */
export interface SpatialRay {
  readonly origin: SpatialVector3;
  /** Pointing direction; need not be normalized. */
  readonly direction: SpatialVector3;
}

/** Natural (scale 1) world size of a presentation, in meters. */
export interface SpatialExtent {
  readonly width: number;
  readonly height: number;
}

export const SCALE_LIMITS = { min: 0.4, max: 3 } as const;
/** Keyboard steps: normal / with Shift. */
export const KEYBOARD_STEPS = {
  translate: [0.02, 0.1],
  rotate: [Math.PI / 36, Math.PI / 12],
  resize: [1.1, 1.25],
} as const;

export const IDENTITY_ROTATION: SpatialQuaternion = [0, 0, 0, 1];

type Validation<T> =
  | { readonly supported: true; readonly value: T }
  | { readonly supported: false; readonly reason: string };

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const tuple = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) && value.length === length && value.every(finite);

/**
 * Validates an untrusted transform without coercion. A non-unit rotation is
 * normalized; a zero or non-finite one is rejected. The scale must lie
 * within {@link SCALE_LIMITS}.
 */
export function validateTransform(
  value: unknown,
): Validation<SpatialTransform> {
  if (!value || typeof value !== "object")
    return { supported: false, reason: "A transform must be an object." };
  const { position, rotation, scale } = value as Record<string, unknown>;
  if (!tuple(position, 3))
    return {
      supported: false,
      reason: "Position must be three finite meters.",
    };
  if (!tuple(rotation, 4))
    return {
      supported: false,
      reason: "Rotation must be a finite quaternion [x, y, z, w].",
    };
  const length = Math.hypot(...rotation);
  if (!(length > 1e-6) || !Number.isFinite(length))
    return { supported: false, reason: "Rotation must not be zero." };
  if (!finite(scale) || scale < SCALE_LIMITS.min || scale > SCALE_LIMITS.max)
    return {
      supported: false,
      reason: `Scale must be a finite number from ${SCALE_LIMITS.min} to ${SCALE_LIMITS.max}.`,
    };
  return {
    supported: true,
    value: Object.freeze({
      position: Object.freeze([...position]) as unknown as SpatialVector3,
      rotation: Object.freeze(
        rotation.map((c) => c / length),
      ) as unknown as SpatialQuaternion,
      scale,
    }),
  };
}

export function assertTransform(value: unknown): SpatialTransform {
  const result = validateTransform(value);
  if (!result.supported)
    throw new SpatialFlexError("INVALID_LAYOUT", result.reason);
  return result.value;
}

// --- Vector and quaternion math (plain tuples, no engine dependency) -----

type V = SpatialVector3;
const add = (a: V, b: V, s = 1): V => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: V) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: V): V | null => {
  const l = length(a);
  return l > 1e-9 && Number.isFinite(l) ? [a[0] / l, a[1] / l, a[2] / l] : null;
};

/** Rotation by `angle` radians about world +y. */
export function yawQuaternion(angle: number): SpatialQuaternion {
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}

/** Hamilton product `a · b` (apply `b`, then `a`). */
export function multiplyQuaternions(
  a: SpatialQuaternion,
  b: SpatialQuaternion,
): SpatialQuaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  const q: SpatialQuaternion = [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Rotates a vector by a unit quaternion. */
export function rotateVector(q: SpatialQuaternion, v: SpatialVector3): V {
  const [x, y, z, w] = q;
  // v' = v + 2w (u × v) + 2 u × (u × v), with u = (x, y, z).
  const u: V = [x, y, z];
  const t = cross(u, v);
  return add(add(v, t, 2 * w), cross(u, t), 2);
}

/** World point of a presentation-local point (meters, before scale). */
export function transformPoint(t: SpatialTransform, local: SpatialVector3): V {
  return add(t.position, rotateVector(t.rotation, local), t.scale);
}

/** Heading of the facing direction about +y, in radians (0 = facing +z). */
export function yawOf(q: SpatialQuaternion): number {
  const [x, , z] = rotateVector(q, [0, 0, 1]);
  return Math.atan2(x, z);
}

/** Ray parameter of the intersection with a plane, or null (parallel/behind). */
function intersect(ray: SpatialRay, point: V, normal: V): number | null {
  const direction = normalize(ray.direction);
  if (!direction) return null;
  const denominator = dot(direction, normal);
  if (Math.abs(denominator) < 1e-6) return null;
  const t = dot(sub(point, ray.origin), normal) / denominator;
  return t > 0 && Number.isFinite(t) ? t : null;
}

function pointOn(ray: SpatialRay, t: number): V {
  return add(ray.origin, normalize(ray.direction)!, t);
}

const clampScale = (s: number) =>
  Math.min(SCALE_LIMITS.max, Math.max(SCALE_LIMITS.min, s));

// --- Manipulation controller --------------------------------------------

export interface ManipulationTargetOptions {
  /** Registration (logical component) that owns this presentation. */
  readonly registrationId: string;
  /** Initial pose of this presentation instance (Reset returns here). */
  readonly initial: SpatialTransform;
  /** Natural (scale 1) size in meters. */
  readonly extent: SpatialExtent;
}

export interface ManipulationTarget {
  /** Presentation instance identity (not the strategy, not the registration). */
  readonly presentationId: string;
  readonly registrationId: string;
  readonly initial: SpatialTransform;
  readonly transform: SpatialTransform;
  readonly extent: SpatialExtent;
}

export type ManipulationInput = "pointer" | "keyboard";

export interface ActiveManipulation {
  /** Session token; input carrying another token is stale and rejected. */
  readonly token: number;
  readonly presentationId: string;
  readonly registrationId: string;
  readonly mode: ManipulationMode;
  readonly input: ManipulationInput;
  /** Pointer that drives a pointer session. */
  readonly pointerId: number | null;
  /** Pose when the session began; Cancel returns here. */
  readonly start: SpatialTransform;
}

export interface ManipulationSnapshot {
  /** Changes on every transform, session or selection change. */
  readonly version: number;
  readonly active: ActiveManipulation | null;
  /** The presentation selected for manipulation (last touched). */
  readonly selected: string | null;
}

/** Why a manipulation ended. */
export type ManipulationEnd = "commit" | "cancel";

interface Session extends ActiveManipulation {
  /** Drag plane: through the grab point, facing the pointer at grab time. */
  readonly grab: V | null;
  readonly normal: V | null;
  /** Horizontal axis to the right of the initial pointing direction. */
  readonly right: V | null;
}

type MutableTarget = {
  -readonly [K in keyof ManipulationTarget]: ManipulationTarget[K];
};

/**
 * Owns the spatial transforms of manipulable presentations and the single
 * manipulation session in progress. Renderer-neutral and DOM-free.
 *
 * Lifecycle and ownership:
 * - Every presentation instance is attached with its own initial pose.
 *   Restoring a component detaches its instance; a new extraction is a new
 *   instance with a new initial (default) pose.
 * - At most one session at a time. `begin` returns a token; `update`,
 *   `commit` and `cancel` with any other token are rejected, so input from
 *   an ended session, a detached instance or a previous presentation of the
 *   same component can never change the current one.
 * - Detaching the manipulated instance cancels its session.
 */
export class SpatialManipulator {
  readonly #targets = new Map<string, MutableTarget>();
  readonly #listeners = new Set<() => void>();
  #session: Session | null = null;
  #selected: string | null = null;
  #nextToken = 0;
  #snapshot: ManipulationSnapshot = {
    version: 0,
    active: null,
    selected: null,
  };

  /** Adds a presentation instance. Returns the matching detach function. */
  attach(presentationId: string, options: ManipulationTargetOptions) {
    if (typeof presentationId !== "string" || !presentationId)
      throw new SpatialFlexError(
        "INVALID_ITEM_ID",
        "A presentation ID must be a non-empty string.",
      );
    if (this.#targets.has(presentationId))
      throw new SpatialFlexError(
        "DUPLICATE_ITEM_ID",
        `Presentation "${presentationId}" is already manipulable.`,
      );
    const initial = assertTransform(options.initial);
    const extent = assertExtent(options.extent);
    const target: MutableTarget = {
      presentationId,
      registrationId: options.registrationId,
      initial,
      transform: initial,
      extent,
    };
    this.#targets.set(presentationId, target);
    this.#emit();
    return () => {
      if (this.#targets.get(presentationId) === target)
        this.detach(presentationId);
    };
  }

  detach(presentationId: string): boolean {
    if (!this.#targets.delete(presentationId)) return false;
    if (this.#session?.presentationId === presentationId) this.#session = null;
    if (this.#selected === presentationId) this.#selected = null;
    this.#emit();
    return true;
  }

  has(presentationId: string) {
    return this.#targets.has(presentationId);
  }

  target(presentationId: string): ManipulationTarget | undefined {
    const target = this.#targets.get(presentationId);
    return target && { ...target };
  }

  targets(): ManipulationTarget[] {
    return [...this.#targets.values()].map((t) => ({ ...t }));
  }

  transform(presentationId: string): SpatialTransform | undefined {
    return this.#targets.get(presentationId)?.transform;
  }

  /** Updates the natural size (a Native DOM element's layout may change). */
  setExtent(presentationId: string, extent: SpatialExtent): boolean {
    const target = this.#targets.get(presentationId);
    if (!target) return false;
    const next = assertExtent(extent);
    if (
      next.width === target.extent.width &&
      next.height === target.extent.height
    )
      return true;
    target.extent = next;
    return true;
  }

  get active(): ActiveManipulation | null {
    return this.#snapshot.active;
  }

  get selected(): string | null {
    return this.#selected;
  }

  select(presentationId: string | null): boolean {
    if (presentationId !== null && !this.#targets.has(presentationId))
      return false;
    if (this.#selected === presentationId) return true;
    this.#selected = presentationId;
    this.#emit();
    return true;
  }

  /**
   * Begins a pointer manipulation of a presentation at the pointer's ray.
   * Returns the session token, or null when another session is active
   * (duplicate press), the presentation is unknown (stale) or the ray
   * cannot grab it.
   */
  begin(
    presentationId: string,
    mode: ManipulationMode,
    pointer: { readonly pointerId: number; readonly ray: SpatialRay },
  ): number | null {
    // Keyboard steps are already applied: a press commits them.
    if (this.#session?.input === "keyboard") this.#session = null;
    if (this.#session) return null;
    const target = this.#targets.get(presentationId);
    if (!target || !isMode(mode) || !finite(pointer?.pointerId)) return null;
    const ray = validRay(pointer.ray);
    if (!ray) return null;
    const t = target.transform;
    const facing = rotateVector(t.rotation, [0, 0, 1]);
    // Grab where the ray meets the presentation's own plane; otherwise
    // (edge-on) at the center's depth along the ray.
    const onPanel = intersect(ray, t.position, facing);
    const depth = dot(sub(t.position, ray.origin), normalize(ray.direction)!);
    const distance = onPanel ?? (depth > 0 ? depth : null);
    if (distance === null) return null;
    const grab = pointOn(ray, distance);
    const normal = normalize(ray.direction)!.map((c) => -c) as unknown as V;
    if (mode === "resize" && pivotDistance(grab, normal, t.position) < 1e-4)
      return null;
    const right = normalize(cross(normalize(ray.direction)!, [0, 1, 0])) ?? [
      1, 0, 0,
    ];
    this.#session = {
      token: ++this.#nextToken,
      presentationId,
      registrationId: target.registrationId,
      mode,
      input: "pointer",
      pointerId: pointer.pointerId,
      start: t,
      grab,
      normal,
      right,
    };
    this.#selected = presentationId;
    this.#emit();
    return this.#session.token;
  }

  /** Follows the pointer of an active pointer session. */
  update(token: number, ray: SpatialRay): boolean {
    const session = this.#current(token);
    if (!session || session.input !== "pointer") return false;
    const target = this.#targets.get(session.presentationId)!;
    const valid = validRay(ray);
    if (!valid) return false;
    const distance = intersect(valid, session.grab!, session.normal!);
    if (distance === null) return false;
    const point = pointOn(valid, distance);
    const start = session.start;
    let next: SpatialTransform;
    if (session.mode === "translate") {
      next = {
        ...start,
        position: add(start.position, sub(point, session.grab!)),
      };
    } else if (session.mode === "rotate") {
      const radius = Math.max(0.05, (target.extent.width * start.scale) / 2);
      const angle = dot(sub(point, session.grab!), session.right!) / radius;
      next = {
        ...start,
        rotation: multiplyQuaternions(yawQuaternion(angle), start.rotation),
      };
    } else {
      const from = pivotDistance(
        session.grab!,
        session.normal!,
        start.position,
      );
      const to = pivotDistance(point, session.normal!, start.position);
      next = { ...start, scale: clampScale((start.scale * to) / from) };
    }
    return this.#set(target, next);
  }

  /** Ends the session, keeping the current pose. */
  commit(token: number): boolean {
    if (!this.#current(token)) return false;
    this.#session = null;
    this.#emit();
    return true;
  }

  /**
   * Ends the session and returns to the pose it started from. Without a
   * token, cancels whatever session is active (Escape, blur, unmount).
   */
  cancel(token?: number): boolean {
    const session = token === undefined ? this.#session : this.#current(token);
    if (!session) return false;
    const target = this.#targets.get(session.presentationId);
    if (target) target.transform = session.start;
    this.#session = null;
    this.#emit();
    return true;
  }

  /**
   * One keyboard step. Starts (or continues) a keyboard session on the
   * presentation; `commit`/`cancel` with the returned token end it.
   * Rejected while a pointer session is active.
   */
  nudge(
    presentationId: string,
    mode: ManipulationMode,
    direction: "left" | "right" | "up" | "down",
    large = false,
  ): number | null {
    const target = this.#targets.get(presentationId);
    if (!target || !isMode(mode)) return null;
    let session = this.#session;
    if (session?.input === "pointer") return null;
    if (session && session.presentationId !== presentationId) {
      // Moving to another presentation's handle commits the previous steps.
      this.#session = session = null;
    }
    const t = target.transform;
    const sign = direction === "right" || direction === "up" ? 1 : -1;
    let next: SpatialTransform;
    if (mode === "translate") {
      const step = KEYBOARD_STEPS.translate[large ? 1 : 0] * sign;
      const horizontal = direction === "left" || direction === "right";
      next = {
        ...t,
        position: add(t.position, horizontal ? [step, 0, 0] : [0, step, 0]),
      };
    } else if (mode === "rotate") {
      if (direction === "up" || direction === "down") return null;
      const step = KEYBOARD_STEPS.rotate[large ? 1 : 0] * sign;
      next = {
        ...t,
        rotation: multiplyQuaternions(yawQuaternion(step), t.rotation),
      };
    } else {
      const factor = KEYBOARD_STEPS.resize[large ? 1 : 0];
      next = {
        ...t,
        scale: clampScale(sign > 0 ? t.scale * factor : t.scale / factor),
      };
    }
    if (!session) {
      session = this.#session = {
        token: ++this.#nextToken,
        presentationId,
        registrationId: target.registrationId,
        mode,
        input: "keyboard",
        pointerId: null,
        start: t,
        grab: null,
        normal: null,
        right: null,
      };
    } else if (session.mode !== mode) {
      session = this.#session = { ...session, mode };
    }
    this.#selected = presentationId;
    this.#set(target, next);
    return session.token;
  }

  /**
   * The presentation's layout placement moved by `delta` meters (for
   * example the lab's Move buttons): its initial pose and its current pose
   * move together, so Reset returns to the moved placement.
   */
  shift(presentationId: string, delta: SpatialVector3): boolean {
    const target = this.#targets.get(presentationId);
    if (!target || !tuple(delta, 3)) return false;
    const moved = (t: SpatialTransform): SpatialTransform => ({
      ...t,
      position: add(t.position, delta),
    });
    const session = this.#session;
    if (session?.presentationId === presentationId) {
      // A pointer drag's grab plane no longer matches: end it. Keyboard
      // steps keep going from the shifted start.
      this.#session =
        session.input === "pointer"
          ? null
          : { ...session, start: moved(session.start) };
    }
    target.initial = moved(target.initial);
    target.transform = moved(target.transform);
    this.#emit();
    return true;
  }

  /** Returns a presentation to its initial pose, ending a session on it. */
  reset(presentationId: string): boolean {
    const target = this.#targets.get(presentationId);
    if (!target) return false;
    if (this.#session?.presentationId === presentationId) this.#session = null;
    target.transform = target.initial;
    this.#selected = presentationId;
    this.#emit();
    return true;
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  getSnapshot = (): ManipulationSnapshot => this.#snapshot;

  #current(token: number): Session | null {
    return this.#session && this.#session.token === token
      ? this.#session
      : null;
  }

  #set(target: MutableTarget, next: SpatialTransform) {
    const valid = validateTransform(next);
    if (!valid.supported) return false;
    target.transform = valid.value;
    this.#emit();
    return true;
  }

  #emit() {
    const session = this.#session;
    this.#snapshot = {
      version: this.#snapshot.version + 1,
      active: session && {
        token: session.token,
        presentationId: session.presentationId,
        registrationId: session.registrationId,
        mode: session.mode,
        input: session.input,
        pointerId: session.pointerId,
        start: session.start,
      },
      selected: this.#selected,
    };
    for (const listener of [...this.#listeners]) listener();
  }
}

function isMode(mode: unknown): mode is ManipulationMode {
  return mode === "translate" || mode === "rotate" || mode === "resize";
}

function validRay(ray: unknown): SpatialRay | null {
  if (!ray || typeof ray !== "object") return null;
  const { origin, direction } = ray as Record<string, unknown>;
  if (!tuple(origin, 3) || !tuple(direction, 3)) return null;
  const d = direction as unknown as V;
  if (!normalize(d)) return null;
  return { origin: origin as unknown as V, direction: d };
}

function assertExtent(extent: SpatialExtent): SpatialExtent {
  if (
    !extent ||
    !finite(extent.width) ||
    !finite(extent.height) ||
    extent.width <= 0 ||
    extent.height <= 0
  )
    throw new SpatialFlexError(
      "INVALID_LAYOUT",
      "A presentation extent must be two positive finite meters.",
    );
  return Object.freeze({ width: extent.width, height: extent.height });
}

/** Distance from `point` to the center projected onto the drag plane. */
function pivotDistance(point: V, normal: V, center: V) {
  const projected = add(center, normal, -dot(sub(center, point), normal));
  return length(sub(point, projected));
}
