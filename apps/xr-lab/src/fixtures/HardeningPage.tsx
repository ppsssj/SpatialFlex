import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLabDiagnostics, useLabState, useLabStore } from "./context";
import { WidgetRendererContext, useWidgetRenderer } from "./spatialView";
import type { RenderWidget } from "./spatialView";

/**
 * P1-07A hardening fixture (`?fixture=hardening`): realistic components in
 * realistic CSS surroundings, to verify Native DOM extraction against the
 * browser's actual behavior. Each case wraps the same small component in a
 * different ancestor; the ancestor styles are plain application CSS that the
 * compositor neither knows nor changes.
 */

/** Ancestor surroundings, by case id. */
export const HARDENING_CASES = {
  "case-plain": { label: "Plain flow", wrap: "plain" },
  "case-scroll": { label: "Scroll container edge", wrap: "scroll" },
  "case-hidden": { label: "overflow: hidden edge", wrap: "hidden" },
  "case-clip": { label: "overflow: clip edge", wrap: "clip" },
  "case-positioned": { label: "Absolute + sticky", wrap: "positioned" },
  "case-stacking": { label: "Stacking context", wrap: "stacking" },
  "case-opacity": { label: "Translucent ancestor", wrap: "opacity" },
  "case-transform": { label: "Transformed ancestor", wrap: "transform" },
  "case-filter": { label: "Filtered ancestor", wrap: "filter" },
  "case-will-change": { label: "will-change: transform", wrap: "will-change" },
  "case-contain": { label: "contain: paint", wrap: "contain" },
  "case-container": { label: "Size container", wrap: "container" },
  "case-clip-path": { label: "clip-path ancestor", wrap: "clip-path" },
} as const;
export type HardeningCase = keyof typeof HARDENING_CASES;

const renderPlain: RenderWidget = (_, widget) => widget;

export function HardeningPage({
  renderWidget = renderPlain,
}: {
  renderWidget?: RenderWidget;
}) {
  return (
    <WidgetRendererContext value={renderWidget}>
      <section className="hardening" aria-labelledby="hardening-heading">
        <h2 id="hardening-heading">Native DOM hardening fixture</h2>
        <div className="hz-form-host">
          <InteractiveForm />
        </div>
        <div className="hz-grid">
          {(Object.keys(HARDENING_CASES) as HardeningCase[]).map((id) => (
            <Surroundings key={id} id={id}>
              <CaseWidget id={id} />
            </Surroundings>
          ))}
        </div>
        <HardeningDiagnostics />
      </section>
    </WidgetRendererContext>
  );
}

/** The ancestor styles of one case, around the registered component. */
function Surroundings({
  id,
  children,
}: {
  id: HardeningCase;
  children: ReactNode;
}) {
  const wrap = HARDENING_CASES[id].wrap;
  const scrollRef = useRef<HTMLDivElement>(null);
  // The scroll case starts scrolled, so its component straddles the edge.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 60;
  }, []);
  const cell = (inner: ReactNode, style?: CSSProperties) => (
    <div className="hz-cell" data-hz-case={id} data-hz-wrap={wrap}>
      <div className="hz-caption">{HARDENING_CASES[id].label}</div>
      <div className={`hz-wrap hz-${wrap}`} style={style}>
        {inner}
      </div>
    </div>
  );
  switch (wrap) {
    case "scroll":
      return (
        <div className="hz-cell" data-hz-case={id} data-hz-wrap={wrap}>
          <div className="hz-caption">{HARDENING_CASES[id].label}</div>
          <div
            ref={scrollRef}
            className="hz-wrap hz-scroll"
            data-testid="hz-scroller"
          >
            <div className="hz-spacer" />
            {children}
            <div className="hz-spacer" />
          </div>
        </div>
      );
    case "hidden":
    case "clip":
      // Partly outside its clipping container (negative offset).
      return cell(<div className="hz-overhang">{children}</div>);
    case "positioned":
      return cell(
        <div className="hz-sticky">
          <div className="hz-absolute">{children}</div>
        </div>,
      );
    default:
      return cell(children);
  }
}

function useFixtureMount(id: string) {
  const store = useLabStore();
  useEffect(() => store.componentMounted(id), [store, id]);
}

/** A small component with its own state and one click target. */
function CaseWidget({ id }: { id: HardeningCase }) {
  useFixtureMount(id);
  const [clicks, setClicks] = useState(0);
  const renderWidget = useWidgetRenderer();
  return renderWidget(
    id,
    <article className="widget hz-widget" aria-label={id}>
      <h3>{HARDENING_CASES[id].label}</h3>
      <button
        type="button"
        data-testid={`${id}-button`}
        onClick={() => setClicks((n) => n + 1)}
      >
        Clicks: {clicks}
      </button>
    </article>,
  );
}

/** Ids of the interactive form's controls. */
export const FORM_ID = "case-form";

/**
 * Real interactive controls with local state, an active store subscription,
 * nested click targets and a size that can change while extracted.
 */
function InteractiveForm() {
  useFixtureMount(FORM_ID);
  const renderWidget = useWidgetRenderer();
  const { actions } = useLabStore();
  const shared = useLabState((state) => state.sharedCount);
  const [buttonClicks, setButtonClicks] = useState(0);
  const [outerClicks, setOuterClicks] = useState(0);
  const [innerClicks, setInnerClicks] = useState(0);
  const [controlled, setControlled] = useState("controlled start");
  const [choice, setChoice] = useState("beta");
  const [keys, setKeys] = useState(0);
  const [rows, setRows] = useState(0);
  return renderWidget(
    FORM_ID,
    <article
      className="widget hz-form"
      aria-label="Interactive form"
      onKeyDown={() => setKeys((n) => n + 1)}
    >
      <h3>Interactive form</h3>
      <div className="hz-row">
        <button
          type="button"
          data-testid="form-button"
          onClick={() => setButtonClicks((n) => n + 1)}
        >
          Button: {buttonClicks}
        </button>
        <button
          type="button"
          data-testid="form-increment"
          onClick={actions.increment}
        >
          Shared +1
        </button>
        <output data-testid="form-shared">{shared}</output>
      </div>
      <label>
        Controlled{" "}
        <input
          data-testid="form-controlled"
          value={controlled}
          onChange={(event) => setControlled(event.target.value)}
        />
      </label>
      <output data-testid="form-controlled-echo">{controlled}</output>
      <label>
        Uncontrolled{" "}
        <input data-testid="form-uncontrolled" defaultValue="uncontrolled" />
      </label>
      <label>
        Notes{" "}
        <textarea
          data-testid="form-textarea"
          rows={2}
          defaultValue="multi-line"
        />
      </label>
      <label>
        Choice{" "}
        <select
          data-testid="form-select"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          <option value="alpha">alpha</option>
          <option value="beta">beta</option>
          <option value="gamma">gamma</option>
        </select>
      </label>
      {/* A clickable card with a nested button: both handlers run once. */}
      <div
        className="hz-card"
        data-testid="form-card"
        onClick={() => setOuterClicks((n) => n + 1)}
      >
        Card: <span data-testid="form-outer">{outerClicks}</span>{" "}
        <button
          type="button"
          data-testid="form-inner"
          onClick={() => setInnerClicks((n) => n + 1)}
        >
          Inner: {innerClicks}
        </button>
      </div>
      <div className="hz-row">
        <span data-testid="form-keys">Keys: {keys}</span>
        <button
          type="button"
          data-testid="form-grow"
          onClick={() => setRows((n) => (n >= 3 ? 0 : n + 1))}
        >
          Rows: {rows}
        </button>
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <p key={i} className="hz-extra" data-testid="form-extra">
          Extra row {i + 1}
        </p>
      ))}
    </article>,
  );
}

function HardeningDiagnostics() {
  const { activeSubscriptions, totalSubscribes, componentMounts } =
    useLabDiagnostics();
  const actionCount = useLabState((state) => state.actionCount);
  return (
    <dl className="diagnostics" aria-label="Fixture diagnostics">
      <dt>Shared actions</dt>
      <dd data-testid="action-count">{actionCount}</dd>
      <dt>Active state subscriptions</dt>
      <dd
        data-testid="active-subscriptions"
        data-total-subscribes={totalSubscribes}
      >
        {activeSubscriptions}
      </dd>
      <dt>Component effect mounts</dt>
      <dd data-testid="fixture-mounts">{JSON.stringify(componentMounts)}</dd>
    </dl>
  );
}
