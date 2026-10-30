/** Production browser measurements. See docs/pulse-lane-phase3.md for setup.
 * BASE_A=http://127.0.0.1:5181 BASE_B=http://127.0.0.1:5182
 * PLAYWRIGHT_PATH=/path/to/playwright node scripts/measure-performance.mjs
 * MODE=explore PERF_SECONDS=12 for initial attribution. Default: 5 alternating AB/BA pairs, 60s/run.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const out = process.env.PERF_OUT || "work/phase3/measurements";
const seconds = Number(process.env.PERF_SECONDS || 60);
const mode = process.env.MODE || "compare";
const variants =
  mode === "single"
    ? [["A", process.env.STYLE || "mania", process.env.OVERLAY !== "off", false]]
    : mode === "effects"
      ? [
          ["A", "mania", false, false, true],
          ["A", "mania", false, false, false],
        ]
      : mode === "explore"
        ? [
            ["A", "mania", true, false],
            ["A", "mania", false, false],
            ["A", "mania", false, true],
            ["A", "fnf", false, false],
          ]
        : Array.from({ length: Number(process.env.PAIRS || 5) }, (_, i) =>
            (i % 2 ? ["B", "A"] : ["A", "B"]).map((label) => [
              label,
              process.env.STYLE || "mania",
              process.env.OVERLAY !== "off",
              false,
            ]),
          ).flat();
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const results = [];
try {
  for (let index = 0; index < variants.length; index++) {
    const [label, style, overlay, light, background = true] = variants[index];
    const base = process.env[`BASE_${label}`] || "http://127.0.0.1:5181";
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base) return route.continue();
      if (url.pathname.includes("/rest/v1/")) return route.fulfill({ json: [] });
      return route.abort();
    });
    await page.addInitScript(
      ({ overlay, light, background }) => {
        if (window !== window.top) return;
        localStorage.setItem(
          "pulse-lane:game-settings",
          JSON.stringify({
            version: 5,
            autoPreview: false,
            inputOverlayEnabled: overlay,
            backgroundEffects: background,
            lightweightMode: light,
            reducedMotion: light,
            renderingPreset: "custom",
            showFps: false,
          }),
        );
        window.__measure = { frames: [], tasks: [], pulses: 0 };
        const start = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, ...rest) {
          window.__epoch = { ctx: this.context, when, offset };
          return start.call(this, when, offset, ...rest);
        };
      },
      { overlay, light, background },
    );
    await page.goto(base);
    await page.getByRole("button", { name: "曲を探して遊ぶ", exact: true }).click();
    await page.getByText("Performance fixture", { exact: true }).first().waitFor();
    if (style === "fnf") await page.getByRole("radio", { name: "FNF", exact: true }).click();
    await page.getByRole("button", { name: "START", exact: true }).click();
    await page.getByTestId("gameplay-area").waitFor();
    await page.waitForFunction(
      () => window.__epoch && window.__epoch.ctx.currentTime - window.__epoch.when >= 4,
    );
    const client = await context.newCDPSession(page);
    await client.send("Performance.enable");
    const traceEnabled = process.env.PERF_TRACE === "on";
    if (traceEnabled)
      await client.send("Tracing.start", {
        categories: "devtools.timeline,v8.execute,blink.user_timing",
        transferMode: "ReturnAsStream",
      });
    await client.send("Profiler.enable");
    await client.send("Profiler.setSamplingInterval", { interval: 1000 });
    await client.send("Profiler.start");
    await page.waitForFunction(() => window.__epoch.ctx.currentTime - window.__epoch.when >= 5.5);
    const before = await client.send("Performance.getMetrics");
    const data = await page.evaluate(
      async ({ seconds, style }) => {
        const m = window.__measure;
        const epoch = window.__epoch;
        const songTime = () => epoch.ctx.currentTime - epoch.when + epoch.offset;
        const begin = 5.5;
        const observedBegin = songTime();
        const end = begin + seconds;
        let previous = performance.now();
        let pulse = -1;
        const keys =
          style === "fnf" ? ["KeyA", "KeyS", "KeyW", "KeyD"] : ["KeyD", "KeyF", "KeyJ", "KeyK"];
        const observer = new PerformanceObserver((list) =>
          m.tasks.push(
            ...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })),
          ),
        );
        observer.observe({ type: "longtask", buffered: false });
        await new Promise((resolve) => {
          const tick = (now) => {
            m.frames.push(now - previous);
            previous = now;
            const time = songTime();
            const next = Math.floor(time * 8);
            if (next !== pulse) {
              pulse = next;
              const code = keys[Math.floor(time * 24) % 4];
              window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
              window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
              m.pulses++;
            }
            if (time >= end) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        observer.disconnect();
        return {
          ...m,
          begin,
          observedBegin,
          end: songTime(),
          noteCount: document.querySelectorAll('[data-testid^="player-note-"]').length,
          overlayPresent: !!document.querySelector('[data-testid="input-overlay-layer"]'),
          text: document.querySelector("header")?.textContent,
        };
      },
      { seconds, style },
    );
    const after = await client.send("Performance.getMetrics");
    const { profile } = await client.send("Profiler.stop");
    let traceName;
    if (traceEnabled) {
      const complete = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
      await client.send("Tracing.end");
      const { stream } = await complete;
      const chunks = [];
      while (true) {
        const chunk = await client.send("IO.read", { handle: stream });
        chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"));
        if (chunk.eof) break;
      }
      await client.send("IO.close", { handle: stream });
      traceName = `run-${index + 1}-${label}-${style}.trace.json.gz`;
      await writeFile(`${out}/${traceName}`, gzipSync(Buffer.concat(chunks)));
    }
    const profileName = `run-${index + 1}-${label}-${style}-overlay${overlay ? "on" : "off"}-light${light ? "on" : "off"}.cpuprofile.gz`;
    profile.windowStartTime = before.metrics.find((x) => x.name === "Timestamp").value * 1e6;
    profile.windowEndTime = after.metrics.find((x) => x.name === "Timestamp").value * 1e6;
    const bytes = gzipSync(JSON.stringify(profile));
    await writeFile(`${out}/${profileName}`, bytes);
    const a = Object.fromEntries(after.metrics.map((x) => [x.name, x.value]));
    const b = Object.fromEntries(before.metrics.map((x) => [x.name, x.value]));
    const metrics = Object.fromEntries(
      [
        "TaskDuration",
        "ScriptDuration",
        "LayoutDuration",
        "RecalcStyleDuration",
        "LayoutCount",
        "RecalcStyleCount",
      ].map((key) => [key, a[key] - b[key]]),
    );
    const sorted = [...data.frames].sort((a, b) => a - b);
    const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const row = {
      index: index + 1,
      label,
      base,
      background,
      style,
      overlay,
      light,
      seconds,
      chromium: browser.version(),
      headless: true,
      viewport: { width: 1280, height: 720 },
      metrics,
      frame: {
        count: sorted.length,
        p50: percentile(0.5),
        p95: percentile(0.95),
        p99: percentile(0.99),
        over25ms: sorted.filter((x) => x > 25).length,
      },
      longTasks: data.tasks.length,
      errors,
      traceName,
      profileName,
      profileSha256: createHash("sha256").update(bytes).digest("hex"),
      data,
    };
    results.push(row);
    await writeFile(`${out}/results.json`, JSON.stringify({ mode, results }, null, 2) + "\n");
    console.log(
      JSON.stringify({
        run: row.index,
        label,
        style,
        overlay,
        light,
        metrics,
        frame: row.frame,
        errors,
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
