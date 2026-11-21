// P1-08A2: mismatch table from docs/evidence/p1-08a2/results-<browser>.json.
// Usage (apps/xr-lab): node scripts/summarize-p1-08a2-results.mjs
import { readFileSync } from "node:fs";

const dir = "../../docs/evidence/p1-08a2";
const rows = [];
const add = (browser, name, r) =>
  r &&
  rows.push(
    `| ${browser} | ${name} | \`${r.query}\` | ${r.probes} | ${r.depthVsVisual} | ${r.visualVsClick} | ${r.clickMismatch} | ${r.efpVsDown} |`,
  );
for (const browser of ["chromium", "firefox"]) {
  const j = JSON.parse(readFileSync(`${dir}/results-${browser}.json`, "utf8"));
  for (const rec of j.records) {
    if (rec.order && rec.split) {
      add(browser, rec.test + " (order)", rec.order);
      add(browser, rec.test + " (split)", rec.split);
    } else if (rec.order && rec.clip) {
      add(browser, rec.test + " (order)", rec.order);
      add(browser, rec.test + " (clip)", rec.clip);
    } else if (rec.elementSpace) {
      add(browser, rec.test + " (element-space rect)", rec.elementSpace);
      add(browser, rec.test + " (canvas-space rect)", rec.canvasSpace);
    } else if (typeof rec.probes === "number") add(browser, rec.test, rec);
  }
}
console.log(
  "| browser | test | query | safe probes | depth≠visual | visual≠click | click | efp≠down |",
);
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(r);
