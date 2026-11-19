import { SpatialManipulator, type SpatialTransform } from "@spatialflex/core";
import type { HostManipulationMode, HostRay } from "../../contracts/xrHost";
import type {
  LabManipulation,
  LabManipulationSnapshot,
  LabManipulationTarget,
  LabPose,
  NudgeDirection,
  PresentationId,
} from "../contract";

/** A presentation instance that should be manipulable, and its start pose. */
export interface ManipulablePresentation {
  readonly itemId: string;
  readonly presentationId: string;
  readonly registrationId: string;
  readonly kind: PresentationId;
  readonly initial: LabPose;
  readonly extent: { readonly width: number; readonly height: number };
}

/**
 * Adapts the SDK's renderer-neutral {@link SpatialManipulator} to the lab:
 * one manipulation target per presentation instance (Native DOM `native-N`
 * or XR Adaptive `presentation-N`), addressed by item id for the hosts and
 * the DOM handles. {@link sync} attaches new instances and detaches ended
 * ones, so an ended presentation's input can never reach a later one.
 */
export class ManipulationAdapter implements LabManipulation {
  readonly #manipulator = new SpatialManipulator();
  /** Current presentation per item. */
  #byItem = new Map<string, ManipulablePresentation>();
  readonly #byPresentation = new Map<
    string,
    {
      /** Latest layout placement (its initial pose as last synced). */
      target: ManipulablePresentation;
      readonly detach: () => void;
    }
  >();
  #snapshot: LabManipulationSnapshot = {
    version: 0,
    active: null,
    selected: null,
  };
  #seen = -1;

  /** Reconciles the manipulable presentations (from a layout effect). */
  sync(desired: readonly ManipulablePresentation[]) {
    const keep = new Set(desired.map((d) => d.presentationId));
    for (const [id, { detach }] of this.#byPresentation)
      if (!keep.has(id)) {
        this.#byPresentation.delete(id);
        detach();
      }
    this.#byItem = new Map(desired.map((d) => [d.itemId, d]));
    for (const target of desired) {
      const entry = this.#byPresentation.get(target.presentationId);
      if (entry) {
        // The layout placement of a live presentation moved (Move buttons):
        // shift it, keeping what the user manipulated on top.
        const [x, y, z] = target.initial.position;
        const [px, py, pz] = entry.target.initial.position;
        if (x !== px || y !== py || z !== pz)
          this.#manipulator.shift(target.presentationId, [
            x - px,
            y - py,
            z - pz,
          ]);
        entry.target = target;
        continue;
      }
      this.#byPresentation.set(target.presentationId, {
        target,
        detach: this.#manipulator.attach(target.presentationId, {
          registrationId: target.registrationId,
          initial: target.initial,
          extent: target.extent,
        }),
      });
    }
  }

  dispose() {
    this.sync([]);
  }

  /** Item ids of manipulable presentations of a kind. */
  items(kind: PresentationId): string[] {
    return [...this.#byItem.values()]
      .filter((t) => t.kind === kind && this.#manipulator.has(t.presentationId))
      .map((t) => t.itemId);
  }

  #presentation(itemId: string) {
    const current = this.#byItem.get(itemId);
    return current && this.#manipulator.has(current.presentationId)
      ? current.presentationId
      : null;
  }

  #itemOf(presentationId: string | null) {
    return presentationId === null
      ? null
      : (this.#byPresentation.get(presentationId)?.target.itemId ?? null);
  }

  subscribe = (listener: () => void) => this.#manipulator.subscribe(listener);

  getSnapshot = (): LabManipulationSnapshot => {
    const core = this.#manipulator.getSnapshot();
    if (core.version !== this.#seen) {
      this.#seen = core.version;
      const active = core.active;
      this.#snapshot = {
        version: core.version,
        active: active && {
          token: active.token,
          itemId: this.#itemOf(active.presentationId) ?? "",
          presentationId: active.presentationId,
          mode: active.mode,
          input: active.input,
        },
        selected: this.#itemOf(core.selected),
      };
    }
    return this.#snapshot;
  };

  targets = (): LabManipulationTarget[] =>
    this.#manipulator.targets().flatMap((t) => {
      const entry = this.#byPresentation.get(t.presentationId);
      return entry
        ? [
            {
              itemId: entry.target.itemId,
              presentationId: t.presentationId,
              registrationId: t.registrationId,
              kind: entry.target.kind,
              transform: t.transform,
              initial: t.initial,
            },
          ]
        : [];
    });

  poseOf = (itemId: string): SpatialTransform | undefined => {
    const id = this.#presentation(itemId);
    return id ? this.#manipulator.transform(id) : undefined;
  };

  setExtent = (itemId: string, extent: { width: number; height: number }) => {
    const id = this.#presentation(itemId);
    if (id && extent.width > 0 && extent.height > 0)
      this.#manipulator.setExtent(id, extent);
  };

  begin = (
    itemId: string,
    mode: HostManipulationMode,
    pointerId: number,
    ray: HostRay,
  ) => {
    const id = this.#presentation(itemId);
    return id ? this.#manipulator.begin(id, mode, { pointerId, ray }) : null;
  };

  update = (token: number, ray: HostRay) => {
    this.#manipulator.update(token, ray);
  };

  end = (token: number, commit: boolean) => {
    if (commit) this.#manipulator.commit(token);
    else this.#manipulator.cancel(token);
  };

  nudge = (
    itemId: string,
    mode: HostManipulationMode,
    direction: NudgeDirection,
    large: boolean,
  ) => {
    const id = this.#presentation(itemId);
    return id ? this.#manipulator.nudge(id, mode, direction, large) : null;
  };

  endKeyboard = (itemId: string, commit: boolean) => {
    const active = this.#manipulator.active;
    if (
      !active ||
      active.input !== "keyboard" ||
      active.presentationId !== this.#presentation(itemId)
    )
      return false;
    return commit
      ? this.#manipulator.commit(active.token)
      : this.#manipulator.cancel(active.token);
  };

  cancel = () => this.#manipulator.cancel();

  reset = (itemId: string) => {
    const id = this.#presentation(itemId);
    return id ? this.#manipulator.reset(id) : false;
  };

  select = (itemId: string | null) =>
    itemId === null
      ? this.#manipulator.select(null)
      : this.#manipulator.select(this.#presentation(itemId) ?? "");
}
