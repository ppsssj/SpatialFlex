import {
  ItemManipulator,
  type ManipulablePresentation,
  type SpatialRay,
  type SpatialViewRecord,
} from "@spatialflex/core";
import {
  bindNativeHandles,
  containmentReason,
  NativeCompositor,
  nativeContainmentIssues,
  transformedQuad,
  viewportRay,
  type CameraFrame,
  type NativeIssues,
  type Vec3,
} from "@spatialflex/dom";
import {
  useSpatialController,
  useSpatialItems,
  useSpatialRegistry,
  useSpatialViews,
} from "@spatialflex/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Application-side glue between SpatialFlex and this app's 3D view. Every
 * SpatialFlex call goes through public package exports:
 *
 * - `@spatialflex/react`: the controller extracts and restores the original
 *   element (`extractNative`, `attach`) and resolves it (`nativeElement`).
 * - `@spatialflex/core`: `ItemManipulator` owns every pose and session.
 * - `@spatialflex/dom`: `NativeCompositor` places the original element per
 *   camera frame, `bindNativeHandles` connects SpatialItem's handles, the
 *   containment diagnostics refuse unsupported ancestors.
 *
 * The 3D view (`SpatialView`) only reports camera frames and pointer rays.
 */

/** World meters per CSS pixel of a native panel at scale 1. */
const METERS_PER_PIXEL = 0.0022;
const ADAPTIVE_SIZE = { width: 0.6, height: 0.4 } as const;

/** Start positions in front of the default camera, one slot per panel. */
const slot = (index: number): Vec3 => [
  -0.4 + (index % 2) * 0.8,
  1.6 - Math.floor(index / 2) * 0.55,
  -1,
];

interface NativeState {
  readonly instance: string;
  readonly position: Vec3;
  readonly extent: { readonly width: number; readonly height: number };
}
interface AdaptiveState {
  readonly instance: string;
  readonly registrationId: string;
  readonly position: Vec3;
}

export type Extraction = "native" | "adaptive";

export interface AdaptivePanel {
  readonly id: string;
  readonly instance: string;
  readonly view: SpatialViewRecord;
}

/** Read-only probe for the end-to-end tests (poses and sessions). */
declare global {
  interface Window {
    __spatialConsumer?: {
      targets: ItemManipulator["targets"];
      poseOf: ItemManipulator["poseOf"];
      getSnapshot: ItemManipulator["getSnapshot"];
    };
  }
}

export function useSpatialRuntime() {
  const controller = useSpatialController();
  const registry = useSpatialRegistry();
  const views = useSpatialViews();
  // Subscribed so that an unmounted (unregistered) component ends its
  // presentation in the next render: `controller.placement` alone is not
  // reactive, and an unmount happens after the render that caused it.
  const records = useSpatialItems();
  const [items] = useState(() => new ItemManipulator());
  const [issues, setIssues] = useState<NativeIssues>(() => new Map());
  const [compositor] = useState(
    () => new NativeCompositor({ onIssues: setIssues }),
  );
  const [natives, setNatives] = useState<ReadonlyMap<string, NativeState>>(
    () => new Map(),
  );
  const [adaptives, setAdaptives] = useState<
    ReadonlyMap<string, AdaptiveState>
  >(() => new Map());
  const generation = useRef(0);
  const camera = useRef<CameraFrame | null>(null);

  // Presentations that are still live: a native extraction ends when the
  // controller no longer places the item externally (restore, unmount), an
  // adaptive one when its registration is gone.
  const liveNatives = [...natives].filter(
    ([id]) =>
      records.some((r) => r.id === id && r.status === "detached") &&
      controller.placement(id) === "external",
  );
  const liveAdaptives = [...adaptives].filter(([id, a]) =>
    views.some((v) => v.id === id && v.registrationId === a.registrationId),
  );
  const manipulable: ManipulablePresentation[] = [
    ...liveNatives.map(([id, n]) => ({
      itemId: id,
      presentationId: n.instance,
      registrationId: registry.getView(id)?.registrationId ?? id,
      kind: "native" as const,
      initial: {
        position: n.position,
        rotation: [0, 0, 0, 1] as const,
        scale: 1,
      },
      extent: n.extent,
    })),
    ...liveAdaptives.map(([id, a]) => ({
      itemId: id,
      presentationId: a.instance,
      registrationId: a.registrationId,
      kind: "adaptive" as const,
      initial: {
        position: a.position,
        rotation: [0, 0, 0, 1] as const,
        scale: 1,
      },
      extent: ADAPTIVE_SIZE,
    })),
  ];
  const manipulableKey = JSON.stringify(manipulable);
  useLayoutEffect(() => {
    items.sync(JSON.parse(manipulableKey) as ManipulablePresentation[]);
  }, [items, manipulableKey]);

  const rayAt = useCallback(
    (x: number, y: number): SpatialRay | null =>
      camera.current ? viewportRay(camera.current, x, y) : null,
    [],
  );

  // The original elements: composited every frame, handles bound. Before
  // paint, so a restored element is never drawn with a stale transform.
  const nativeKey = JSON.stringify(
    liveNatives.map(([id, n]) => [id, n.instance]),
  );
  useLayoutEffect(() => {
    const targets = (JSON.parse(nativeKey) as [string, string][]).flatMap(
      ([id]) => {
        const element = controller.nativeElement(id);
        return element
          ? [
              {
                id,
                element,
                placement: () => {
                  const pose = items.poseOf(id);
                  return pose && { ...pose, metersPerPixel: METERS_PER_PIXEL };
                },
              },
            ]
          : [];
      },
    );
    compositor.setTargets(targets);
    const binding = bindNativeHandles(items, targets, rayAt);
    return () => binding.dispose();
  }, [nativeKey, controller, compositor, items, rayAt]);

  useEffect(() => {
    window.__spatialConsumer = {
      targets: items.targets,
      poseOf: items.poseOf,
      getSnapshot: items.getSnapshot,
    };
    return () => {
      delete window.__spatialConsumer;
      compositor.dispose();
      items.dispose();
    };
  }, [compositor, items]);

  /** Called by the 3D view after each rendered frame. */
  const onCameraFrame = useCallback(
    (frame: CameraFrame) => {
      camera.current = {
        viewProjection: Array.from(frame.viewProjection),
        viewport: { ...frame.viewport },
        eye: [...frame.eye],
      };
      // Adaptive panels in front of a native one cut it out.
      const occluders = items
        .targets()
        .flatMap((t) =>
          t.kind === "adaptive"
            ? [
                transformedQuad(
                  t.transform.position,
                  t.transform.rotation,
                  ADAPTIVE_SIZE.width * t.transform.scale,
                  ADAPTIVE_SIZE.height * t.transform.scale,
                ),
              ]
            : [],
        );
      compositor.composite(frame, { occluders });
    },
    [compositor, items],
  );

  const nextSlot = () => natives.size + adaptives.size;

  /** Ancestor styles that prevent Native DOM placement ("" if none). */
  const nativeBlocker = (id: string) => {
    const source = controller.sourceElement(id);
    return source
      ? containmentReason(nativeContainmentIssues(source, null))
      : "";
  };

  const restore = (id: string) => {
    if (natives.has(id)) {
      controller.attach(id);
      setNatives((m) => without(m, id));
    }
    if (adaptives.has(id)) setAdaptives((m) => without(m, id));
  };

  /** Extracts a component; returns why it was refused, or null. */
  const extract = (id: string, as: Extraction): string | null => {
    if (natives.has(id) || adaptives.has(id)) return "Already extracted.";
    if (as === "native") {
      // Checked right before extraction: ancestor styles may have changed.
      const blocker = nativeBlocker(id);
      if (blocker) return blocker;
      if (!controller.extractNative(id, "placeholder"))
        return "This component cannot be extracted.";
      const source = controller.nativeElement(id);
      setNatives((m) =>
        new Map(m).set(id, {
          instance: `native-${++generation.current}`,
          position: slot(nextSlot()),
          extent: {
            width: (source?.offsetWidth ?? 300) * METERS_PER_PIXEL,
            height: (source?.offsetHeight ?? 200) * METERS_PER_PIXEL,
          },
        }),
      );
      return null;
    }
    const view = registry.getView(id);
    if (!view)
      return "XR Adaptive needs a declared xr view on the SpatialItem.";
    setAdaptives((m) =>
      new Map(m).set(id, {
        instance: `presentation-${++generation.current}`,
        registrationId: view.registrationId,
        position: slot(nextSlot()),
      }),
    );
    return null;
  };

  const adaptivePanels: AdaptivePanel[] = liveAdaptives.flatMap(([id, a]) => {
    const view = views.find((v) => v.id === id);
    return view ? [{ id, instance: a.instance, view }] : [];
  });

  /** A semantic action of an adaptive panel, for its current registration. */
  const invoke = (panel: AdaptivePanel, actionId: string) =>
    registry.invokeView(panel.id, panel.view.registrationId, actionId);

  /** Restores everything (the 3D view is closing: nothing can place them). */
  const restoreAll = () => {
    for (const [id] of natives) controller.attach(id);
    setNatives(new Map());
    setAdaptives(new Map());
  };

  return {
    items,
    issues,
    natives: new Set(liveNatives.map(([id]) => id)),
    adaptives: new Set(liveAdaptives.map(([id]) => id)),
    adaptivePanels,
    onCameraFrame,
    extract,
    restore,
    restoreAll,
    nativeBlocker,
    invoke,
  };
}

export type SpatialRuntime = ReturnType<typeof useSpatialRuntime>;

function without<V>(map: ReadonlyMap<string, V>, id: string) {
  const next = new Map(map);
  next.delete(id);
  return next;
}
