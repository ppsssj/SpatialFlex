import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { recordDrawn } from "../../contracts/hostProbe";
import { perfCount } from "../../performance/collector";
import {
  handleLayout,
  PANEL_SIZE,
  panelLayout,
  type HostEvents,
  type HostManipulationMode,
  type HostPanel,
  type PanelPart,
} from "../../contracts/xrHost";
import { describeBody } from "../shared/panelFace";
import { CanvasFace, decodeFaceColor } from "./panelTexture";
import type { HandleDown } from "./ThreeHost";

/**
 * One floating panel: a textured plane, a button row and a close control,
 * plus manipulation handles when `handles` is given. Its pose (position,
 * rotation and uniform scale) comes from the panel data.
 */
export function Panel3D({
  panel,
  events,
  handles,
}: {
  panel: HostPanel;
  events: HostEvents;
  handles: {
    active: HostManipulationMode | null;
    onDown: HandleDown;
  } | null;
}) {
  // Benchmark counters (no-ops unless a P1-07C/D collector is measuring).
  perfCount("three.panelRender");
  useEffect(() => perfCount("three.panelCommit"));
  const face = useMemo(
    () => new CanvasFace(PANEL_SIZE.width, PANEL_SIZE.height),
    [],
  );
  useEffect(() => () => face.dispose(), [face]);

  useEffect(() => {
    face.drawPanel(panel.title, panel.body, panel.selected);
    recordDrawn(panel.id, describeBody(panel.body));
  }, [face, panel.id, panel.title, panel.body, panel.selected]);

  const [background, ...controls] = panelLayout(panel);

  return (
    <group
      position={[...panel.position]}
      quaternion={[...(panel.rotation ?? IDENTITY)]}
      scale={panel.scale ?? 1}
    >
      <mesh
        userData={{ hostPanelId: panel.id, hostPart: background!.part }}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          events.onPanelSelect(panel.id);
        }}
      >
        <planeGeometry args={[background!.width, background!.height]} />
        <meshBasicMaterial
          map={face.texture}
          toneMapped={false}
          onBeforeCompile={decodeFaceColor}
        />
      </mesh>
      {controls.map((part) => (
        <PanelControl
          key={part.part}
          panelId={panel.id}
          part={part}
          onActivate={() =>
            part.buttonId
              ? events.onPanelButton(panel.id, part.buttonId)
              : events.onPanelClose(panel.id)
          }
        />
      ))}
      {handles
        ? handleLayout().map((part) => (
            <PanelControl
              key={part.part}
              panelId={panel.id}
              part={part}
              pressed={handles.active === part.handle}
              onPointerDown={(event) =>
                handles.onDown(panel.id, part.handle!, event)
              }
              // A handle press selects nothing and activates nothing.
              onActivate={() => {}}
            />
          ))
        : null}
    </group>
  );
}

const IDENTITY = [0, 0, 0, 1] as const;

function PanelControl({
  panelId,
  part,
  onActivate,
  pressed = false,
  onPointerDown,
}: {
  panelId: string;
  part: PanelPart;
  onActivate: () => void;
  pressed?: boolean;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const face = useMemo(
    () => new CanvasFace(part.width, part.height),
    [part.width, part.height],
  );
  useEffect(() => () => face.dispose(), [face]);
  useEffect(
    () => face.drawButton(part.label ?? "", hovered || pressed),
    [face, part.label, hovered, pressed],
  );

  return (
    <mesh
      position={[...part.center]}
      userData={{ hostPanelId: panelId, hostPart: part.part, hovered }}
      {...(onPointerDown && { onPointerDown })}
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <planeGeometry args={[part.width, part.height]} />
      <meshBasicMaterial
        map={face.texture}
        toneMapped={false}
        onBeforeCompile={decodeFaceColor}
      />
    </mesh>
  );
}
