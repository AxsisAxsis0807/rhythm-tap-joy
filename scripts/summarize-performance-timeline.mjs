import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const path = process.argv[2];
const trace = JSON.parse(gunzipSync(await readFile(path)));
const main = new Set(
  trace.traceEvents
    .filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain")
    .map((e) => `${e.pid}:${e.tid}`),
);
const types = new Map();
for (const event of trace.traceEvents) {
  if (event.ph !== "X" || !main.has(`${event.pid}:${event.tid}`)) continue;
  const row = types.get(event.name) || { name: event.name, count: 0, totalMs: 0 };
  row.count++;
  row.totalMs += (event.dur || 0) / 1000;
  types.set(event.name, row);
}
const result = {
  source: path,
  note: "Diagnostic only; includes profiler setup/warmup. Nested event durations overlap and must not be added.",
  mainThreads: [...main],
  eventTypes: [...types.values()].sort((a, b) => b.totalMs - a.totalMs),
};
await writeFile(`${path}.summary.json`, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
