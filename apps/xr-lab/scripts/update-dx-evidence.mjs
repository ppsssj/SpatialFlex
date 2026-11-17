import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

// Run after the full local E2E suite. Keep the captured P1-03 baseline; update
// only P1-04's observations with the same unchanged evaluation workload.
const evidenceUrl = new URL(
  "../../../docs/evidence/p1-04-dx.json",
  import.meta.url,
);
const evidence = JSON.parse(readFileSync(evidenceUrl, "utf8"));
const results = new URL("../test-results/", import.meta.url);
const records = readdirSync(results, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith("evaluation-"))
  .map((entry) => {
    const result = JSON.parse(
      readFileSync(
        new URL(`${encodeURIComponent(entry.name)}/metrics.json`, results),
        "utf8",
      ),
    );
    return Object.fromEntries(
      ["browser", "engine", "mode", "scriptBytes", "scriptsLoaded"].map(
        (key) => [key, result[key]],
      ),
    );
  })
  .sort((a, b) =>
    `${a.browser}/${a.engine}/${a.mode}`.localeCompare(
      `${b.browser}/${b.engine}/${b.mode}`,
    ),
  );
if (records.length !== 8)
  throw new Error("Expected all eight existing evaluation artifacts");
const adapter = readFileSync(
  new URL("../src/integrations/spatialflex/index.tsx", import.meta.url),
);
const hash = createHash("sha256").update(adapter).digest("hex").toUpperCase();
if (hash !== evidence.adapter_sha256_before_fourth_widget)
  throw new Error(
    "Adapter changed after fourth-widget declaration; review the extensibility claim",
  );
evidence.after = {
  source:
    "P1-04 final local E2E; test-hooks production build; optional fourth widget initially unmounted, matching the P1-03 three-widget workload",
  records,
};
evidence.adapter_sha256_after_fourth_widget = hash;
const scenario = readFileSync(
  new URL("../src/integrations/common/scenario.ts", import.meta.url),
  "utf8",
);
const manualBlock = scenario.slice(
  scenario.indexOf("  [WIDGETS.thermostat]:"),
  scenario.indexOf("  [WIDGETS.counter]:"),
);
const baseline = readFileSync(
  new URL("../src/integrations/baseline/index.ts", import.meta.url),
  "utf8",
);
const guard = baseline.match(
  / {6}if \(\r?\n {8}panelId === WIDGETS\.thermostat[\s\S]*? {8}return;/,
)?.[0];
if (!guard)
  throw new Error(
    "Manual thermostat guard changed; update the line-count method",
  );
const nonblank = (source) =>
  source.split(/\r?\n/).filter((line) => line.trim()).length;
const otherWidgetLines = baseline
  .replace(guard, "")
  .split(/\r?\n/)
  .filter(
    (line) =>
      line.includes("WIDGETS.thermostat") ||
      line.trim().startsWith("[state.imageMounted, state.thermostatMounted]"),
  ).length;
evidence.widgetIncrement = {
  definition:
    "Extra integration work beyond the shared application component/store/mount UI; physical nonblank source lines, not a total-code quality score",
  spatialflex: {
    adapterFilesChanged: 0,
    adapterLinesChanged: 0,
    newMappings: 0,
    newActionDispatchEntries: 0,
    newCleanupBranches: 0,
  },
  baseline: {
    integrationFilesChanged: 2,
    manualItemIdentityLinesInSharedFixture: 1,
    manualViewEntryNonblankLines: manualBlock
      .split(/\r?\n/)
      .filter((line) => line.trim()).length,
    thermostatIdentifierLinesInAdapter: baseline
      .split(/\r?\n/)
      .filter((line) => line.includes("WIDGETS.thermostat")).length,
    thermostatSpecificAdapterNonblankLines: nonblank(guard) + otherWidgetLines,
    adapterLineDefinition:
      "Full thermostat stale-handler guard + eligibility list/filter + mount dependency + epoch entry; counts modified shared dependency line once",
    newMappings: 1,
    newActionDispatchEntries: 1,
    lifecycle:
      "Explicit eligibility/dependency, epoch identity and stale-handler guard; fixture maintains thermostatMounted/thermostatEpoch manually",
  },
};
writeFileSync(evidenceUrl, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
  JSON.stringify(
    { widgetIncrement: evidence.widgetIncrement, records },
    null,
    2,
  ),
);
