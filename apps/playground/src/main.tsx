import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ContainingBlockFixture } from "./ContainingBlockFixture";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const page =
  window.location.hash === "#containing-block-fixture" ? (
    <ContainingBlockFixture />
  ) : (
    <App />
  );

createRoot(root).render(<StrictMode>{page}</StrictMode>);
