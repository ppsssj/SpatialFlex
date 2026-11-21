/**
 * P1-08A host frame authority (package-internal, experimental).
 *
 * A renderer host (Three.js, Babylon.js, a future XR renderer) connects
 * and receives a lease. Exactly one lease is authoritative at a time: its
 * camera frames drive DOM composition and its rays are accepted as input.
 * Several surfaces in one host share that host's frames (C1); multiple
 * hosts (C2) and XR views (C3) are distinguished by lease, never by a
 * global camera.
 *
 * Rules:
 * - Compatibility default: when nobody is authoritative, the first lease
 *   that submits a frame becomes authoritative (the P1-07B3 rule of
 *   `PresentationRuntime`).
 * - `authorize` hands authority over explicitly. The previous frame is
 *   discarded: a new authority has no frame until it submits one, so no
 *   surface ever composites with another host's camera.
 * - Disconnecting the authority clears authority and frame.
 * - Frames carry a per-lease sequence; an older or equal sequence is stale.
 * - A lease is never reused: a reconnecting host gets a new epoch.
 */
export interface HostLease {
  readonly hostId: string;
  readonly epoch: number;
}

export type FrameVerdict =
  "accepted" | "disconnected" | "not-authoritative" | "stale";

export class FrameAuthority<Frame> {
  readonly #connected = new Map<string, HostLease>();
  #epoch = 0;
  #authority: HostLease | null = null;
  #current: {
    readonly lease: HostLease;
    readonly sequence: number;
    readonly frame: Frame;
  } | null = null;

  /** Connects a host. A host id is live at most once at a time. */
  connect(hostId: string): HostLease {
    if (this.#connected.has(hostId))
      throw new Error(`Host "${hostId}" is already connected.`);
    const lease: HostLease = Object.freeze({ hostId, epoch: ++this.#epoch });
    this.#connected.set(hostId, lease);
    return lease;
  }

  isConnected(lease: HostLease): boolean {
    return this.#connected.get(lease.hostId) === lease;
  }

  isAuthoritative(lease: HostLease): boolean {
    return this.#authority === lease && this.isConnected(lease);
  }

  get authority(): HostLease | null {
    return this.#authority;
  }

  /** Explicit handover. The previous authority's frame is discarded. */
  authorize(lease: HostLease): boolean {
    if (!this.isConnected(lease)) return false;
    if (this.#authority !== lease) {
      this.#authority = lease;
      this.#current = null;
    }
    return true;
  }

  submit(lease: HostLease, sequence: number, frame: Frame): FrameVerdict {
    if (!this.isConnected(lease)) return "disconnected";
    this.#authority ??= lease;
    if (this.#authority !== lease) return "not-authoritative";
    if (
      this.#current &&
      this.#current.lease === lease &&
      !(sequence > this.#current.sequence)
    )
      return "stale";
    this.#current = { lease, sequence, frame };
    return "accepted";
  }

  /** The authoritative frame, if the authority has submitted one. */
  current(): Frame | null {
    return this.#current && this.isAuthoritative(this.#current.lease)
      ? this.#current.frame
      : null;
  }

  disconnect(lease: HostLease): boolean {
    if (!this.isConnected(lease)) return false;
    this.#connected.delete(lease.hostId);
    if (this.#authority === lease) {
      this.#authority = null;
      this.#current = null;
    }
    return true;
  }
}
