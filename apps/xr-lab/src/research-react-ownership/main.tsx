import {
  createContext,
  StrictMode,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import "./style.css";

const log: string[] = [];
const context = createContext("missing");
let parentClicks = 0;
class MoveProbe extends HTMLElement {
  connectedCallback() {
    log.push("connected");
  }
  disconnectedCallback() {
    log.push("disconnected");
  }
  connectedMoveCallback() {
    log.push("moved");
  }
}
customElements.define("move-probe", MoveProbe);
function Card() {
  const [count, setCount] = useState(0);
  const [value, setValue] = useState("initial");
  const theme = useContext(context);
  useEffect(() => {
    log.push("mount");
    return () => {
      log.push("cleanup");
    };
  }, []);
  useEffect(() => {
    const holder = document.querySelector("[data-custom-holder]");
    if (!holder) return;
    const node = document.createElement("move-probe");
    holder.append(node);
    return () => node.remove();
  }, []);
  return (
    <article className="card" data-testid="card">
      <h2>Card</h2>
      <span data-testid="context">{theme}</span>
      <button data-testid="counter" onClick={() => setCount((n) => n + 1)}>
        Count: {count}
      </button>
      <input
        aria-label="Controlled input"
        data-testid="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <p data-testid="query">Query</p>
      <div data-custom-holder />
    </article>
  );
}
const params = new URLSearchParams(location.search);
const initial = params.get("mode") ?? "local";
function App() {
  const [portal, setPortal] = useState(initial !== "local");
  const [destination, setDestination] = useState("portal-a");
  const [revision, setRevision] = useState(0);
  const [visible, setVisible] = useState(true);
  const [theme, setTheme] = useState(false);
  const [parentVersion, setParentVersion] = useState(0);
  const card = visible ? <Card /> : null;
  return (
    <context.Provider value="ocean">
      <div
        className={theme ? "dashboard alternate" : "dashboard"}
        onClick={() => {
          parentClicks++;
        }}
      >
        <div id="source" key={parentVersion}>
          {portal ? null : card}
        </div>
        <div id="same">Same-root target</div>
        <button
          data-testid="rerender"
          onClick={() => setRevision((v) => v + 1)}
        >
          Revision: {revision}
        </button>
        <button
          data-testid="switch-portal"
          onClick={() =>
            setDestination((v) => (v === "portal-a" ? "portal-b" : "portal-a"))
          }
        >
          Switch portal
        </button>
        <button
          data-testid="toggle-portal"
          onClick={() => setPortal((v) => !v)}
        >
          Toggle portal
        </button>
        <button
          data-testid="replace-parent"
          onClick={() => setParentVersion((v) => v + 1)}
        >
          Replace parent
        </button>
        <button data-testid="theme" onClick={() => setTheme((v) => !v)}>
          Theme
        </button>
        <button data-testid="remove" onClick={() => setVisible((v) => !v)}>
          Toggle child
        </button>
        {portal && createPortal(card, document.getElementById(destination)!)}
      </div>
    </context.Provider>
  );
}
const rootNode = document.getElementById("root")!;
const root = createRoot(rootNode);
const app = <App />;
root.render(params.has("strict") ? <StrictMode>{app}</StrictMode> : app);
const secondRoot = createRoot(document.getElementById("second-root")!);
secondRoot.render(<div id="second-target">Second root target</div>);
let source: Element | null = null;
let card: Element | null = null;
function move(destination: string, method: string) {
  card ??= document.querySelector('[data-testid="card"]');
  if (!card) throw new Error("Card missing");
  source ??= card.parentElement;
  const target = document.getElementById(destination)!;
  if (method === "moveBefore") {
    const candidate = target as Element & {
      moveBefore?: (node: Node, before: Node | null) => void;
    };
    if (!candidate.moveBefore) return "unsupported";
    candidate.moveBefore(card, null);
  } else if (method === "insertBefore") target.insertBefore(card, null);
  else target.appendChild(card);
  return "moved";
}
function restore() {
  if (source && card) source.appendChild(card);
}
Object.assign(window, {
  ownershipProbe: {
    log,
    move,
    restore,
    unmount: () => root.unmount(),
    parentClicks: () => parentClicks,
    supported: () => "moveBefore" in Element.prototype,
  },
});
