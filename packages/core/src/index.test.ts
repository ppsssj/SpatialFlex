import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { VERSION } from "./index";

describe("@spatialflex/core", () => {
  it("exports a VERSION that matches package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });
});
