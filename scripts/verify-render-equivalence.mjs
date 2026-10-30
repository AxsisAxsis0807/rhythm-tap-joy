/** Compare Phase-2 and working-tree markup at identical songTime/settings.
 * Only hook/persistence/UI plumbing is stubbed; GameScreen/FnfField/NoteSprite and
 * window extraction/position expressions are the real renderers, with React SSR.
 * Browser geometry is checked separately; SSR equality alone is not a paint test.
 */
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build } from "esbuild";
const fixed = "47049059b1ff5cf88924db6c1062ca57d53dd17a";
const out = "work/phase3/render-equivalence";
const currentRef = process.env.RENDER_CURRENT_REF;
await mkdir(out, { recursive: true });
const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", fixed, "src"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((p) => /\.tsx?$/.test(p));
async function renderer(label) {
  const root = resolve(`${out}/${label}`);
  const renderPaths =
    label === "baseline"
      ? paths
      : execFileSync(
          "git",
          currentRef
            ? ["ls-tree", "-r", "--name-only", currentRef, "src"]
            : ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
          { encoding: "utf8" },
        )
          .trim()
          .split("\n")
          .filter((p) => /\.tsx?$/.test(p));
  for (const path of renderPaths) {
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      label === "baseline"
        ? execFileSync("git", ["show", `${fixed}:${path}`])
        : currentRef
          ? execFileSync("git", ["show", `${currentRef}:${path}`])
          : await readFile(path),
    );
  }
  const result = await build({
    stdin: {
      contents:
        'import React from "react"; import { renderToStaticMarkup } from "react-dom/server"; import { GameScreen } from "@/components/game/GameScreen"; export {DEFAULT_SETTINGS} from "@/game/settings"; export function render(fixture){globalThis.__renderFixture=fixture;return renderToStaticMarkup(React.createElement(GameScreen,fixture.props));}',
      resolveDir: process.cwd(),
    },
    packages: "external",
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve(root, "src") },
    plugins: [
      {
        name: "render-fixture-boundaries",
        setup(api) {
          api.onLoad({ filter: /useRhythmGame\.ts$/ }, () => ({
            contents: "export function useRhythmGame(){return globalThis.__renderFixture.game;}",
          }));
          api.onResolve(
            { filter: /usePlaySession$|usePlayResult$|playResultQueue$|AccountGrowth$/ },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          api.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export function usePlaySession(){return {storageWarning:false}}; export function usePlayResult(){return {state:null}}; export function enqueuePlayResult(){};export function flushPlayResultQueue(){};export function ResultXpCard(){return null}",
          }));
          api.onLoad({ filter: /SettingsPanel\.tsx$/ }, () => ({
            contents: "export function SettingsPanel(){return null}",
          }));
          api.onLoad({ filter: /settings\.ts$/ }, async (args) => {
            const source = await readFile(args.path, "utf8");
            const start = source.indexOf("export function useGameSettings()");
            return {
              contents:
                source.slice(0, start) +
                "export function useGameSettings(){return {settings:globalThis.__renderFixture.settings,setSettings:()=>{},saveError:false};}",
              loader: "ts",
            };
          });
        },
      },
    ],
  });
  const modulePath = resolve(`${out}/${label}.mjs`);
  await writeFile(modulePath, result.outputFiles[0].contents);
  return import(modulePath);
}
const a = await renderer("baseline");
const b = await renderer("current");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const samples = [];
const browserSnapshots = [];
const notes = Array.from({ length: 2400 }, (_, id) => ({
  id,
  lane: id % 4,
  time: id / 24,
  beat: id / 12,
  kind: "tap",
  judged: false,
}));
const chartNotes = notes.map((n) => ({ beat: n.beat, lane: n.lane, kind: "tap" }));
const ledger = {
  subscribe: () => () => {},
  snapshot: () => 0,
  bars: [],
  sources: new Map(),
  activeLanes: new Set(),
  prune: () => {},
};
const chart = {
  id: "render",
  audioUrl: "/local",
  title: "render",
  artist: "fixture",
  bpm: 120,
  offset: 0,
  laneCount: 4,
  difficultyName: "test",
  notes: chartNotes,
};
const play = {
  score: 100,
  combo: 2,
  maxCombo: 2,
  counts: { PERFECT: 1, GREAT: 0, GOOD: 0, MISS: 0 },
  timingErrorsMs: [3],
};
for (const style of ["mania", "classic", "fnf-left", "fnf-right"])
  for (const direction of ["down", "up"])
    for (const time of [0, 0.25, 5, 5.041666666666667, 20.1, 99, 5])
      for (const speed of [0.5, 1, 4]) {
        const fnf = style.startsWith("fnf");
        const props = {
          chart: fnf
            ? {
                ...chart,
                fnf: {
                  playerSide: style.endsWith("left") ? "left" : "right",
                  left: chartNotes,
                  right: chartNotes,
                },
              }
            : chart,
          modeId: fnf ? "fnf" : style,
          playStyle: fnf ? "fnf" : "mania",
        };
        const settings = {
          ...a.DEFAULT_SETTINGS,
          scrollDirection: direction,
          inputOverlayEnabled: false,
          scrollSpeed: speed,
          visualOffsetMs: 17,
          noteScale: 115,
          judgeLinePct: direction === "down" ? 86 : 14,
        };
        const game = {
          status: "playing",
          songTime: time,
          duration: 120,
          scrollTime: 1.3 / speed,
          notes,
          play,
          activeLanes: ledger.activeLanes,
          inputs: ledger,
        };
        // Same array, play object and Set: mutations must be observed without replacing refs.
        notes.forEach((n) => {
          n.judged = n.id % 5 === Math.floor(time) % 5;
        });
        ledger.activeLanes.clear();
        ledger.activeLanes.add(Math.floor(time) % 4);
        const fixture = { props, settings, game };
        const before = a.render(fixture);
        const after = b.render(fixture);
        assert.equal(after, before, JSON.stringify({ style, direction, time, speed }));
        if (time === 5 || time === 5.041666666666667)
          browserSnapshots.push({ style, direction, time, speed, before, after });
        samples.push({ style, direction, time, speed, markupSha256: hash(after), equal: true });
      }
await writeFile(
  `${out}/results.json`,
  JSON.stringify({ fixed, currentRef: currentRef || "working-tree", samples }, null, 2) + "\n",
);
await writeFile(`${out}/browser-snapshots.json`, JSON.stringify(browserSnapshots));
console.log(
  `${samples.length} identical renderer snapshots (IDs, order, position/scale expressions, sprites, receptor state)`,
);
