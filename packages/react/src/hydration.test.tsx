// @vitest-environment jsdom
import { SpatialRegistry } from "@spatialflex/core";
import { act, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialItem,
  useSpatialItems,
} from "./index";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function ItemIds() {
  const ids = useSpatialItems().map((item) => item.id);
  return <output>{`items:[${ids.join(",")}]`}</output>;
}

function ItemB() {
  const item = useSpatialItem("image-b");
  return <output>{`b:${item ? item.status : "none"}`}</output>;
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

/**
 * Renders `server` to HTML, then hydrates it with `client`. Returns the
 * container and any hydration errors React recovered from.
 */
function serverRenderAndHydrate(server: ReactNode, client: ReactNode) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(server);
  const serverHtml = container.innerHTML;
  const recoverableErrors: unknown[] = [];

  act(() => {
    root = hydrateRoot(container, client, {
      onRecoverableError: (error) => recoverableErrors.push(error),
    });
  });

  return { container, serverHtml, recoverableErrors };
}

const gallery = (registry?: SpatialRegistry) => (
  <SpatialWorkspace {...(registry && { registry })}>
    <SpatialItem id="image-a">
      <img alt="Image A" />
    </SpatialItem>
    <SpatialItem id="image-b" movable />
    <ItemIds />
    <ItemB />
  </SpatialWorkspace>
);

describe("hydration", () => {
  it("hydrates without mismatches and then shows registered items", () => {
    const { container, serverHtml, recoverableErrors } = serverRenderAndHydrate(
      gallery(),
      gallery(),
    );

    expect(serverHtml).toBe(
      '<img alt="Image A"><output>items:[]</output><output>b:none</output>',
    );
    expect(recoverableErrors).toEqual([]);
    expect(container.innerHTML).toBe(
      '<img alt="Image A"><output>items:[image-a,image-b]</output><output>b:attached</output>',
    );
  });

  it("hydrates a client registry that is already populated", () => {
    const clientRegistry = new SpatialRegistry();
    clientRegistry.register({ id: "image-z" });

    const view = (registry?: SpatialRegistry) => (
      <SpatialWorkspace {...(registry && { registry })}>
        <ItemIds />
      </SpatialWorkspace>
    );
    const { container, recoverableErrors } = serverRenderAndHydrate(
      view(),
      view(clientRegistry),
    );

    expect(recoverableErrors).toEqual([]);
    expect(container.innerHTML).toBe("<output>items:[image-z]</output>");
  });
});
