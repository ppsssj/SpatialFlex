import type { SpatialRegistry } from "@spatialflex/core";
import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialController,
  useSpatialItem,
} from "@spatialflex/react";
import { useState } from "react";
import { GalleryStoreContext } from "./galleryContext";
import { GalleryImage } from "./GalleryImage";
import { DemoGuide } from "./DemoGuide";
import { createGalleryStore, type GalleryStore } from "./galleryStore";
import { GalleryThemeContext } from "./GalleryTheme";
import { LiveCounter } from "./LiveCounter";
import {
  DomainDiagnosticsView,
  DomainImageB,
  ImageBControls,
  SharedCounter,
} from "./LiveDomain";
import { RegistryDebugView } from "./RegistryDebugView";
import "./App.css";

const THEMES = ["ocean", "forest", "sunset"];

export interface AppProps {
  /** Application-owned domain store. Tests inject one to inspect it. */
  store?: GalleryStore;
  /** SpatialFlex registry. Tests inject one to inspect it. */
  registry?: SpatialRegistry;
}

export function App({ store, registry }: AppProps) {
  const [ownStore] = useState(() => store ?? createGalleryStore());
  const [showImageC, setShowImageC] = useState(true);
  const [theme, setTheme] = useState(THEMES[0]!);

  return (
    <main>
      <h1>SpatialFlex Playground</h1>
      <p className="hint">
        Same-Host proof of concept: detach, move and resize a registered
        component while it stays connected to this app.
      </p>
      <DemoGuide />
      <GalleryStoreContext value={store ?? ownStore}>
        <GalleryThemeContext value={theme}>
          <SpatialWorkspace {...(registry && { registry })}>
            <section aria-labelledby="gallery-heading">
              <h2 id="gallery-heading">Gallery</h2>
              <div className="controls">
                <DetachToggle id="image-b" label="Image B" />
                <DetachToggle id="image-c" label="Image C" />
                <label>
                  Theme{" "}
                  <select
                    data-testid="theme-select"
                    value={theme}
                    onChange={(event) => setTheme(event.target.value)}
                  >
                    {THEMES.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={showImageC}
                    onChange={(event) => setShowImageC(event.target.checked)}
                  />{" "}
                  Mount Image C
                </label>
              </div>
              <SharedCounter location="app" />
              <ImageBControls />
              <div className="gallery">
                <SpatialItem id="image-a" detachable movable resizable>
                  <GalleryImage label="Image A" color="#2f6fdf" />
                </SpatialItem>
                <SpatialItem
                  id="image-b"
                  label="Image B"
                  detachable
                  movable
                  resizable
                >
                  <DomainImageB />
                  <SharedCounter location="image-b" />
                  <LiveCounter />
                </SpatialItem>
                {showImageC && (
                  // Detachable only: no dragging, no resize handle.
                  <SpatialItem id="image-c" label="Image C" detachable>
                    <GalleryImage label="Image C" color="#15803d" />
                  </SpatialItem>
                )}
              </div>
            </section>
            <DomainDiagnosticsView />
            <RegistryDebugView />
          </SpatialWorkspace>
        </GalleryThemeContext>
      </GalleryStoreContext>
    </main>
  );
}

function DetachToggle({ id, label }: { id: string; label: string }) {
  const controller = useSpatialController();
  const record = useSpatialItem(id);
  const detached = record?.status === "detached";

  return (
    <button
      type="button"
      disabled={!record}
      onClick={() => (detached ? controller.attach(id) : controller.detach(id))}
    >
      {detached ? `Attach ${label}` : `Detach ${label}`}
    </button>
  );
}
