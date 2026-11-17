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

/** Markup of an attached <SpatialItem>. */
const attachedItem = (id: string, children = "") =>
  `<div data-spatialflex-item="${id}" data-status="attached">` +
  `<div data-spatialflex-panel="" data-status="attached">${children}</div></div>`;

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

    const items =
      attachedItem("image-a", '<img alt="Image A">') + attachedItem("image-b");
    expect(serverHtml).toBe(
      items + "<output>items:[]</output><output>b:none</output>",
    );
    expect(recoverableErrors).toEqual([]);
    expect(container.innerHTML).toBe(
      items +
        "<output>items:[image-a,image-b]</output><output>b:attached</output>",
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

  it("detaches and attaches a hydrated item without duplicating it", () => {
    const registry = new SpatialRegistry();
    const view = (registry?: SpatialRegistry) => (
      <SpatialWorkspace {...(registry && { registry })}>
        <SpatialItem id="image-b" detachable>
          <p>B</p>
        </SpatialItem>
      </SpatialWorkspace>
    );
    const { container, serverHtml, recoverableErrors } = serverRenderAndHydrate(
      view(),
      view(registry),
    );
    const paragraph = container.querySelector("p");

    expect(serverHtml).toBe(attachedItem("image-b", "<p>B</p>"));
    expect(recoverableErrors).toEqual([]);

    act(() => registry.detach("image-b", { position: { x: 10, y: 20 } }));
    const panel = container.querySelector<HTMLElement>(
      "[data-spatialflex-panel]",
    )!;
    expect(panel.dataset.status).toBe("detached");
    expect(panel.style.position).toBe("fixed");

    act(() => registry.attach("image-b"));
    expect(panel.dataset.status).toBe("attached");
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("p")).toBe(paragraph);
  });
});
