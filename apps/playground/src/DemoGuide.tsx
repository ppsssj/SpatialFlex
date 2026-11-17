/** Short walkthrough for developers opening the playground for the first time. */
export function DemoGuide() {
  return (
    <details className="demo-guide" open>
      <summary>What to try</summary>
      <ol>
        <li>
          Click <strong>Local count</strong> inside Image B a few times. This is
          React state local to Image B.
        </li>
        <li>
          <strong>Detach Image B</strong>. It floats as a panel; a dashed
          placeholder keeps its place, so Images A and C do not move.
        </li>
        <li>
          Drag the panel by its title bar and resize it from the bottom-right
          corner.
        </li>
        <li>
          Click <strong>Increment</strong> in the app or in the panel, and
          change Image B's variant or caption. Both views show the app's state.
        </li>
        <li>
          <strong>Attach</strong>. Image B returns to its original place and
          size with its local count, instance and mount counts unchanged.
        </li>
      </ol>
    </details>
  );
}
