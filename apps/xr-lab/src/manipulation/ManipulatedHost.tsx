import { useMemo, useSyncExternalStore, type ComponentType } from "react";
import type {
  HostManipulation,
  HostPanel,
  XRHostProps,
} from "../contracts/xrHost";
import type {
  LabManipulation,
  LabManipulationSnapshot,
} from "../integrations/contract";

const IDLE: LabManipulationSnapshot = {
  version: 0,
  active: null,
  selected: null,
};
const noSubscribe = () => () => {};
const idle = () => IDLE;

const isIdentity = (q: readonly number[]) =>
  q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 1;

/**
 * Renders the XR host with the manipulated poses of its panels and, when
 * `handles` is set, the renderer-neutral manipulation input. Only this
 * component subscribes to pose changes, so a drag re-renders the host, not
 * the shell or the dashboard.
 *
 * Panels stay plain data: rotation and scale are added only when they
 * differ from identity, so unmanipulated panels keep the exact shape that
 * the cross-context bridge protocol allows.
 */
export function ManipulatedHost({
  Host,
  props,
  manipulation,
  handles,
}: {
  Host: ComponentType<XRHostProps>;
  props: XRHostProps;
  manipulation: LabManipulation | undefined;
  handles: boolean;
}) {
  const snapshot = useSyncExternalStore(
    manipulation?.subscribe ?? noSubscribe,
    manipulation?.getSnapshot ?? idle,
    manipulation?.getSnapshot ?? idle,
  );
  const panels = useMemo(
    () =>
      manipulation
        ? props.panels.map((panel): HostPanel => {
            const pose = manipulation.poseOf(panel.id);
            if (!pose) return panel;
            return {
              ...panel,
              position: pose.position,
              ...(!isIdentity(pose.rotation) && { rotation: pose.rotation }),
              ...(pose.scale !== 1 && { scale: pose.scale }),
              // The latest manipulated or picked panel is the selected one.
              selected:
                snapshot.selected !== null
                  ? snapshot.selected === panel.id
                  : panel.selected,
            };
          })
        : props.panels,
    [props.panels, manipulation, snapshot],
  );
  const hostManipulation = useMemo((): HostManipulation | undefined => {
    if (!handles || !manipulation) return undefined;
    const active = snapshot.active;
    return {
      panels: manipulation
        .targets()
        .filter((t) => t.kind === "adaptive")
        .map((t) => t.itemId),
      active:
        active?.input === "pointer"
          ? { panelId: active.itemId, mode: active.mode }
          : null,
      begin: manipulation.begin,
      update: manipulation.update,
      end: manipulation.end,
    };
  }, [handles, manipulation, snapshot]);
  return (
    <Host
      {...props}
      panels={panels}
      {...(hostManipulation && { manipulation: hostManipulation })}
    />
  );
}
