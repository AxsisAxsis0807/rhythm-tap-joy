import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { resolve, basename } from "node:path";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
const profilePath = process.argv[2];
const assets = process.argv[3] || "work/phase3/A/.output/public/assets";
const profile = JSON.parse(gunzipSync(await readFile(profilePath)));
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const maps = new Map();
const files = new Map();
const functions = new Map();
let sampleTime = profile.startTime;
for (let i = 0; i < profile.samples.length; i++) {
  sampleTime += profile.timeDeltas[i];
  if (
    profile.windowStartTime &&
    (sampleTime < profile.windowStartTime || sampleTime > profile.windowEndTime)
  )
    continue;
  const node = nodes.get(profile.samples[i]);
  const frame = node.callFrame;
  let source = frame.url || frame.functionName;
  let name = frame.functionName;
  if (frame.url.startsWith("http")) {
    const file = basename(new URL(frame.url).pathname);
    if (!maps.has(file)) {
      try {
        maps.set(
          file,
          new TraceMap(JSON.parse(await readFile(resolve(assets, `${file}.map`), "utf8"))),
        );
      } catch {
        maps.set(file, null);
      }
    }
    const map = maps.get(file);
    if (map) {
      const original = originalPositionFor(map, {
        line: frame.lineNumber + 1,
        column: frame.columnNumber,
      });
      source = original.source || source;
      name = original.name || name;
    }
  }
  const ms = profile.timeDeltas[i] / 1000;
  files.set(source, (files.get(source) || 0) + ms);
  const key = `${source} :: ${name}`;
  functions.set(key, (functions.get(key) || 0) + ms);
}
const sort = (map) =>
  [...map].map(([name, selfMs]) => ({ name, selfMs })).sort((a, b) => b.selfMs - a.selfMs);
const result = {
  profilePath,
  durationMs: (profile.endTime - profile.startTime) / 1000,
  samples: profile.samples.length,
  sources: sort(files),
  functions: sort(functions),
};
await writeFile(`${profilePath}.summary.json`, JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify(
    { ...result, sources: result.sources.slice(0, 18), functions: result.functions.slice(0, 25) },
    null,
    2,
  ),
);
