// P1-08A2: median-of-repeats table from docs/evidence/p1-08a2/perf-*.json.
// Usage (apps/xr-lab): node scripts/summarize-p1-08a2-perf.mjs [file ...]
import { readFileSync, readdirSync } from "node:fs";

const dir = "../../docs/evidence/p1-08a2";
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir)
      .filter((f) => /^perf-.*\.json$/.test(f))
      .map((f) => `${dir}/${f}`);
const med = (xs) => {
  const s = xs
    .filter((x) => typeof x === "number" && Number.isFinite(x))
    .sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
for (const file of files) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  console.log(
    `\n### ${j.browser} ${j.browserVersion} (${j.mode}); WebGL: ${j.webglRenderer}; ${j.repeats}× ${j.windowMs} ms\n`,
  );
  console.log(
    "| track | scene | frame median / P95 / P99 (ms) | compose P95 (ms) | uploads/s | upload Mpx/s | clip writes/s | clip vertices | texture MB | style recalc (count / ms) | layout (count / ms) | press→frame median (ms) | presses delivered |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of j.results) {
    if (r.status) {
      console.log(`| ${r.track} | — | ${r.status} |||||||||||`);
      continue;
    }
    const m = (g) => med(r.runs.map(g));
    console.log(
      `| ${r.track} | ${r.scene} | ${f(m((x) => x.frameInterval.median))} / ${f(m((x) => x.frameInterval.p95))} / ${f(m((x) => x.frameInterval.p99))} | ${f(
        m((x) => x.composeMs.p95),
        2,
      )} | ${f(m((x) => x.uploadsPerSec))} | ${f(
        m((x) => x.uploadedMpxPerSec),
        2,
      )} | ${f(m((x) => x.clipWritesPerSec))} | ${f(
        m((x) => x.clipVertices),
        0,
      )} | ${f(m((x) => x.textureBytes) / 1e6, 2)} | ${
        r.runs[0].cdp
          ? `${f(
              m((x) => x.cdp.recalcStyleCount),
              0,
            )} / ${f(
              m((x) => x.cdp.recalcStyleMs),
              1,
            )}`
          : "n/a"
      } | ${
        r.runs[0].cdp
          ? `${f(
              m((x) => x.cdp.layoutCount),
              0,
            )} / ${f(
              m((x) => x.cdp.layoutMs),
              1,
            )}`
          : "n/a"
      } | ${f(m((x) => x.pressToNextFrameMs.median))} | ${f(
        m((x) => x.pressesDelivered),
        0,
      )}/${r.runs[0].pressesSent} |`,
    );
  }
}
