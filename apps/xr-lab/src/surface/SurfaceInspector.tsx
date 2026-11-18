import type { Vec3 } from "../contracts/xrHost";
import type { LabIntegration } from "../integrations/contract";
import {
  DEFAULT_SURFACE_POSE,
  MAX_SURFACE_WIDTH,
  MIN_SURFACE_WIDTH,
  POSE_STEP,
  SCALE_STEP,
  SURFACE_RESOLUTION,
} from "./surfaceConfig";
import type { SpatialWebSurfacePose } from "./surfaceMath";
import type { SurfaceCompositor, SurfaceStatus } from "./useSurfaceCompositor";

const MOVES: { label: string; delta: Vec3 }[] = [
  { label: "Left", delta: [-POSE_STEP, 0, 0] },
  { label: "Right", delta: [POSE_STEP, 0, 0] },
  { label: "Up", delta: [0, POSE_STEP, 0] },
  { label: "Down", delta: [0, -POSE_STEP, 0] },
  { label: "Closer", delta: [0, 0, POSE_STEP] },
  { label: "Farther", delta: [0, 0, -POSE_STEP] },
];

const STATUS: Record<SurfaceStatus, string> = {
  waiting: "waiting for the first camera frame",
  visible: "visible, perspective-anchored to the 3D world",
  back: "hidden: the camera is behind the surface (Reset view)",
  behind: "hidden: the surface crosses the camera plane (Reset view)",
};

const round = (n: number) => Math.round(n * 1000) / 1000;
const fmt = (v: Vec3) => v.map((n) => round(n).toFixed(2)).join(", ");

/** Status and placement of the spatial website. DOM only. */
export function SurfaceInspector({
  surface,
  lab,
  engine,
  workspaceMounted,
}: {
  surface: SurfaceCompositor;
  lab: LabIntegration;
  engine: string;
  workspaceMounted: boolean;
}) {
  const { pose, setPose, status } = surface;
  const extracted = (lab.surfaceItems ?? []).filter((item) => item.extraction);
  const update = (
    next: (pose: SpatialWebSurfacePose) => SpatialWebSurfacePose,
  ) => setPose((current) => next(current));
  const scale = (factor: number) =>
    update((p) => {
      const width = Math.min(
        MAX_SURFACE_WIDTH,
        Math.max(MIN_SURFACE_WIDTH, round(p.width * factor)),
      );
      return {
        ...p,
        width,
        height: round(
          (width * SURFACE_RESOLUTION.height) / SURFACE_RESOLUTION.width,
        ),
      };
    });
  return (
    <section className="surface-inspector" aria-labelledby="surface-heading">
      <h2 id="surface-heading">Spatial website</h2>
      <p className="hint">
        The dashboard on the 3D surface is the original React application: live
        HTML composited with a perspective transform that follows the 3D camera.
        It is not a screenshot and not WebGL geometry. Use{" "}
        <strong>Select elements</strong> on the surface to extract a registered
        component as <strong>Native DOM</strong> (the original element itself,
        moved into space with its design and state) or{" "}
        <strong>XR Adaptive</strong> (a separate renderer-native live XR panel).
        The application keeps owning state and actions either way.
      </p>
      <dl className="diagnostics">
        <dt>Surface</dt>
        <dd data-testid="surface-status" data-value={status}>
          {workspaceMounted
            ? STATUS[status]
            : "workspace unmounted: the dashboard is shown in place"}
        </dd>
        <dt>Renderer</dt>
        <dd>{engine}, same-document desktop</dd>
        <dt>Anchor</dt>
        <dd
          data-testid="surface-pose"
          data-pose={JSON.stringify(pose)}
          data-resolution={JSON.stringify(SURFACE_RESOLUTION)}
        >
          center ({fmt(pose.position)}) m, yaw{" "}
          {Math.round((pose.rotation[1] * 180) / Math.PI)}°,{" "}
          {pose.width.toFixed(2)} × {pose.height.toFixed(2)} m (
          {SURFACE_RESOLUTION.width} × {SURFACE_RESOLUTION.height} CSS px)
        </dd>
      </dl>
      <div
        className="surface-pose-controls"
        role="group"
        aria-label="Move surface"
      >
        {MOVES.map(({ label, delta }) => (
          <button
            key={label}
            type="button"
            aria-label={`Move surface ${label.toLowerCase()}`}
            onClick={() =>
              update((p) => ({
                ...p,
                position: [
                  round(p.position[0] + delta[0]),
                  round(p.position[1] + delta[1]),
                  round(p.position[2] + delta[2]),
                ],
              }))
            }
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          aria-label="Scale surface down"
          onClick={() => scale(1 / SCALE_STEP)}
        >
          Smaller
        </button>
        <button
          type="button"
          aria-label="Scale surface up"
          onClick={() => scale(SCALE_STEP)}
        >
          Larger
        </button>
        <button type="button" onClick={() => setPose(DEFAULT_SURFACE_POSE)}>
          Reset surface
        </button>
      </div>
      <h3>Extracted to space</h3>
      {extracted.length === 0 ? (
        <p className="hint" data-testid="surface-extractions-empty">
          Nothing extracted yet. Select a component on the surface, then choose
          Extract to Space.
        </p>
      ) : (
        <ul className="surface-extractions" data-testid="surface-extractions">
          {extracted.map((item) => (
            <li key={item.id} data-testid={`surface-extraction-${item.id}`}>
              <strong>{item.label}</strong> —{" "}
              {item.extraction!.presentation === "native" ? (
                <>
                  Native DOM (the original element),{" "}
                  {item.extraction!.presentationId} at (
                  {fmt(surface.anchors.get(item.id)?.position ?? [0, 0, 0])}) m;
                  source{" "}
                  {item.extraction!.source === "collapsed"
                    ? "collapsed"
                    : "space reserved"}
                </>
              ) : (
                <>
                  XR Adaptive,{" "}
                  {item.extraction!.presentationId ?? "presentation"} at (
                  {fmt(item.extraction!.position ?? [0, 0, 0])}) m; original{" "}
                  {item.extraction!.source === "reserved"
                    ? "hidden, space reserved"
                    : "kept visible"}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <h3>Not supported in this milestone</h3>
      <ul className="hint">
        <li>
          XR Adaptive + Collapse: the adaptive source stays mounted in place, so
          its footprint is kept visible or reserved. Native DOM + Keep original:
          there is only one original instance.
        </li>
        <li>
          Immersive WebXR display of the HTML surface: browsers do not composite
          DOM into an immersive session.
        </li>
        <li>Cross-context iframe Host and arbitrary external websites.</li>
      </ul>
    </section>
  );
}
