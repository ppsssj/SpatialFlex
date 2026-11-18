import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialRegistry,
  useSpatialViews,
  useSpatialController,
  useSpatialItems,
} from "@spatialflex/react";
import {
  assertDetachmentStrategy,
  assertExtraction,
  defaultPresentation,
  presentationSupport,
  validateExtraction,
  type ExtractionContext,
  assertSourceVisibility,
  SpatialFlexError,
  XR_MIRROR_STRATEGY,
  validateDetachmentStrategy,
  validateSourceVisibility,
} from "@spatialflex/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RenderWidget } from "../../fixtures";
import { usePresentation } from "../common/presentation";
import type { IntegrationModule, LabIntegration } from "../contract";

// Generic translation only: no widget IDs, application state or action table.
const renderWidget: RenderWidget = (id, widget, view) => (
  <SpatialItem
    id={id}
    {...(view && { label: view.title })}
    xr={view}
    detachable
    movable
    resizable
  >
    {widget}
  </SpatialItem>
);
function useSpatialFlexIntegration(): LabIntegration {
  const registry = useSpatialRegistry();
  const controller = useSpatialController();
  const records = useSpatialItems();
  const views = useSpatialViews();
  // Presentation membership follows the registration, not its reusable item ID.
  const available = useMemo(() => views.map((v) => v.registrationId), [views]);
  const { presentation, show, hide, move, select } = usePresentation(available);
  const instances = useRef(new Map<string, string>());
  const [natives, setNatives] = useState<
    ReadonlyMap<string, { source: "reserved" | "collapsed"; instance: string }>
  >(() => new Map());
  const nativeGeneration = useRef(0);
  const generation = useRef(0);
  const [capturedInstances, setInstances] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const publishInstances = () => setInstances(new Map(instances.current));
  useEffect(() => {
    const unsubscribe = registry.subscribeViews(() => {
      const current = new Set(registry.views().map((v) => v.registrationId));
      let changed = false;
      for (const id of instances.current.keys()) {
        if (!current.has(id)) {
          instances.current.delete(id);
          changed = true;
        }
      }
      if (changed) setInstances(new Map(instances.current));
    });
    const activeInstances = instances.current;
    return () => {
      unsubscribe();
      activeInstances.clear();
    };
  }, [registry]);
  const panels = presentation.shown.flatMap((registrationId) => {
    const index = views.findIndex((v) => v.registrationId === registrationId);
    const view = views[index];
    if (!view) return [];
    const id = view.id;
    const [x, y, z] = presentation.anchors?.[registrationId] ?? slot(index);
    const [ox, oy, oz] = presentation.offsets[registrationId] ?? [0, 0, 0];
    return [
      {
        id,
        title: view.title,
        position: [round(x + ox), round(y + oy), round(z + oz)] as const,
        body: view.body,
        buttons: view.actions,
        selected: presentation.selected === registrationId,
      },
    ];
  });
  // Host callbacks are bound to the presentation that actually drew them.
  // A stale close/select must not affect a later instance either.
  const currentPresentation = (id: string) => {
    const view = views.find((v) => v.id === id);
    if (!view || !presentation.shown.includes(view.registrationId)) return;
    const instance = capturedInstances.get(view.registrationId);
    if (
      instance &&
      instance === instances.current.get(view.registrationId) &&
      registry.getView(id)?.registrationId === view.registrationId
    )
      return view;
  };
  // Ending a presentation always presents the original again.
  const showSource = (id: string) => {
    if (registry.get(id)?.layout.visible === false)
      controller.setSourceVisibility(id, "visible");
  };
  const beginPresentation = (registrationId: string) => {
    if (!instances.current.has(registrationId)) {
      instances.current.set(
        registrationId,
        `presentation-${++generation.current}`,
      );
      publishInstances();
    }
  };
  const endPresentation = (id: string, registrationId: string) => {
    showSource(id);
    instances.current.delete(registrationId);
    publishInstances();
    return hide(registrationId);
  };
  // Native DOM extractions: presentation instance and source policy per id.
  // Valid only while the controller reports the external placement.
  const nativeOf = (id: string) =>
    controller.placement(id) === "external" ? natives.get(id) : undefined;
  const contextOf = (id: string): ExtractionContext => {
    const record = registry.get(id);
    return {
      detachable: !!record?.capabilities.detachable,
      hasView: !!registry.getView(id),
      // Surface items are offered only by hosts with a same-document DOM
      // compositor (the shell disables the surface otherwise).
      nativeHost: true,
    };
  };
  const hideItem = (id: string) => {
    if (controller.placement(id) === "external") {
      setNatives((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      return controller.attach(id);
    }
    const view = registry.getView(id);
    if (!view) {
      showSource(id);
      return false;
    }
    return endPresentation(id, view.registrationId);
  };
  return {
    source: "SpatialFlex registry",
    validateStrategy: validateDetachmentStrategy,
    items: views.map((v) => ({
      id: v.id,
      label: v.title,
      shown: presentation.shown.includes(v.registrationId),
      selected: presentation.selected === v.registrationId,
      detached: records.find((r) => r.id === v.id)?.status === "detached",
      ...(capturedInstances.get(v.registrationId) && {
        presentationId: capturedInstances.get(v.registrationId)!,
      }),
    })),
    panels,
    actionOwners: Object.fromEntries(
      views
        .filter((v) => presentation.shown.includes(v.registrationId))
        .map((v) => [
          v.id,
          `${v.registrationId}/${capturedInstances.get(v.registrationId)}`,
        ]),
    ),
    show(id, options = XR_MIRROR_STRATEGY) {
      const strategy = assertDetachmentStrategy(options);
      if (strategy.mode !== "mirror")
        throw new SpatialFlexError(
          "UNSUPPORTED_STRATEGY",
          "XR show accepts Mirror + Visible + XR only.",
        );
      const view = registry.getView(id);
      if (!view || !available.includes(view.registrationId)) return false;
      controller.attach(id);
      beginPresentation(view.registrationId);
      return show(view.registrationId);
    },
    hide: hideItem,
    surfaceItems: records.map((record) => {
      const view = views.find((v) => v.id === record.id);
      const shown = !!view && presentation.shown.includes(view.registrationId);
      const panel = shown ? panels.find((p) => p.id === record.id) : undefined;
      const presentationId = view && capturedInstances.get(view.registrationId);
      const native = nativeOf(record.id);
      const context = contextOf(record.id);
      const support = {
        native: presentationSupport("native", context),
        adaptive: presentationSupport("adaptive", context),
      };
      const moved = record.status === "detached" && !native;
      const extractable =
        !moved && (support.native.supported || support.adaptive.supported);
      return {
        id: record.id,
        label: view?.title ?? record.id,
        defaultPresentation: defaultPresentation(
          registry.presentationOf(record.id),
          !!view,
        ),
        presentations: support,
        extractable,
        ...(moved
          ? { reason: "Moved in its document; attach it first." }
          : !extractable && {
              reason: [support.native, support.adaptive]
                .map((s) => (s.supported ? "" : s.reason))
                .join(" "),
            }),
        extraction: native
          ? {
              presentation: "native",
              source: native.source,
              presentationId: native.instance,
            }
          : panel
            ? {
                presentation: "adaptive",
                source: record.layout.visible ? "visible" : "reserved",
                ...(presentationId && { presentationId }),
                position: panel.position,
              }
            : null,
      };
    }),
    validateExtraction: (id, request) => {
      const result = validateExtraction(request, contextOf(id));
      return result.supported ? { supported: true } : result;
    },
    nativeElement: controller.nativeElement,
    validateSourceVisibility,
    sourceElement: controller.sourceElement,
    extract(id, { presentation: requested = "adaptive", source, position }) {
      if (!registry.has(id)) return false;
      const request = assertExtraction(
        { presentation: requested, source },
        contextOf(id),
      );
      if (request.presentation === "native") {
        if (controller.placement(id) === "external") return false;
        // One presentation per item: end an adaptive mirror first.
        const view = registry.getView(id);
        if (view && presentation.shown.includes(view.registrationId))
          endPresentation(id, view.registrationId);
        if (
          !controller.extractNative(
            id,
            request.source === "collapsed" ? "collapse" : "placeholder",
          )
        )
          return false;
        const native = {
          source: request.source,
          instance: `native-${++nativeGeneration.current}`,
        };
        setNatives((current) => new Map(current).set(id, native));
        return true;
      }
      const visibility = assertSourceVisibility(request.source);
      if (position.length !== 3 || !position.every(Number.isFinite))
        throw new SpatialFlexError(
          "INVALID_LAYOUT",
          "An extraction position must be three finite meters.",
        );
      const view = registry.getView(id);
      if (!view || !available.includes(view.registrationId)) return false;
      if (presentation.shown.includes(view.registrationId)) return false;
      controller.attach(id);
      beginPresentation(view.registrationId);
      if (!show(view.registrationId, [position[0], position[1], position[2]]))
        return false;
      controller.setSourceVisibility(id, visibility);
      return true;
    },
    restore: hideItem,
    detach(id, options) {
      const strategy = assertDetachmentStrategy(options);
      if (strategy.mode !== "move")
        throw new SpatialFlexError(
          "UNSUPPORTED_STRATEGY",
          "DOM detach accepts Move strategies only.",
        );
      // Validate/carry out the move before removing a valid existing mirror.
      const result = controller.detach(id, strategy);
      const view = registry.getView(id);
      if (view) endPresentation(id, view.registrationId);
      return result;
    },
    attach: controller.attach,
    move(id, delta) {
      const view = registry.getView(id);
      return view ? move(view.registrationId, delta) : false;
    },
    onPanelButton(id, action) {
      const view = currentPresentation(id);
      if (view) registry.invokeView(id, view.registrationId, action);
    },
    onPanelSelect(id) {
      const view = currentPresentation(id);
      if (view) select(view.registrationId);
    },
    onPanelClose(id) {
      const view = currentPresentation(id);
      if (view) endPresentation(id, view.registrationId);
    },
    renderWidget,
  };
}

// Renderer-owned placement; independent of component identity or domain state.
const slot = (index: number): readonly [number, number, number] => {
  if (index === 0) return [0, 1.4, -1.2];
  if (index === 1) return [-0.75, 1.4, -1];
  if (index === 2) return [0.75, 1.4, -1];
  return [(((index - 3) % 3) - 1) * 0.75, 2, -1.3];
};
const round = (value: number) => Math.round(value * 1000) / 1000;
export const spatialflexIntegration: IntegrationModule = {
  id: "spatialflex",
  Provider: SpatialWorkspace,
  useIntegration: useSpatialFlexIntegration,
};
