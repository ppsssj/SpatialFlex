import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialController,
} from "@spatialflex/react";
import { GalleryImage } from "./GalleryImage";

/**
 * Known limitation, kept as a reproducible fixture (not solved):
 * a detached panel stays in its original DOM position, so an ancestor with
 * `transform` becomes its containing block (the panel is positioned relative
 * to the ancestor, not the viewport) and `overflow: hidden` clips it.
 *
 * Open the playground with `#containing-block-fixture` to see it.
 */
export function ContainingBlockFixture() {
  return (
    <main>
      <h1>Fixture: transformed, clipping ancestor</h1>
      <p className="hint">
        Known limitation. The item below sits inside an element with{" "}
        <code>transform</code> and <code>overflow: hidden</code>. When detached,
        its panel is offset by the ancestor's position and clipped by it.
        SpatialFlex does not support this layout yet.
      </p>
      <SpatialWorkspace>
        <DetachButton />
        <div className="problem-ancestor" data-testid="problem-ancestor">
          <SpatialItem id="fixture-item" label="Fixture" detachable movable>
            <GalleryImage label="Fixture" color="#8250df" />
          </SpatialItem>
        </div>
      </SpatialWorkspace>
    </main>
  );
}

function DetachButton() {
  const controller = useSpatialController();
  return (
    <button type="button" onClick={() => controller.detach("fixture-item")}>
      Detach fixture item
    </button>
  );
}
