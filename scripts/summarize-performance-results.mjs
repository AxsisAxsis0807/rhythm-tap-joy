import { readFile, writeFile } from "node:fs/promises";
const path = process.argv[2] || "work/phase3/final-60s/results.json";
const data = JSON.parse(await readFile(path, "utf8"));
const rows = data.results;
const average = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const metrics = ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration"];
const groups = Object.fromEntries(
  ["A", "B"].map((label) => {
    const samples = rows.filter((r) => r.label === label);
    return [
      label,
      {
        count: samples.length,
        metrics: Object.fromEntries(
          metrics.map((key) => [key, average(samples.map((r) => r.metrics[key]))]),
        ),
        frameP95: average(samples.map((r) => r.frame.p95)),
        over25ms: average(samples.map((r) => r.frame.over25ms)),
      },
    ];
  }),
);
const pairs = [];
for (let i = 0; i < rows.length; i += 2) {
  const pair = rows.slice(i, i + 2);
  if (pair.length !== 2) continue;
  const a = pair.find((r) => r.label === "A");
  const b = pair.find((r) => r.label === "B");
  pairs.push({
    pair: i / 2 + 1,
    order: pair.map((r) => r.label).join(""),
    A: a.index,
    B: b.index,
    deltaPercent: Object.fromEntries(
      metrics.map((key) => [key, (b.metrics[key] / a.metrics[key] - 1) * 100]),
    ),
    frameP95DeltaMs: b.frame.p95 - a.frame.p95,
    over25msDelta: b.frame.over25ms - a.frame.over25ms,
  });
}
const summary = {
  source: path,
  groups,
  deltaOfMeansPercent: Object.fromEntries(
    metrics.map((key) => [key, (groups.B.metrics[key] / groups.A.metrics[key] - 1) * 100]),
  ),
  pairs,
  runs: rows.map(({ data, ...row }) => ({
    ...row,
    requestedBegin: data.begin,
    observedBegin: data.observedBegin ?? data.begin,
    observedEnd: data.end,
    pulses: data.pulses,
    noteCount: data.noteCount,
    overlayPresent: data.overlayPresent,
  })),
};
await writeFile(
  path.replace(/results\.json$/, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
