import { SpatialItem, SpatialWorkspace } from "@spatialflex/react";
import { useState } from "react";
import { GalleryImage } from "./GalleryImage";
import { RegistryDebugView } from "./RegistryDebugView";
import "./App.css";

export function App() {
  const [showImageC, setShowImageC] = useState(true);

  return (
    <main>
      <h1>SpatialFlex Playground</h1>
      <SpatialWorkspace>
        <section aria-labelledby="gallery-heading">
          <h2 id="gallery-heading">Gallery</h2>
          <label>
            <input
              type="checkbox"
              checked={showImageC}
              onChange={(event) => setShowImageC(event.target.checked)}
            />{" "}
            Mount Image C
          </label>
          <div className="gallery">
            <SpatialItem id="image-a" detachable movable resizable>
              <GalleryImage label="Image A" color="#2f6fdf" />
            </SpatialItem>
            <SpatialItem id="image-b" detachable movable resizable>
              <GalleryImage label="Image B" color="#c2410c" />
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
    </main>
  );
}
