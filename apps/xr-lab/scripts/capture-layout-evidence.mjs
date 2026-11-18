import { chromium, firefox } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/* global window, document, innerHeight, getComputedStyle */

// Start a test-hooks build on port 4180 first; see docs/iframe-layout-fix.md.
const stage = process.argv[2];
if (!["before", "after"].includes(stage))
  throw new Error("Expected before or after");
const output = new URL(
  "../../../docs/evidence/iframe-layout/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const records = [];
for (const [browserName, launcher] of Object.entries({ chromium, firefox })) {
  const browser = await launcher.launch();
  try {
    for (const engine of ["three", "babylon"]) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
      });
      await page.goto(
        `http://127.0.0.1:4180/?bridge=iframe&engine=${engine}&integration=spatialflex&xr-emulator=off`,
      );
      await page.getByTestId("bridge-status").waitFor();
      await page
        .getByTestId("xr-item-shared-counter")
        .getByRole("button", { name: "Show in XR", exact: true })
        .click();
      const frame = page.frames().find((f) => f.url().includes("/host.html"));
      await frame.waitForFunction(
        () => window.__xrHostProbe?.drawn["shared-counter"],
      );
      const parent = await page.evaluate(() => {
        const box = (selector) => {
          const element = document.querySelector(selector);
          const { x, y, width, height } = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            x,
            y,
            width,
            height,
            display: style.display,
            flex: style.flex,
          };
        };
        return {
          workspace: box(".lab-right"),
          bridge: box(".bridge-host"),
          iframe: box(".bridge-frame"),
          viewport: innerHeight,
          scrollHeight: document.documentElement.scrollHeight,
        };
      });
      const child = await frame.evaluate(() => {
        const box = (selector) => {
          const element = document.querySelector(selector);
          const { x, y, width, height } = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            x,
            y,
            width,
            height,
            display: style.display,
            flex: style.flex,
          };
        };
        return {
          root: box("#root"),
          host: box(".xr-host"),
          canvas: box("canvas"),
          restore: box("#root > button"),
          viewport: innerHeight,
          scrollHeight: document.documentElement.scrollHeight,
        };
      });
      records.push({ browser: browserName, engine, parent, child });
      await page.screenshot({
        path: fileURLToPath(
          new URL(`${stage}-${browserName}-${engine}.png`, output),
        ),
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
await writeFile(
  new URL(`${stage}.json`, output),
  `${JSON.stringify({ stage, records }, null, 2)}\n`,
);
console.log(`Captured ${stage}: ${records.length} browser/engine observations`);
