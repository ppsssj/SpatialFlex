import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MultiSurfaceLab } from "./MultiSurfaceLab";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <MultiSurfaceLab />
  </StrictMode>,
);
document.documentElement.dataset.ready = "1";
