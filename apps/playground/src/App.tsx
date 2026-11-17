import { VERSION as CORE_VERSION } from "@spatialflex/core";
import { useSpatialFlexVersion } from "@spatialflex/react";

export function App() {
  const linkedVersion = useSpatialFlexVersion();

  return (
    <main>
      <h1>SpatialFlex Playground</h1>
      <p>Development app for validating SpatialFlex packages.</p>
      <dl>
        <dt>@spatialflex/core</dt>
        <dd>{CORE_VERSION}</dd>
        <dt>@spatialflex/react (linked core)</dt>
        <dd>{linkedVersion}</dd>
      </dl>
    </main>
  );
}
