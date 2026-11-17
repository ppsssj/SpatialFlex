import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { recordDrawn } from "../../contracts/hostProbe";
import {
  PANEL_SIZE,
  panelLayout,
  type HostEvents,
  type HostPanel,
  type PanelPart,
} from "../../contracts/xrHost";
import { describeBody } from "../shared/panelFace";
import { CanvasFace } from "./panelTexture";

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

  const [background, ...controls] = panelLayout(panel);

  return (
    <group position={[...panel.position]}>
      <mesh
        userData={{ hostPanelId: panel.id, hostPart: background!.part }}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          events.onPanelSelect(panel.id);
        }}
      >
        <planeGeometry args={[background!.width, background!.height]} />
        <meshBasicMaterial map={face.texture} toneMapped={false} />
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
    </group>
  );
}

function PanelControl({
  panelId,
  part,
  onActivate,
}: {
  panelId: string;
  part: PanelPart;
  onActivate: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const face = useMemo(
    () => new CanvasFace(part.width, part.height),
    [part.width, part.height],
  );
  useEffect(() => () => face.dispose(), [face]);
  useEffect(
    () => face.drawButton(part.label ?? "", hovered),
    [face, part.label, hovered],
  );

  return (
    <mesh
      position={[...part.center]}
      userData={{ hostPanelId: panelId, hostPart: part.part, hovered }}
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
      <meshBasicMaterial map={face.texture} toneMapped={false} />
    </mesh>
  );
}
