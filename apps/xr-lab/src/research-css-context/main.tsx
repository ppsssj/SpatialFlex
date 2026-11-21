import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function Card() {
  const [count, setCount] = useState(0);
  const [value, setValue] = useState("initial");
  useEffect(() => {
    document.documentElement.dataset.cardMounted = "yes";
    return () => {
      document.documentElement.dataset.cardMounted = "no";
    };
  }, []);
  return (
    <article className="card" data-testid="card">
      <h2>Live card</h2>
      <div className="row">
        <button data-testid="counter" onClick={() => setCount(count + 1)}>
          Count: {count}
        </button>
        <label>
          Message{" "}
          <input
            data-testid="input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
      </div>
      <p className="query" data-testid="query">
        Container query
      </p>
      <div className="relative" data-testid="relative">
        Relative width
      </div>
    </article>
  );
}
function Dashboard() {
  const [revision, setRevision] = useState(0);
  return (
    <div className="dashboard">
      <Card />
      <aside>
        Grid sibling{" "}
        <button
          data-testid="rerender"
          onClick={() => setRevision(revision + 1)}
        >
          Render: {revision}
        </button>
      </aside>
    </div>
  );
}
const rootElement = document.querySelector<HTMLElement>("#root")!;
const root = createRoot(rootElement);
root.render(<Dashboard />);
const destination = document.querySelector<HTMLElement>("#destination")!;
let original: HTMLElement | null = null;
let identity: HTMLElement | null = null;
let saved: { element: HTMLElement; style: string | null }[] = [];
let theme = false;
const properties = [
  "color",
  "background-color",
  "padding",
  "border",
  "font-size",
  "font-family",
  "display",
  "gap",
  "width",
];
function restore() {
  const card = identity;
  if (!card || !original) return;
  if (card.parentElement !== original) original.prepend(card);
  for (const entry of saved) {
    if (entry.style === null) entry.element.removeAttribute("style");
    else entry.element.setAttribute("style", entry.style);
  }
  saved = [];
  card.style.removeProperty("transform");
}
function getCard() {
  const card = document.querySelector<HTMLElement>("[data-testid=card]");
  if (!card) throw new Error("card is not mounted");
  if (!original) {
    original = card.parentElement;
    identity = card;
  }
  return card;
}
function move(snapshot: boolean) {
  restore();
  const card = getCard();
  if (snapshot) {
    const elements = [card, ...card.querySelectorAll<HTMLElement>("*")];
    saved = elements.map((element) => ({
      element,
      style: element.getAttribute("style"),
    }));
    const values = elements.map((element) =>
      properties.map((property) =>
        getComputedStyle(element).getPropertyValue(property),
      ),
    );
    elements.forEach((element, i) =>
      properties.forEach((property, j) =>
        element.style.setProperty(property, values[i]![j]!),
      ),
    );
  }
  destination.append(card);
}
document.querySelector("#direct")!.addEventListener("click", () => move(false));
document
  .querySelector("#snapshot")!
  .addEventListener("click", () => move(true));
document.querySelector("#original")!.addEventListener("click", restore);
document.querySelector("#transform")!.addEventListener("click", () => {
  restore();
  getCard().style.transform =
    "perspective(700px) translateX(120px) rotateY(12deg)";
});
document.querySelector("#theme")!.addEventListener("click", () => {
  theme = !theme;
  rootElement.classList.toggle("alternate", theme);
});
document
  .querySelector("#resize")!
  .addEventListener("click", () => rootElement.classList.toggle("narrow"));
document.querySelector("#unmount")!.addEventListener("click", () => {
  restore();
  root.unmount();
});

document
  .querySelector("#unsafe-unmount")!
  .addEventListener("click", () => root.unmount());
