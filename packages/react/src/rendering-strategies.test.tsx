// @vitest-environment jsdom
//
// Proof test for P0-03: which way of moving a mounted React subtree between
// the original layout and a detached panel keeps the component instance?
// It exercises React itself, not SpatialFlex code, and records why the
// SpatialItem implementation uses CSS positioning (strategy D).
import {
  act,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ThemeContext = createContext("none");
let lifecycle: { mounts: number; unmounts: number };

/** Counter with local state, a click handler and a context dependency. */
function Probe() {
  const [count, setCount] = useState(0);
  const theme = useContext(ThemeContext);
  useEffect(() => {
    lifecycle.mounts++;
    return () => {
      lifecycle.unmounts++;
    };
  }, []);
  return (
    <button data-probe onClick={() => setCount((c) => c + 1)}>
      {theme}:{count}
    </button>
  );
}

interface StrategyProps {
  detached: boolean;
  children: ReactNode;
}
type Strategy = (props: StrategyProps) => ReactNode;

// A. Portal whose target container changes on detach.
function PortalRetarget({ detached, children }: StrategyProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const overlay = document.getElementById("overlay")!;
  return (
    <div ref={setSlot}>
      {slot && createPortal(children, detached ? overlay : slot)}
    </div>
  );
}

// B. Rendering the children under a different parent element.
function ConditionalParent({ detached, children }: StrategyProps) {
  return detached ? (
    <section data-overlay>{children}</section>
  ) : (
    <div data-slot>{children}</div>
  );
}

// C. Portal into a stable host element that is moved with appendChild.
function RelocatedHost({ detached, children }: StrategyProps) {
  const [host] = useState(() => document.createElement("div"));
  const slotRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const parent = detached
      ? document.getElementById("overlay")!
      : slotRef.current!;
    parent.appendChild(host);
  }, [detached, host]);
  return <div ref={slotRef}>{createPortal(children, host)}</div>;
}

// D. Same element, switched to position: fixed.
function CssPositioned({ detached, children }: StrategyProps) {
  return (
    <div
      style={detached ? { position: "fixed", left: 40, top: 40 } : undefined}
    >
      {children}
    </div>
  );
}

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  lifecycle = { mounts: 0, unmounts: 0 };
  document.body.innerHTML = '<div id="app"></div><div id="overlay"></div>';
  container = document.getElementById("app")!;
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

function run(Strategy: Strategy) {
  const render = (detached: boolean) =>
    act(() =>
      root.render(
        <ThemeContext value="ocean">
          <Strategy detached={detached}>
            <Probe />
          </Strategy>
        </ThemeContext>,
      ),
    );
  const probe = () =>
    document.querySelector<HTMLButtonElement>("[data-probe]")!;
  const click = () => act(() => probe().click());

  render(false);
  for (let i = 0; i < 5; i++) click();
  const before = probe().textContent;
  probe().focus();
  render(true);
  const detached = probe().textContent;
  const keptFocus = document.activeElement === probe();
  click();
  const afterClick = probe().textContent;
  render(false);

  return {
    before,
    detached,
    afterClick,
    attached: probe().textContent,
    keptFocus,
    probes: document.querySelectorAll("[data-probe]").length,
    ...lifecycle,
  };
}

describe("rendering strategies for detach/attach", () => {
  it("A. retargeting a portal remounts the subtree and loses local state", () => {
    expect(run(PortalRetarget)).toMatchObject({
      before: "ocean:5",
      detached: "ocean:0",
      keptFocus: false,
      mounts: 3,
      unmounts: 2,
    });
  });

  it("B. changing the parent element remounts the subtree", () => {
    expect(run(ConditionalParent)).toMatchObject({
      before: "ocean:5",
      detached: "ocean:0",
      keptFocus: false,
      mounts: 3,
      unmounts: 2,
    });
  });

  it("C. moving a stable portal host keeps the instance but loses focus", () => {
    expect(run(RelocatedHost)).toEqual({
      before: "ocean:5",
      detached: "ocean:5",
      afterClick: "ocean:6",
      attached: "ocean:6",
      // The moved element is removed from the document for an instant.
      keptFocus: false,
      probes: 1,
      mounts: 1,
      unmounts: 0,
    });
  });

  it("D. CSS positioning of the same element keeps the instance and focus", () => {
    expect(run(CssPositioned)).toEqual({
      before: "ocean:5",
      detached: "ocean:5",
      afterClick: "ocean:6",
      attached: "ocean:6",
      keptFocus: true,
      probes: 1,
      mounts: 1,
      unmounts: 0,
    });
  });
});
