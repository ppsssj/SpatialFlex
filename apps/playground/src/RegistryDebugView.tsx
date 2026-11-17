import type {
  SpatialItemCapabilities,
  SpatialPosition,
  SpatialSize,
} from "@spatialflex/core";
import { useSpatialItems } from "@spatialflex/react";

const flags = (capabilities: SpatialItemCapabilities) =>
  Object.entries(capabilities)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(", ") || "none";
const formatPosition = (position: SpatialPosition | null) =>
  position ? `${position.x}, ${position.y}` : "—";
const formatSize = (size: SpatialSize | null) =>
  size ? `${size.width} × ${size.height}` : "natural";

/** Developer-facing view of the SpatialItems registered in the workspace. */
export function RegistryDebugView() {
  const items = useSpatialItems();

  return (
    <section aria-labelledby="registry-heading">
      <h2 id="registry-heading">Registry ({items.length})</h2>
      <p className="hint">
        Presentation metadata only. Position and panel size are CSS pixels; they
        are kept after Attach and reused by the next Detach.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Status</th>
            <th scope="col">Capabilities</th>
            <th scope="col">Panel position (x, y)</th>
            <th scope="col">Panel size</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} data-testid={`registry-${item.id}`}>
              <th scope="row">
                <code>{item.id}</code>
              </th>
              <td data-field="status">{item.status}</td>
              <td data-field="capabilities">{flags(item.capabilities)}</td>
              <td data-field="position">
                {formatPosition(item.layout.position)}
              </td>
              <td data-field="size">{formatSize(item.layout.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
