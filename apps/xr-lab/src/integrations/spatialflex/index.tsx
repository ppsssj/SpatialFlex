import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialRegistry,
  useSpatialViews,
  useSpatialController,
  useSpatialItems,
} from "@spatialflex/react";
import {
  useSpatialPresentations,
  type SpatialPresentation,
} from "@spatialflex/react/spatial";
import {
  assertDetachmentStrategy,
  assertExtraction,
  defaultPresentation,
  presentationSupport,
  validateExtraction,
  type ExtractionContext,
  SpatialFlexError,
  XR_MIRROR_STRATEGY,
  validateDetachmentStrategy,
  validateSourceVisibility,
} from "@spatialflex/core";
import { useCallback, useLayoutEffect, useState } from "react";
import { PANEL_SIZE, type Vec3 } from "../../contracts/xrHost";
import type { RenderWidget } from "../../fixtures";
import { quaternionFromEuler } from "../../surface/surfaceMath";
import type {
  IntegrationModule,
  LabIntegration,
  LabNativeHost,
} from "../contract";

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
/**
 * The lab's source policies mapped to the SDK runtime's source names. The
 * Lab says `collapsed` (a presentation policy); the controller argument is
 * `collapse`, and the reserved Native DOM source is the controller's
 * `placeholder`.
 */
const NATIVE_SOURCE = {
  reserved: "placeholder",
  collapsed: "collapse",
} as const;
const LAB_NATIVE_SOURCE = {
  placeholder: "reserved",
  collapse: "collapsed",
} as const;

/**
 * Lab layout policy of one Adaptive presentation instance: an explicit
 * extraction position (else its renderer slot) and the Move-button offset.
 * Keyed by the SDK instance id, so it can never apply to a later instance.
 */
interface PanelLayout {
  readonly anchor: Vec3 | null;
  readonly offset: Vec3;
}

/**
 * The SpatialFlex adapter of the lab (P1-07B3): a thin translation of the
 * shared `LabIntegration` contract onto the workspace's SDK
 * `PresentationRuntime` (`useSpatialPresentations`), the same runtime the
 * external consumer uses. The runtime owns presentation instances, their
 * liveness, the manipulator, the Native DOM compositor and its handles.
 * The adapter keeps lab policy only: panel slots, Move offsets, the
 * selection highlight and the lab's names for strategies.
 */
function useSpatialFlexIntegration(): LabIntegration {
  const registry = useSpatialRegistry();
  const controller = useSpatialController();
  const records = useSpatialItems();
  const views = useSpatialViews();
  // XR Adaptive instances keep the lab's established `presentation-N` ids.
  const { runtime, presentations, issues } =
    useSpatialPresentations(INSTANCE_PREFIX);
  const [layouts, setLayouts] = useState<ReadonlyMap<string, PanelLayout>>(
    () => new Map(),
  );
  const [selected, setSelected] = useState<string | null>(null);

  // The rendered presentations (what the host draws from this render).
  const rendered = new Map(presentations.map((p) => [p.itemId, p]));
  /** The Adaptive presentation of an item whose current view it presents. */
  const adaptiveOf = (id: string) => {
    const p = rendered.get(id);
    return p?.kind === "adaptive" &&
      views.some(
        (v) => v.id === id && v.registrationId === p.viewRegistrationId,
      )
      ? p
      : undefined;
  };
  const nativeOf = (id: string) => {
    const p = rendered.get(id);
    return p?.kind === "native" ? p : undefined;
  };
  const originOf = (p: SpatialPresentation, index: number): Vec3 => {
    const layout = layouts.get(p.instanceId);
    const [x, y, z] = layout?.anchor ?? slot(index);
    const [ox, oy, oz] = layout?.offset ?? [0, 0, 0];
    return [round(x + ox), round(y + oy), round(z + oz)];
  };
  const panels = presentations.flatMap((p) => {
    const index = views.findIndex(
      (v) => v.id === p.itemId && v.registrationId === p.viewRegistrationId,
    );
    const view = views[index];
    if (p.kind !== "adaptive" || !view) return [];
    return [
      {
        id: view.id,
        title: view.title,
        position: originOf(p, index),
        body: view.body,
        buttons: view.actions,
        selected: selected === p.instanceId,
      },
    ];
  });
  // Lab layout (slots, Move offsets) moves each panel's layout origin in
  // the runtime, which shifts its manipulated pose by the same amount.
  const origins = JSON.stringify(
    presentations.flatMap((p) => {
      const panel = panels.find((q) => q.id === p.itemId);
      return panel && p.kind === "adaptive"
        ? [[p.instanceId, panel.position]]
        : [];
    }),
  );
  useLayoutEffect(() => {
    for (const [instance, position] of JSON.parse(origins) as [string, Vec3][])
      runtime.relocate(instance, position);
  }, [runtime, origins]);

  // Host callbacks are bound to the presentation that actually drew them:
  // the rendered instance must still be the runtime's live one, for the
  // same registration and view epoch. A stale close/select/button never
  // reaches a later instance of a reused item id.
  const currentPresentation = (id: string) => {
    const drawn = adaptiveOf(id);
    if (!drawn || runtime.presentationOf(id) !== drawn) return;
    if (registry.registrationOf(id) !== drawn.registrationKey) return;
    if (registry.getView(id)?.registrationId !== drawn.viewRegistrationId)
      return;
    return drawn;
  };
  const showSource = (id: string) => {
    if (registry.get(id)?.layout.visible === false)
      controller.setSourceVisibility(id, "visible");
  };
  /** Updates one instance's layout; layouts of ended instances are dropped. */
  const updateLayout = (
    instance: string,
    update: (previous: PanelLayout | undefined) => PanelLayout,
  ) =>
    setLayouts((current) => {
      const live = new Set(
        runtime.getSnapshot().presentations.map((p) => p.instanceId),
      );
      const next = new Map([...current].filter(([key]) => live.has(key)));
      return next.set(instance, update(current.get(instance)));
    });
  /** Starts an Adaptive presentation at its layout origin. */
  const startAdaptive = (
    id: string,
    anchor: Vec3 | null,
    source: "visible" | "reserved",
  ) => {
    const index = views.findIndex((v) => v.id === id);
    const [x, y, z] = anchor ?? slot(index);
    const result = runtime.extract(id, "adaptive", {
      position: [round(x), round(y), round(z)],
      extent: PANEL_SIZE,
      source,
    });
    if (result.ok)
      updateLayout(result.presentation.instanceId, () => ({
        anchor,
        offset: [0, 0, 0],
      }));
    return result.ok;
  };
  // A same-document Move is undone before an XR presentation starts.
  const attachMoved = (id: string) => {
    if (controller.placement(id) === "viewport") controller.attach(id);
  };
  const end = (id: string) => {
    if (runtime.presentationOf(id)) {
      showSource(id);
      return runtime.restore(id);
    }
    // Not presented by the runtime: return an external original anyway.
    if (controller.placement(id) === "external") return controller.attach(id);
    showSource(id);
    return false;
  };
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
  // The page surface is the runtime's Native DOM host; renderer hosts draw
  // the Adaptive panels on their own, so it ends Native presentations only.
  const connectNativeHost = useCallback(
    (): LabNativeHost => runtime.connectHost({ drawsAdaptive: false }),
    [runtime],
  );
  const manipulation = runtime.manipulation;
  const targets = new Map(
    manipulation.targets().map((t) => [t.presentationId, t]),
  );

  return {
    source: "SpatialFlex registry",
    manipulation,
    connectNativeHost,
    nativeIssues: issues,
    validateStrategy: validateDetachmentStrategy,
    items: views.map((v) => {
      const p = adaptiveOf(v.id);
      return {
        id: v.id,
        label: v.title,
        shown: !!p,
        selected: !!p && selected === p.instanceId,
        detached: records.find((r) => r.id === v.id)?.status === "detached",
        ...(p && { presentationId: p.instanceId }),
      };
    }),
    panels,
    actionOwners: Object.fromEntries(
      presentations.flatMap((p) =>
        adaptiveOf(p.itemId) === p
          ? [[p.itemId, `${p.viewRegistrationId}/${p.instanceId}`]]
          : [],
      ),
    ),
    show(id, options = XR_MIRROR_STRATEGY) {
      const strategy = assertDetachmentStrategy(options);
      if (strategy.mode !== "mirror")
        throw new SpatialFlexError(
          "UNSUPPORTED_STRATEGY",
          "XR show accepts Mirror + Visible + XR only.",
        );
      const view = registry.getView(id);
      if (!view || !views.some((v) => v.registrationId === view.registrationId))
        return false;
      if (runtime.presentationOf(id)?.kind === "adaptive") return true;
      attachMoved(id);
      return startAdaptive(id, null, "visible");
    },
    hide: end,
    surfaceItems: records.map((record) => {
      const view = views.find((v) => v.id === record.id);
      const adaptive = adaptiveOf(record.id);
      const panel = adaptive && panels.find((p) => p.id === record.id);
      const native = nativeOf(record.id);
      const context = contextOf(record.id);
      const support = {
        native: presentationSupport("native", context),
        adaptive: presentationSupport("adaptive", context),
      };
      const moved = record.status === "detached" && !native;
      const extractable =
        !moved && (support.native.supported || support.adaptive.supported);
      const start = native && targets.get(native.instanceId);
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
              source:
                LAB_NATIVE_SOURCE[native.source as "placeholder" | "collapse"],
              presentationId: native.instanceId,
              ...(start && { position: start.initial.position }),
            }
          : adaptive && panel
            ? {
                presentation: "adaptive",
                source: record.layout.visible ? "visible" : "reserved",
                presentationId: adaptive.instanceId,
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
    extract(
      id,
      {
        presentation: requested = "adaptive",
        source,
        position,
        rotation,
        extent,
        metersPerPixel,
      },
    ) {
      if (!registry.has(id)) return false;
      // Untrusted lab input, validated with the SDK's reasons.
      const request = assertExtraction(
        { presentation: requested, source },
        contextOf(id),
      );
      if (request.presentation === "native") {
        if (runtime.presentationOf(id)?.kind === "native") return false;
        return runtime.extract(id, "native", {
          position: [position[0], position[1], position[2]],
          rotation: quaternionFromEuler(rotation ?? [0, 0, 0]),
          ...(metersPerPixel !== undefined && { metersPerPixel }),
          extent: extent ?? PANEL_SIZE,
          source: NATIVE_SOURCE[request.source as keyof typeof NATIVE_SOURCE],
        }).ok;
      }
      if (position.length !== 3 || !position.every(Number.isFinite))
        throw new SpatialFlexError(
          "INVALID_LAYOUT",
          "An extraction position must be three finite meters.",
        );
      const view = registry.getView(id);
      if (!view || !views.some((v) => v.registrationId === view.registrationId))
        return false;
      if (runtime.presentationOf(id)?.kind === "adaptive") return false;
      attachMoved(id);
      return startAdaptive(
        id,
        [position[0], position[1], position[2]],
        request.source === "reserved" ? "reserved" : "visible",
      );
    },
    restore: end,
    detach(id, options) {
      const strategy = assertDetachmentStrategy(options);
      if (strategy.mode !== "move")
        throw new SpatialFlexError(
          "UNSUPPORTED_STRATEGY",
          "DOM detach accepts Move strategies only.",
        );
      // Validate/carry out the move before removing a valid existing mirror.
      const result = controller.detach(id, strategy);
      if (registry.getView(id)) {
        showSource(id);
        if (runtime.presentationOf(id)?.kind === "adaptive")
          runtime.restore(id);
      }
      return result;
    },
    attach: controller.attach,
    move(id, [dx, dy, dz]) {
      const p = runtime.presentationOf(id);
      if (p?.kind !== "adaptive" || adaptiveOf(id) !== p) return false;
      updateLayout(p.instanceId, (layout) => {
        const [x, y, z] = layout?.offset ?? [0, 0, 0];
        return {
          anchor: layout?.anchor ?? null,
          offset: [round(x + dx), round(y + dy), round(z + dz)],
        };
      });
      return true;
    },
    onPanelButton(id, action) {
      const p = currentPresentation(id);
      if (p) runtime.invoke(p.instanceId, action);
    },
    onPanelSelect(id) {
      const p = currentPresentation(id);
      if (p) {
        setSelected(p.instanceId);
        manipulation.select(id);
      }
    },
    onPanelClose(id) {
      if (currentPresentation(id)) end(id);
    },
    renderWidget,
  };
}

const INSTANCE_PREFIX = { instancePrefix: { adaptive: "presentation" } };

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
