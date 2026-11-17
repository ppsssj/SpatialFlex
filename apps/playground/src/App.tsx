import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialController,
  useSpatialItem,
} from "@spatialflex/react";
import { useState } from "react";
import { GalleryImage } from "./GalleryImage";
import { GalleryThemeContext } from "./GalleryTheme";
import { LiveCounter } from "./LiveCounter";
import { RegistryDebugView } from "./RegistryDebugView";
import "./App.css";

const THEMES = ["ocean", "forest", "sunset"];

export function App() {
  const [showImageC, setShowImageC] = useState(true);
  const [theme, setTheme] = useState(THEMES[0]!);

  return (
    <main>
      <h1>SpatialFlex Playground</h1>
      <GalleryThemeContext value={theme}>
        <SpatialWorkspace>
          <section aria-labelledby="gallery-heading">
            <h2 id="gallery-heading">Gallery</h2>
            <div className="controls">
              <DetachToggle id="image-b" label="Image B" />
              <label>
                Theme{" "}
                <select
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
                <GalleryImage label="Image B" color="#c2410c" />
                <LiveCounter />
              </SpatialItem>
              {showImageC && (
                <SpatialItem id="image-c" detachable>
                  <GalleryImage label="Image C" color="#15803d" />
                </SpatialItem>
              )}
            </div>
          </section>
          <RegistryDebugView />
        </SpatialWorkspace>
      </GalleryThemeContext>
    </main>
  );
}

function DetachToggle({ id, label }: { id: string; label: string }) {
  const controller = useSpatialController();
  const detached = useSpatialItem(id)?.status === "detached";

  return (
    <button
      type="button"
      onClick={() => (detached ? controller.attach(id) : controller.detach(id))}
    >
      {detached ? `Attach ${label}` : `Detach ${label}`}
    </button>
  );
}
