/* Local browser verification. Requires Playwright and Chromium; never contacts AdMax.
 * Start the app with npm run dev -- --host 127.0.0.1 --port 5180 first.
 * Run: node scripts/verify-admax.cjs
 */
const http = require("node:http");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const base = process.env.ADMAX_TEST_BASE || "http://127.0.0.1:5180";
const tag = "https://adm.shinobi.jp/st/t.js";
const counts = new Map();
const rows = [];
const mockServer = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const key = url.searchParams.get("case");
  counts.set(key, (counts.get(key) || 0) + 1);
  if (url.searchParams.get("mode") === "blocked") return req.socket.destroy();
  if (url.searchParams.get("mode") === "error") {
    res.writeHead(503, { "Content-Type": "text/javascript" });
    return res.end();
  }
  const send = () => {
    if (res.destroyed) return;
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    res.end(`
      window.__adRequests = 0;
      window.admaxads = { push(request) {
        if (request.type !== 'banner' || request.admax_id !== 'cb996f4b2cbc2c0b8adc2c12ad721c8f') throw Error('wrong tag');
        const slot = document.querySelector('.admax-ads[data-admax-id="'+request.admax_id+'"]');
        if (!slot) throw Error('missing DOM');
        window.__adRequests++;
        const frame = document.createElement('iframe');
        frame.width = '320'; frame.height = '50'; frame.style.border = '0';
        frame.srcdoc = '<div style="margin:0;width:320px;height:50px;background:#175d73;color:white">LOCAL TEST</div>';
        frame.dataset.mockAd = 'true'; slot.appendChild(frame);
      }};`);
  };
  if (url.searchParams.get("mode") === "delayed") setTimeout(send, 1200);
  else send();
});

async function configure(context, key, mode, guest = false) {
  const page = await context.newPage();
  await page.route("**/src/lib/useAuth.ts*", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: guest
        ? "export function useAuth(){return {user:null,loading:false,session:null}}"
        : 'const user={id:"00000000-0000-4000-8000-000000000001",email:"tester@example.invalid",user_metadata:{}}; export function useAuth(){return {user,loading:false,session:null}}',
    }),
  );
  await page.route("**/src/lib/admax.ts*", async (r) => {
    const response = await r.fetch();
    const text = await response.text();
    assert.ok(
      text.includes(tag),
      "the exact production tag must be replaced before any ad can load",
    );
    await r.fulfill({
      response,
      body: text.replaceAll(tag, `http://127.0.0.1:5191/ad.js?case=${key}&mode=${mode}`),
    });
  });
  await page.route("**/rest/v1/**", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: r.request().url().includes("/profiles?")
        ? JSON.stringify({
            id: "00000000-0000-4000-8000-000000000001",
            username: "tester",
            display_name: "Tester",
            bio: "",
            avatar_url: null,
          })
        : "[]",
    }),
  );
  // Defense in depth; the tag replacement above prevents live iframe requests.
  await context.route("https://adm.shinobi.jp/**", (r) => r.abort());
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "公開された曲" }).waitFor();
  return page;
}

async function measure(page, key, mode, viewport, screen, fits) {
  if (fits) await page.locator("[data-admax-host]").waitFor();
  // Account widgets load asynchronously; measure after scrolling the final document.
  await page.waitForTimeout(400);
  await page.evaluate(() =>
    scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  );
  await page.waitForTimeout(100);
  await page.evaluate(() =>
    scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  );
  const frame = page.locator("[data-admax-host]");
  assert.equal(await frame.count(), fits ? 1 : 0);
  const dimensions = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  assert.ok(dimensions.scroll <= dimensions.client, JSON.stringify(dimensions));
  let ad = null,
    nav = null;
  if (fits) {
    ad = await frame.boundingBox();
    nav = await page.locator("nav").last().boundingBox();
    assert.equal(ad.width, 320);
    assert.equal(ad.height, 50);
    assert.ok(ad.x >= 0 && ad.x + ad.width <= viewport.width);
    assert.ok(ad.y + ad.height <= nav.y, JSON.stringify({ ad, nav }));
    if (mode === "success") {
      await page.waitForFunction(() => window.__adRequests === 1);
      assert.equal(await page.locator("[data-mock-ad]").count(), 1);
    }
  }
  rows.push({
    key,
    mode,
    viewport,
    screen,
    ...dimensions,
    ad,
    nav,
    scriptRequests: counts.get(key) || 0,
  });
}

(async () => {
  await new Promise((r) => mockServer.listen(5191, "127.0.0.1", r));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const viewport of [
      { width: 319, height: 740 },
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 1280, height: 900 },
    ]) {
      for (const mode of ["success", "blocked", "error"]) {
        const key = `${viewport.width}-${mode}`;
        console.log(`Checking ${key}`);
        const context = await browser.newContext({ viewport });
        try {
          const page = await configure(context, key, mode),
            fits = viewport.width >= 320;
          await measure(page, key, mode, viewport, "home", fits);
          const first = fits ? await page.locator(".admax-ads").elementHandle() : null;
          if (mode === "success") assert.equal(counts.get(key) || 0, fits ? 1 : 0);
          await page.getByRole("button", { name: "プロフィール", exact: true }).click();
          await page.getByRole("button", { name: "プロフィールを保存", exact: true }).waitFor();
          await measure(page, key, mode, viewport, "profile", fits);
          if (first)
            assert.equal(
              await first.evaluate((e) => e === document.querySelector(".admax-ads")),
              true,
            );
          if (mode === "success" && fits) {
            assert.equal(counts.get(key), 1);
            await page.getByLabel("表示名", { exact: true }).fill("Layout test");
            await page.setViewportSize({ width: viewport.width + 10, height: viewport.height });
            await page.waitForTimeout(150);
            assert.equal(await page.evaluate(() => window.__adRequests), 1);
          }
          await page.getByRole("button", { name: "ホーム", exact: true }).click();
          if (mode === "success" && fits) {
            assert.equal(
              await first.evaluate((e) => e === document.querySelector(".admax-ads")),
              true,
            );
            assert.equal(await page.evaluate(() => window.__adRequests), 1);
          }
          await page.getByRole("button", { name: "曲を探して遊ぶ", exact: true }).click();
          await page.getByRole("heading", { name: "曲を探して遊ぶ", exact: true }).waitFor();
          assert.equal(await page.locator(".admax-ads, [data-admax-host]").count(), 0);
          await page.getByRole("button", { name: "ホーム", exact: true }).click();
          if (mode === "success" && fits) {
            await page.locator("[data-mock-ad]").waitFor();
            assert.equal(await page.evaluate(() => window.__adRequests), 1);
          }
          await page.getByRole("button", { name: "曲を探して遊ぶ", exact: true }).click();
          await page.getByPlaceholder("曲名・アーティストを検索").fill("no matching song");
          assert.equal(
            await page.getByPlaceholder("曲名・アーティストを検索").inputValue(),
            "no matching song",
          );
        } finally {
          await context.close();
        }
      }
    }
    const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await configure(guestContext, "guest", "success", true);
      await page.locator("[data-mock-ad]").waitFor();
      assert.equal(await page.evaluate(() => window.__adRequests), 1);
      rows.push({ key: "guest", screen: "home", requests: 1, authenticated: false });
    } finally {
      await guestContext.close();
    }
    // Leaving while the SDK is pending must not register against an excluded screen.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await configure(context, "pending", "delayed");
      await page.locator("[data-admax-host]").waitFor();
      await page.getByRole("button", { name: "曲を探して遊ぶ", exact: true }).click();
      await page.waitForTimeout(1500);
      assert.equal(await page.locator("iframe").count(), 0);
      assert.equal(await page.locator(".admax-ads").count(), 0);
      assert.equal(await page.evaluate(() => window.__adRequests), 0);
      await page.getByRole("button", { name: "ホーム", exact: true }).click();
      await page.locator("[data-mock-ad]").waitFor();
      assert.equal(await page.evaluate(() => window.__adRequests), 1);
      assert.equal(counts.get("pending"), 1);
      rows.push({
        key: "pending",
        mode: "delayed",
        screen: "select",
        frames: 0,
        requestsWhileAway: 0,
        requestsOnReturn: 1,
      });
    } finally {
      await context.close();
    }
    const out = process.env.ADMAX_TEST_OUTPUT || "work/admax/browser-results.json";
    fs.mkdirSync(require("node:path").dirname(out), { recursive: true });
    fs.writeFileSync(
      out,
      JSON.stringify({ kind: "local synthetic scripts; not live AdMax", results: rows }, null, 2) +
        "\n",
    );
    console.log(
      `PASS: ${rows.length} measurements; synthetic SDK, retained DOM, cleanup, failure and navigation verified.`,
    );
  } finally {
    await browser.close();
    mockServer.close();
  }
})().catch((e) => {
  console.error(e);
  mockServer.close();
  process.exit(1);
});
