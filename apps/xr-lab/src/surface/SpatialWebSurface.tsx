import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { PANEL_SIZE, type Vec3 } from "../contracts/xrHost";
import type { LabIntegration, SurfaceItem } from "../integrations/contract";
import { SURFACE_RESOLUTION } from "./surfaceConfig";
import { extractionPosition } from "./surfaceMath";
import type { SurfaceCompositor } from "./useSurfaceCompositor";

type SourcePolicy = "visible" | "reserved" | "collapsed";
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
  surface: { attachLayer, attachPage, pose },
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
  const [notice, setNotice] = useState<string | null>(null);
  const items = lab.surfaceItems ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? null;
  // Selection follows the registration: an unmounted component is deselected
  // (React's pattern for adjusting state while rendering; converges at once).
  if (selectedId && !selected) setSelectedId(null);
  const selectionMode = active && selecting;

  const pick = (item: SurfaceItem) => {
    setSelectedId(item.id);
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
    const validation = lab.validateSourceVisibility?.(policy);
    if (validation && !validation.supported) {
      setNotice(validation.reason);
      return;
    }
    const taken = items
      .map((item) => item.extraction?.position)
      .filter((p): p is Vec3 => !!p);
    let index = 0;
    let position = extractionPosition(pose, index, PANEL_SIZE);
    while (taken.some((p) => near(p, position)))
      position = extractionPosition(pose, ++index, PANEL_SIZE);
    if (!lab.extract(selected.id, { source: policy, position }))
      setNotice(`${selected.label} could not be extracted.`);
    else setNotice(null);
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
            notice={notice}
            toggleRef={selectToggleRef}
            extractRef={extractRef}
            onToggle={(keyboard) => {
              setKeyboardSelection(keyboard);
              setSelecting((on) => !on);
              setHoveredId(null);
              setNotice(null);
            }}
            onPolicy={setPolicy}
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
  notice,
  toggleRef,
  extractRef,
  onToggle,
  onPolicy,
  onExtract,
  onRestore,
}: {
  selecting: boolean;
  selected: SurfaceItem | null;
  policy: SourcePolicy;
  notice: string | null;
  toggleRef: RefObject<HTMLButtonElement | null>;
  extractRef: RefObject<HTMLButtonElement | null>;
  /** `keyboard`: activated with the keyboard rather than a pointer. */
  onToggle(keyboard: boolean): void;
  onPolicy(policy: SourcePolicy): void;
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
          : extraction
            ? `${selected.label} is a live 3D panel (${extraction.presentationId ?? "presentation"}); original ${extraction.source === "reserved" ? "hidden, space reserved" : "kept visible"}.`
            : `Extract ${selected.label} as a separate live 3D panel.`);
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
          <label>
            Original{" "}
            <select
              data-testid="surface-source"
              value={policy}
              onChange={(e) => onPolicy(e.target.value as SourcePolicy)}
            >
              <option value="reserved">Reserve space</option>
              <option value="visible">Keep original</option>
              <option value="collapsed" disabled>
                Collapse (unsupported)
              </option>
            </select>
          </label>
          <button
            ref={extractRef}
            type="button"
            data-testid="surface-extract"
            disabled={!selected.extractable}
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
      <span
        className="web-surface-message"
        role="status"
        data-testid="surface-message"
      >
        {message}
      </span>
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
        if (!box) return null;
        const flags = {
          "data-surface-item": item.id,
          "data-selected": item.id === selectedId || undefined,
          "data-hovered": (selecting && item.id === hoveredId) || undefined,
          "data-extracted": item.extraction?.source,
          "data-unsupported": !item.extractable || undefined,
        };
        const state = [
          item.extraction &&
            (item.extraction.source === "reserved"
              ? "extracted · space reserved"
              : "extracted · original kept"),
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
