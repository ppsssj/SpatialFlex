import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setupEmulator } from "../devtools/emulator";
import "../styles.css";
import "./multiSurfaceXR.css";

// The emulator, if requested (`?xr-emulator=iwer`, test/dev builds only),
// must be the WebXR runtime before the host loads.
const emulator = await setupEmulator(window.location.search);
document.documentElement.dataset.xrEmulator = emulator.detail;
const { MultiSurfaceXRLab } = await import("./MultiSurfaceXRLab");

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <MultiSurfaceXRLab />
  </StrictMode>,
);
document.documentElement.dataset.ready = "1";
