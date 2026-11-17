import { VERSION } from "@spatialflex/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useSpatialFlexVersion } from "./index";

function VersionLabel() {
  return <span>{useSpatialFlexVersion()}</span>;
}

describe("@spatialflex/react", () => {
  it("exposes the core version to React components", () => {
    expect(renderToString(<VersionLabel />)).toBe(`<span>${VERSION}</span>`);
  });
});
