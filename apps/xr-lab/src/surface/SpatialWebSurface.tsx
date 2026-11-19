import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { PANEL_SIZE, type Vec3 } from "../contracts/xrHost";
import type {
  LabIntegration,
  PresentationOption,
  SurfaceItem,
} from "../integrations/contract";
import {
  containmentReason,
  nativeContainmentIssues,
  type ContainmentIssue,
} from "./nativeContainment";
import { SURFACE_RESOLUTION } from "./surfaceConfig";
import { extractionPosition } from "./surfaceMath";
import type { SurfaceCompositor } from "./useSurfaceCompositor";

type SourcePolicy = "visible" | "reserved" | "collapsed";
type Presentation = "native" | "adaptive";
type Support =
  | { readonly supported: true }
  | { readonly supported: false; readonly reason: string };
const SOURCES: readonly { value: SourcePolicy; label: string }[] = [
  { value: "reserved", label: "Reserve space" },
  { value: "visible", label: "Keep original" },
  { value: "collapsed", label: "Collapse" },
];
/** Height of the SDK panel bar shown above a natively extracted element. */
const NATIVE_BAR = 34;
interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The original dashboard, wrapped so the same mounted elements can be
 * presented either in place (inactive) or on the spatial web surface
 * (active). The element structure around `children` never changes, so
 * switching modes never remounts them.
 */
export function SpatialWebSurface({
  active,
  surface: {
    attachLayer,
    attachPage,
    pose,
    anchors,
    placeNative,
    nativeIssues,
    pageElement,
  },
  lab,
  children,
}: {
  active: boolean;
  surface: SurfaceCompositor;
  lab: LabIntegration;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const selectToggleRef = useRef<HTMLButtonElement>(null);
  const extractRef = useRef<HTMLButtonElement>(null);
  const [selecting, setSelecting] = useState(false);
  const [keyboardSelection, setKeyboardSelection] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [policy, setPolicy] = useState<SourcePolicy>("reserved");
  const [presentation, setPresentation] = useState<Presentation>("adaptive");
  const [notice, setNotice] = useState<string | null>(null);
  // Containment diagnostics of the selected component's ancestors, checked
  // when it is picked and again right before a Native DOM extraction.
  const [containment, setContainment] = useState<{
    readonly id: string;
    readonly issues: readonly ContainmentIssue[];
  } | null>(null);
  const items = lab.surfaceItems ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const checkContainment = (id: string) => {
    const source = lab.sourceElement?.(id);
    const page = pageElement();
    const issues = source && page ? nativeContainmentIssues(source, page) : [];
    setContainment({ id, issues });
    return issues;
  };
  const containmentOf = (id: string | undefined) =>
    containment && containment.id === id ? containment.issues : [];
  // The integration's support, narrowed by the containment diagnostics.
  const presentationsOf = (
    item: SurfaceItem,
    issues: readonly ContainmentIssue[] = containmentOf(item.id),
  ): Readonly<Record<Presentation, PresentationOption>> =>
    item.presentations.native.supported && issues.length > 0
      ? {
          ...item.presentations,
          native: { supported: false, reason: containmentReason(issues) },
        }
      : item.presentations;
  // Selection follows the registration: an unmounted component is deselected
  // (React's pattern for adjusting state while rendering; converges at once).
  if (selectedId && !selected) setSelectedId(null);
  const selectionMode = active && selecting;

  // Which source policies the chosen presentation supports, with reasons.
  const supportOf = (
    value: SourcePolicy,
    as: Presentation = presentation,
  ): Support => {
    if (!selected || !lab.validateExtraction)
      return { supported: false, reason: "Nothing selected." };
    const presentationSupport = presentationsOf(selected)[as];
    if (!presentationSupport.supported)
      return {
        supported: false,
        reason: presentationSupport.reason ?? "Unsupported presentation.",
      };
    return lab.validateExtraction(selected.id, {
      presentation: as,
      source: value,
    });
  };
  const choosePresentation = (next: Presentation) => {
    setPresentation(next);
    setNotice(null);
    if (!supportOf(policy, next).supported) {
      const fallback = SOURCES.find((s) => supportOf(s.value, next).supported);
      if (fallback) setPolicy(fallback.value);
    }
  };

  const pick = (item: SurfaceItem) => {
    setSelectedId(item.id);
    const presentations = presentationsOf(item, checkContainment(item.id));
    // Start from the component's declared (or derived) default strategy.
    // An unsupported default stays visible as unsupported, with its reason.
    const preferred = presentations[item.defaultPresentation].supported
      ? item.defaultPresentation
      : item.defaultPresentation === "native"
        ? "adaptive"
        : "native";
    setPresentation(preferred);
    if (preferred === "native" && policy === "visible") setPolicy("reserved");
    setSelecting(false);
    setHoveredId(null);
    setNotice(null);
    // Keyboard users continue at the action for the picked component.
    queueMicrotask(() =>
      (extractRef.current ?? selectToggleRef.current)?.focus(),
    );
  };

  const extract = () => {
    if (!selected || !lab.extract) return;
    // Ancestor styles may have changed since the component was picked.
    if (presentation === "native") {
      const issues = checkContainment(selected.id);
      if (issues.length > 0) {
        setNotice(containmentReason(issues));
        return;
      }
    }
    const validation = supportOf(policy);
    if (!validation.supported) {
      setNotice(validation.reason);
      return;
    }
    // Native panels keep the page's scale: same design, same size.
    const metersPerPixel = pose.width / SURFACE_RESOLUTION.width;
    const source = lab.sourceElement?.(selected.id);
    const size =
      presentation === "native" && source
        ? {
            width: source.offsetWidth * metersPerPixel,
            height: (source.offsetHeight + NATIVE_BAR) * metersPerPixel,
          }
        : PANEL_SIZE;
    const taken = items.flatMap((item) => {
      if (item.extraction?.presentation === "native") {
        const anchor = anchors.get(item.id);
        return anchor ? [anchor.position] : [];
      }
      return item.extraction?.position ? [item.extraction.position] : [];
    });
    let index = 0;
    let position = extractionPosition(pose, index, size);
    while (taken.some((p) => near(p, position)))
      position = extractionPosition(pose, ++index, size);
    if (presentation === "native")
      placeNative(selected.id, {
        position,
        rotation: pose.rotation,
        metersPerPixel,
      });
    const done = lab.extract(selected.id, {
      presentation,
      source: policy,
      position,
      ...(presentation === "native" && {
        rotation: pose.rotation,
        extent: size,
      }),
    });
    setNotice(done ? null : `${selected.label} could not be extracted.`);
  };

  // Escape leaves selection mode wherever focus is (inert content cannot
  // hold focus, so it may be on the document body).
  useEffect(() => {
    if (!selectionMode) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelecting(false);
      selectToggleRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectionMode]);

  return (
    <div
      ref={attachLayer}
      className="web-surface-layer"
      data-active={active ? "" : undefined}
    >
      <div
        ref={attachPage}
        className="web-surface-page"
        data-testid={active ? "web-surface" : undefined}
        style={
          active
            ? {
                width: SURFACE_RESOLUTION.width,
                height: SURFACE_RESOLUTION.height,
              }
            : undefined
        }
      >
        {active ? (
          <SurfaceChrome
            selecting={selecting}
            selected={selected}
            policy={policy}
            presentation={presentation}
            presentations={selected ? presentationsOf(selected) : null}
            supportOf={supportOf}
            nativeIssue={
              selected && nativeIssues.has(selected.id)
                ? containmentReason(nativeIssues.get(selected.id)!)
                : null
            }
            notice={notice}
            toggleRef={selectToggleRef}
            extractRef={extractRef}
            onToggle={(keyboard) => {
              setKeyboardSelection(keyboard);
              setSelecting((on) => !on);
              setHoveredId(null);
              setNotice(null);
            }}
            onPolicy={(next) => {
              setPolicy(next);
              setNotice(null);
            }}
            onPresentation={choosePresentation}
            onExtract={extract}
            onRestore={() => selected && lab.restore?.(selected.id)}
          />
        ) : null}
        <div ref={viewportRef} className="web-surface-viewport">
          <div
            ref={contentRef}
            className="web-surface-content"
            // The dedicated selection mode: page controls are inert, so only
            // the outlines of registered components can be picked.
            inert={selectionMode || undefined}
          >
            {children}
          </div>
          {active ? (
            <SelectionLayer
              items={items}
              lab={lab}
              selecting={selectionMode}
              focusFirst={keyboardSelection}
              selectedId={selectedId}
              hoveredId={hoveredId}
              viewportRef={viewportRef}
              contentRef={contentRef}
              onHover={setHoveredId}
              onPick={pick}
              onUnregistered={() =>
                setNotice(
                  "Only registered SpatialFlex components can be selected.",
                )
              }
            />
          ) : null}
        </div>
        {active
          ? (["tl", "tr", "bl", "br"] as const).map((corner) => (
              <span
                key={corner}
                className="web-surface-corner"
                data-surface-corner={corner}
                aria-hidden="true"
              />
            ))
          : null}
      </div>
    </div>
  );
}

const near = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.15;

function SurfaceChrome({
  selecting,
  selected,
  policy,
  presentation,
  presentations,
  supportOf,
  nativeIssue,
  notice,
  toggleRef,
  extractRef,
  onToggle,
  onPolicy,
  onPresentation,
  onExtract,
  onRestore,
}: {
  selecting: boolean;
  selected: SurfaceItem | null;
  policy: SourcePolicy;
  presentation: Presentation;
  presentations: Readonly<Record<Presentation, PresentationOption>> | null;
  supportOf(value: SourcePolicy): Support;
  /** A Native DOM extraction of the selected component that cannot be composited. */
  nativeIssue: string | null;
  notice: string | null;
  toggleRef: RefObject<HTMLButtonElement | null>;
  extractRef: RefObject<HTMLButtonElement | null>;
  /** `keyboard`: activated with the keyboard rather than a pointer. */
  onToggle(keyboard: boolean): void;
  onPolicy(policy: SourcePolicy): void;
  onPresentation(presentation: Presentation): void;
  onExtract(): void;
  onRestore(): void;
}) {
  const extraction = selected?.extraction ?? null;
  const message =
    notice ??
    (selecting
      ? "Select mode: click a highlighted SpatialFlex component (Esc to cancel)."
      : !selected
        ? "Interact with the website normally, or choose Select elements."
        : !selected.extractable
          ? `Unsupported: ${selected.reason ?? "cannot be extracted."}`
          : extraction?.presentation === "native"
            ? `Native DOM: the original ${selected.label} element itself (same node, ${extraction.presentationId}) is in space; its place is ${extraction.source === "collapsed" ? "collapsed" : "reserved"}.`
            : extraction
              ? `XR Adaptive: ${selected.label} is a separate live 3D panel (${extraction.presentationId ?? "presentation"}); original ${extraction.source === "reserved" ? "hidden, space reserved" : "kept visible"}.`
              : presentation === "native"
                ? `Native DOM moves the original ${selected.label} (its HTML, CSS and state) into space.`
                : `XR Adaptive shows ${selected.label} as a separate 3D panel with its own design.`);
  const blocked = SOURCES.map((s) => ({ ...s, support: supportOf(s.value) }));
  const current = blocked.find((s) => s.value === policy)!;
  return (
    <div
      className="web-surface-chrome"
      role="toolbar"
      aria-label="Spatial website controls"
    >
      <span className="web-surface-badge" title="Live HTML, not a screenshot">
        ● Live React website
      </span>
      <button
        ref={toggleRef}
        type="button"
        data-testid="surface-select-mode"
        aria-pressed={selecting}
        // A click synthesized by Enter/Space has no pointer clicks (detail 0).
        onClick={(event) => onToggle(event.detail === 0)}
      >
        {selecting ? "Cancel selection" : "Select elements"}
      </button>
      <span data-testid="surface-selected">
        {selected ? `Selected: ${selected.label}` : "Nothing selected"}
      </span>
      {selected && !extraction ? (
        <>
          <fieldset
            className="web-surface-presentation"
            data-testid="surface-presentation"
          >
            <legend>Presentation</legend>
            {(
              [
                ["native", "Native DOM", "original design"],
                ["adaptive", "XR Adaptive", "spatial redesign"],
              ] as const
            ).map(([value, name, hint]) => {
              const option = (presentations ?? selected.presentations)[value];
              return (
                <label
                  key={value}
                  title={option.supported ? hint : option.reason}
                >
                  <input
                    type="radio"
                    name="surface-presentation"
                    value={value}
                    data-testid={`surface-presentation-${value}`}
                    checked={presentation === value}
                    disabled={!option.supported}
                    onChange={() => onPresentation(value)}
                  />{" "}
                  {name} — {hint}
                  {!option.supported && " (unsupported)"}
                </label>
              );
            })}
          </fieldset>
          <label>
            Source layout{" "}
            <select
              data-testid="surface-source"
              value={policy}
              onChange={(e) => onPolicy(e.target.value as SourcePolicy)}
            >
              {blocked.map(({ value, label, support }) => (
                <option
                  key={value}
                  value={value}
                  disabled={!support.supported}
                  title={support.supported ? undefined : support.reason}
                >
                  {label}
                  {!support.supported && " (unsupported)"}
                </option>
              ))}
            </select>
          </label>
          <button
            ref={extractRef}
            type="button"
            data-testid="surface-extract"
            disabled={!selected.extractable || !current.support.supported}
            onClick={onExtract}
          >
            Extract to Space
          </button>
        </>
      ) : null}
      {selected && extraction ? (
        <button type="button" data-testid="surface-restore" onClick={onRestore}>
          Restore
        </button>
      ) : null}
      {nativeIssue ? (
        <span
          className="web-surface-message web-surface-issue"
          role="alert"
          data-testid="surface-native-issue"
        >
          {`Not composited, hidden until restored. ${nativeIssue}`}
        </span>
      ) : null}
      <span
        className="web-surface-message"
        role="status"
        data-testid="surface-message"
      >
        {message}
      </span>
      {selected &&
      !extraction &&
      presentations &&
      !presentations.native.supported &&
      selected.presentations.native.supported ? (
        <span
          className="web-surface-message web-surface-issue"
          data-testid="surface-native-diagnostic"
        >
          {presentations.native.reason}
        </span>
      ) : null}
      {selected && !extraction ? (
        <span className="web-surface-message" data-testid="surface-unsupported">
          {blocked
            .flatMap(({ label, support }) =>
              support.supported ? [] : [`${label}: ${support.reason}`],
            )
            .join(" ")}
        </span>
      ) : null}
    </div>
  );
}

/** Outlines of registered components, positioned in page layout pixels. */
function SelectionLayer({
  items,
  lab,
  selecting,
  focusFirst,
  selectedId,
  hoveredId,
  viewportRef,
  contentRef,
  onHover,
  onPick,
  onUnregistered,
}: {
  items: readonly SurfaceItem[];
  lab: LabIntegration;
  selecting: boolean;
  focusFirst: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  viewportRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  onHover(id: string | null): void;
  onPick(item: SurfaceItem): void;
  onUnregistered(): void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Readonly<Record<string, Box>>>({});
  const [extent, setExtent] = useState({ width: 0, height: 0 });
  const ids = items.map((item) => item.id).join("\n");

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const measure = () => {
      const next: Record<string, Box> = {};
      for (const id of ids ? ids.split("\n") : []) {
        // Only registered components resolve to an element.
        const element = lab.sourceElement?.(id);
        if (element) next[id] = offsetBox(element, viewport);
      }
      setBoxes((current) => (sameBoxes(current, next) ? current : next));
      setExtent((current) =>
        current.width === viewport.scrollWidth &&
        current.height === viewport.scrollHeight
          ? current
          : { width: viewport.scrollWidth, height: viewport.scrollHeight },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    for (const id of ids ? ids.split("\n") : []) {
      const element = lab.sourceElement?.(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ids, lab, viewportRef, contentRef]);

  // Like a picker: entering selection mode from the keyboard focuses the
  // first registered component (mouse users point at one instead).
  useEffect(() => {
    if (selecting && focusFirst)
      layerRef.current
        ?.querySelector<HTMLButtonElement>("button.surface-outline")
        ?.focus();
  }, [selecting, focusFirst]);

  return (
    <div
      ref={layerRef}
      className="surface-selection"
      data-selecting={selecting || undefined}
    >
      {selecting ? (
        <div
          className="surface-shield"
          data-testid="surface-shield"
          style={extent}
          onClick={onUnregistered}
        />
      ) : null}
      {items.map((item) => {
        const box = boxes[item.id];
        // A collapsed source has no layout box of its own.
        if (!box || box.width === 0) return null;
        const flags = {
          "data-surface-item": item.id,
          "data-selected": item.id === selectedId || undefined,
          "data-hovered": (selecting && item.id === hoveredId) || undefined,
          "data-extracted": item.extraction?.source,
          "data-presentation": item.extraction?.presentation,
          "data-unsupported": !item.extractable || undefined,
        };
        const state = [
          item.extraction &&
            `${item.extraction.presentation === "native" ? "native DOM in space" : "extracted"} · ${
              item.extraction.source === "visible"
                ? "original kept"
                : "space reserved"
            }`,
          item.id === selectedId && "selected",
          !item.extractable && "unsupported",
        ]
          .filter(Boolean)
          .join(" · ");
        const label = (
          <span className="surface-outline-label">
            {item.label}
            {state && ` — ${state}`}
          </span>
        );
        if (selecting)
          return (
            <button
              key={item.id}
              type="button"
              className="surface-outline"
              style={box}
              aria-label={`Select ${item.label}${state ? ` (${state})` : ""}`}
              {...flags}
              onPointerEnter={() => onHover(item.id)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(item.id)}
              onBlur={() => onHover(null)}
              onClick={() => onPick(item)}
            >
              {label}
            </button>
          );
        if (item.id !== selectedId && !item.extraction) return null;
        return (
          <div
            key={item.id}
            className="surface-outline"
            style={box}
            aria-hidden="true"
            {...flags}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}

/** Layout box relative to `container`, in untransformed CSS pixels. */
function offsetBox(element: HTMLElement, container: HTMLElement): Box {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = element;
  while (node && node !== container) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return {
    left,
    top,
    width: element.offsetWidth,
    height: element.offsetHeight,
  };
}

function sameBoxes(
  a: Readonly<Record<string, Box>>,
  b: Readonly<Record<string, Box>>,
) {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const x = a[key]!,
      y = b[key];
    return (
      !!y &&
      x.left === y.left &&
      x.top === y.top &&
      x.width === y.width &&
      x.height === y.height
    );
  });
}
