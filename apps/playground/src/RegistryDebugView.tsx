import { useSpatialItems } from "@spatialflex/react";

const flag = (value: boolean) => (value ? "yes" : "no");

/** Developer-facing view of the SpatialItems registered in the workspace. */
export function RegistryDebugView() {
  const items = useSpatialItems();

  return (
    <section aria-labelledby="registry-heading">
      <h2 id="registry-heading">Registry ({items.length})</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Status</th>
            <th scope="col">Detachable</th>
            <th scope="col">Movable</th>
            <th scope="col">Resizable</th>
            <th scope="col">Layout</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <th scope="row">
                <code>{item.id}</code>
              </th>
              <td>{item.status}</td>
              <td>{flag(item.capabilities.detachable)}</td>
              <td>{flag(item.capabilities.movable)}</td>
              <td>{flag(item.capabilities.resizable)}</td>
              <td>
                <code>{JSON.stringify(item.layout)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
