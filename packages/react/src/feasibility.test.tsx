// @vitest-environment jsdom
/**
 * P1-06A feasibility evidence: approaches rejected for Native DOM extraction.
 * These tests pass when the *failure* is reproduced, documenting why
 * SpatialFlex keeps the original node in place and changes presentation only.
 */
import { act, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounts = 0;
function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    mounts++;
  }, []);
  return (
    <button data-counter onClick={() => setCount((c) => c + 1)}>
      {count}
    </button>
  );
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  mounts = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  try {
    act(() => root.unmount());
  } catch {
    // The re-parenting experiment leaves React's tree inconsistent.
  }
  document.body.replaceChildren();
});

describe("rejected Native DOM extraction approaches", () => {
  it("moving content between portal targets remounts it and loses local state", () => {
    const a = document.createElement("section");
    const b = document.createElement("section");
    document.body.append(a, b);
    const render = (target: HTMLElement) =>
      act(() => root.render(createPortal(<Counter />, target, "panel")));
    render(a);
    act(() => a.querySelector<HTMLButtonElement>("[data-counter]")!.click());
    const before = a.querySelector("[data-counter]");
    expect(before!.textContent).toBe("1");
    render(b);
    const after = b.querySelector("[data-counter]");
    // A new instance and a new node: state and identity are lost.
    expect(after).not.toBe(before);
    expect(after!.textContent).toBe("0");
    expect(mounts).toBe(2);
  });

  it("re-parenting a React-owned node outside React breaks later reconciliation", () => {
    function App({ show }: { show: boolean }) {
      return (
        <div data-parent>
          {show && <Counter />}
          <span>sibling</span>
        </div>
      );
    }
    act(() => root.render(<App show />));
    const node = container.querySelector("[data-counter]")!;
    const elsewhere = document.createElement("aside");
    document.body.append(elsewhere);
    elsewhere.append(node); // what a naive "move to space" would do
    // React still believes the node is a child of [data-parent].
    expect(() => act(() => root.render(<App show={false} />))).toThrow(
      /not a child|removeChild/i,
    );
  });
});
