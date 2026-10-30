/** Paint the oracle snapshots with the actual production stylesheet in Chromium.
 * Run verify-render-equivalence.mjs first. No game clock or gameplay is simulated here.
 */
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = "work/phase3/render-equivalence";
const snapshots = JSON.parse(await readFile(`${root}/browser-snapshots.json`, "utf8"));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const rows = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const base = process.env.BASE_A || "http://127.0.0.1:5181";
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
  );
  await page.goto(base);
  const css = await page.evaluate(() =>
    [...document.styleSheets].map((s) => s.href).filter(Boolean),
  );
  assert(css.length > 0);
  await page.goto("about:blank");
  async function geometry(html) {
    await page.setContent(
      `<html><head>${css.map((url) => `<link rel="stylesheet" href="${url}">`).join("")}</head><body>${html}</body></html>`,
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    return page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[data-testid^="player-note-"], [data-testid^="receptor-"], [data-testid^="opponent-receptor-"]',
        ),
      ].map((node) => {
        const r = node.getBoundingClientRect();
        return {
          id: node.getAttribute("data-testid"),
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          top: node.style.top,
          transform: getComputedStyle(node).transform,
        };
      }),
    );
  }
  for (const { before, after, ...condition } of snapshots) {
    const a = await geometry(before);
    const b = await geometry(after);
    assert.deepEqual(b, a, JSON.stringify(condition));
    assert(a.length > 0);
    rows.push({ ...condition, equal: true, points: a });
  }
  // Compare finite-difference travel for every note present at both fixed songTimes.
  const velocity = [];
  for (const row of rows.filter((r) => r.time === 5)) {
    const next = rows.find(
      (r) =>
        r.style === row.style &&
        r.direction === row.direction &&
        r.speed === row.speed &&
        r.time !== 5,
    );
    const points = row.points
      .filter((p) => p.id.startsWith("player-note-"))
      .flatMap((p) => {
        const n = next.points.find((n) => n.id === p.id);
        return n ? [{ id: p.id, pixelsPerSongSecond: (n.y - p.y) / (next.time - row.time) }] : [];
      });
    assert(points.length > 0);
    velocity.push({ style: row.style, direction: row.direction, speed: row.speed, points });
  }
  await writeFile(
    `${root}/geometry.json`,
    JSON.stringify(
      {
        viewport: { width: 1280, height: 720 },
        css,
        chromium: browser.version(),
        snapshots: rows,
        velocity,
        allEqual: true,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `${rows.length} equal browser geometry snapshots; ${velocity.length} equal finite-difference velocity cases`,
  );
} finally {
  await browser.close();
}
