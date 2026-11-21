/**
 * P1-08A2 research: independently mounted Surfaces.
 *
 * Each Surface is one host element plus one React root (`createRoot`), and
 * one incarnation in the P1-08A `SurfaceTable` (unique `SurfaceRef`: id and
 * epoch). Removing a Surface unmounts its root and ends its incarnation;
 * adding it again creates a new root and a new epoch. Nothing is shared
 * between A and B except the document.
 */
import { createRoot, type Root } from "react-dom/client";
import {
  SurfaceTable,
  type SurfaceRef,
} from "../../../../../packages/core/src/workspace/index.js";
import { SURFACE_RES, geometryOf, type Placement } from "./scene.js";
import { SURFACE_COLORS, SurfaceApp } from "./SurfaceApp.js";

export type SurfaceId = "A" | "B";

export interface MountedSurface {
  readonly id: SurfaceId;
  readonly ref: SurfaceRef;
  readonly host: HTMLElement;
  readonly root: Root;
}

export interface SurfaceOptions {
  readonly ticking: boolean;
  readonly nativeExtracted: boolean;
  readonly nativeDrawable: boolean;
  readonly nativeLayoutLeft: number;
}

export class SurfaceHosts {
  readonly table = new SurfaceTable();
  readonly mounted = new Map<SurfaceId, MountedSurface>();
  /** Every incarnation ever created, so tests can check stale refs. */
  readonly history: SurfaceRef[] = [];

  constructor(private readonly options: SurfaceOptions) {}

  /** Creates the host and root; the caller places the host in the document. */
  add(id: SurfaceId, placement: Placement): MountedSurface {
    // Minimal owner: the research page has no SpatialRegistry, so an item's
    // registration key is the Surface incarnation itself.
    const ref = this.table.add(id, geometryOf(placement, SURFACE_RES), {
      registrationOf: (itemId: string) => `${id}:${ref.epoch}:${itemId}`,
    });
    const host = document.createElement("div");
    host.id = `surface-${id}`;
    host.dataset.surface = id;
    host.dataset.epoch = String(ref.epoch);
    Object.assign(host.style, {
      position: "absolute",
      left: "0px",
      top: "0px",
      width: `${SURFACE_RES.width}px`,
      height: `${SURFACE_RES.height}px`,
      background: SURFACE_COLORS[id].bg,
      overflow: "visible",
    });
    const root = createRoot(host);
    root.render(
      <SurfaceApp
        id={id}
        epoch={ref.epoch}
        ticking={this.options.ticking}
        nativeExtracted={this.options.nativeExtracted}
        nativeDrawable={this.options.nativeDrawable}
        nativeLayoutLeft={this.options.nativeLayoutLeft}
      />,
    );
    const mounted = { id, ref, host, root };
    this.mounted.set(id, mounted);
    this.history.push(ref);
    return mounted;
  }

  /** Unmounts the root, removes the host and ends the incarnation. */
  remove(id: SurfaceId): boolean {
    const m = this.mounted.get(id);
    if (!m) return false;
    m.root.unmount();
    m.host.remove();
    this.mounted.delete(id);
    return this.table.remove(m.ref);
  }

  setPlacement(id: SurfaceId, placement: Placement) {
    const m = this.mounted.get(id);
    if (m) this.table.setGeometry(m.ref, geometryOf(placement, SURFACE_RES));
  }

  isCurrent(ref: SurfaceRef, itemId: string): boolean {
    return this.table.isCurrent({
      surface: ref,
      itemId,
      registrationKey: `${ref.surfaceId}:${ref.epoch}:${itemId}`,
    });
  }
}
