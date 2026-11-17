import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { CanvasFace, describeBody } from "./panelTexture";
import { recordDrawn } from "./probe";
import {
  BUTTON_SIZE,
  PANEL_SIZE,
  type HostEvents,
  type HostPanel,
} from "./types";

const CLOSE_SIZE = 0.06;

/** One floating panel: a textured plane, a button row and a close control. */
export function Panel3D({
  panel,
  events,
}: {
  panel: HostPanel;
  events: HostEvents;
}) {
  const face = useMemo(
    () => new CanvasFace(PANEL_SIZE.width, PANEL_SIZE.height),
    [],
  );
  useEffect(() => () => face.dispose(), [face]);

  useEffect(() => {
    face.drawPanel(panel.title, panel.body, panel.selected);
    recordDrawn(panel.id, describeBody(panel.body));
  }, [face, panel.id, panel.title, panel.body, panel.selected]);

  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    events.onPanelSelect(panel.id);
  };

  const rowY = -PANEL_SIZE.height / 2 + BUTTON_SIZE.height / 2 + 0.03;
  const spacing = BUTTON_SIZE.width + 0.03;
  const firstX = -((panel.buttons.length - 1) * spacing) / 2;

  return (
    <group position={[...panel.position]}>
      <mesh
        userData={{ hostPanelId: panel.id, hostPart: "background" }}
        onClick={select}
      >
        <planeGeometry args={[PANEL_SIZE.width, PANEL_SIZE.height]} />
        <meshBasicMaterial map={face.texture} toneMapped={false} />
      </mesh>
      {panel.buttons.map((button, i) => (
        <PanelButton
          key={button.id}
          panelId={panel.id}
          part={`button:${button.id}`}
          label={button.label}
          position={[firstX + i * spacing, rowY, 0.005]}
          size={BUTTON_SIZE}
          onActivate={() => events.onPanelButton(panel.id, button.id)}
        />
      ))}
      <PanelButton
        panelId={panel.id}
        part="close"
        label="x"
        position={[
          PANEL_SIZE.width / 2 - CLOSE_SIZE / 2 - 0.015,
          PANEL_SIZE.height / 2 - CLOSE_SIZE / 2 - 0.015,
          0.005,
        ]}
        size={{ width: CLOSE_SIZE, height: CLOSE_SIZE }}
        onActivate={() => events.onPanelClose(panel.id)}
      />
    </group>
  );
}

function PanelButton({
  panelId,
  part,
  label,
  position,
  size,
  onActivate,
}: {
  panelId: string;
  part: string;
  label: string;
  position: [number, number, number];
  size: { width: number; height: number };
  onActivate: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const face = useMemo(
    () => new CanvasFace(size.width, size.height),
    [size.width, size.height],
  );
  useEffect(() => () => face.dispose(), [face]);
  useEffect(() => face.drawButton(label, hovered), [face, label, hovered]);

  return (
    <mesh
      position={position}
      userData={{ hostPanelId: panelId, hostPart: part, hovered }}
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
      <planeGeometry args={[size.width, size.height]} />
      <meshBasicMaterial map={face.texture} toneMapped={false} />
    </mesh>
  );
}
