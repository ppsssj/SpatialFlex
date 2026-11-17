import { SpatialRegistry } from "@spatialflex/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialItem,
  useSpatialItems,
} from "./index";

function ItemIds() {
  const ids = useSpatialItems().map((item) => item.id);
  return <output>{`items:[${ids.join(",")}]`}</output>;
}

function ItemB() {
  const item = useSpatialItem("image-b");
  return <output>{`b:${item ? item.status : "none"}`}</output>;
}

describe("server rendering", () => {
  it("renders useSpatialItems() with an empty list", () => {
    const html = renderToString(
      <SpatialWorkspace>
        <SpatialItem id="image-a">
          <img alt="Image A" />
        </SpatialItem>
        <ItemIds />
      </SpatialWorkspace>,
    );

    expect(html).toBe('<img alt="Image A"/><output>items:[]</output>');
  });

  it("renders useSpatialItem(id) as not registered", () => {
    const html = renderToString(
      <SpatialWorkspace>
        <SpatialItem id="image-b" />
        <ItemB />
      </SpatialWorkspace>,
    );

    expect(html).toBe("<output>b:none</output>");
  });

  it("ignores items already in an injected registry", () => {
    const registry = new SpatialRegistry();
    registry.register({ id: "image-a" });
    registry.register({ id: "image-b" });

    const html = renderToString(
      <SpatialWorkspace registry={registry}>
        <ItemIds />
        <ItemB />
      </SpatialWorkspace>,
    );

    expect(html).toBe("<output>items:[]</output><output>b:none</output>");
  });

  it("does not register items while rendering on the server", () => {
    const registry = new SpatialRegistry();

    renderToString(
      <SpatialWorkspace registry={registry}>
        <SpatialItem id="image-a" />
      </SpatialWorkspace>,
    );

    expect(registry.list()).toEqual([]);
  });
});
