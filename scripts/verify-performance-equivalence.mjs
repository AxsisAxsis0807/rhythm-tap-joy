/** Compare fixed-SHA and working-tree core/replay/verifier with identical ordered events.
 * npm install first; node scripts/verify-performance-equivalence.mjs
 * Writes all samples to work/performance/equivalence.json. No service/DB access.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const fixed = "dfc071d017edfc4b358450c546f36ea50875ce76";
const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", fixed, "src/game", "src/lib"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((p) => p.endsWith(".ts"));
async function load(which) {
  const root = resolve(`work/performance/equivalence-${which}`);
  for (const path of paths) {
    const content =
      which === "baseline"
        ? execFileSync("git", ["show", `${fixed}:${path}`])
        : await readFile(path);
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const result = await build({
    stdin: {
      contents:
        'export { GameplayCore } from "@/game/gameplayCore"; export { ReplayRecorder } from "@/game/replay"; export { createRunConfiguration } from "@/game/runConfiguration"; export { verifyReplay } from "@/lib/playVerifier";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    alias: { "@": resolve(root, "src") },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`
  );
}
const baseline = await load("baseline");
const current = await load("current");
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function sample(api, style, side, hz, delta, hold) {
  const notes = Array.from({ length: 20 }, (_, i) => ({
    beat: 2 + i * 3,
    lane: i % 4,
    kind: hold ? "hold" : "tap",
    ...(hold ? { lengthBeats: 0.5 } : {}),
  }));
  const chart = {
    id: "00000000-0000-4000-8000-000000000001",
    revisionId: "00000000-0000-4000-8000-000000000002",
    title: "equivalence",
    artist: "fixture",
    audioUrl: "",
    bpm: 60,
    offset: 0,
    laneCount: 4,
    difficultyName: "test",
    notes,
    ...(style === "fnf" ? { fnf: { playerSide: side, left: notes, right: notes } } : {}),
  };
  const config = api.createRunConfiguration(chart, { playStyle: style });
  const recorder = new api.ReplayRecorder("00000000-0000-4000-8000-000000000003", config);
  const core = new api.GameplayCore(chart, config);
  const ordered = Array.from({ length: hz * 62 + 1 }, (_, i) => ({
    type: "advance",
    songTime: i / hz,
  }));
  notes.forEach((n, i) => {
    ordered.push({ type: "press", lane: n.lane, source: i + 1, songTime: n.beat + delta });
    // Include cancelled holds, overlapping sources and ordered equal-time edges.
    if (hold && i % 3 === 0)
      ordered.push({
        type: "press",
        lane: n.lane,
        source: i + 101,
        songTime: n.beat + delta + 0.01,
      });
    ordered.push({
      type: hold && i % 2 ? "cancel" : "release",
      lane: n.lane,
      source: i + 1,
      songTime: n.beat + delta + (hold ? 0.6 : 0.01),
    });
    if (hold && i % 3 === 0)
      ordered.push({
        type: "release",
        lane: n.lane,
        source: i + 101,
        songTime: n.beat + delta + 0.65,
      });
  });
  ordered.sort((a, b) => a.songTime - b.songTime);
  ordered.push({ type: "complete", songTime: 62 });
  const outcomes = ordered.map((event) =>
    core.process(
      recorder.append({
        ...event,
        clockTime: event.songTime,
        elapsedMs: (event.songTime + 1.5) * 1000,
      }),
    ),
  );
  const replay = recorder.snapshot();
  const verified = api.verifyReplay(chart, 60000, replay, 64000);
  const output = {
    config,
    outcomes,
    notes: core.notes,
    play: core.play,
    heldIntervals: core.heldIntervals,
    replay,
    verified,
  };
  return {
    hash: digest(output),
    events: replay.events.length,
    bytes: new TextEncoder().encode(JSON.stringify(replay)).byteLength,
    score: core.play.score,
    counts: core.play.counts,
    eligible: verified.eligible,
  };
}
const rows = [];
for (const [style, side] of [
  ["mania", "shared"],
  ["fnf", "left"],
  ["fnf", "right"],
])
  for (const hz of [60, 144])
    for (const delta of [-0.2, -0.14, 0, 0.14, 0.2])
      for (const hold of [false, true]) {
        const a = sample(baseline, style, side, hz, delta, hold);
        const b = sample(current, style, side, hz, delta, hold);
        assert.deepEqual(b, a, JSON.stringify({ style, side, hz, delta, hold }));
        rows.push({ style, side, hz, delta, hold, baseline: a, current: b, equal: true });
      }
await writeFile(
  "work/performance/equivalence.json",
  JSON.stringify({ fixed, samples: rows }, null, 2) + "\n",
);
console.log(`${rows.length} identical core/replay/verifier samples`);
