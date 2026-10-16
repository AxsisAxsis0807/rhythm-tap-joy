import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = ".output/server",
  work = "work/runtime-verification";
await mkdir(work, { recursive: true });
const find = async (directory, prefix) =>
  (await readdir(directory)).find((file) => file.startsWith(prefix) && file.endsWith(".mjs"));
const source = await find(`${root}/_ssr`, "songSource.server-"),
  image = await find(`${root}/_ssr`, "imageProcessor.server-"),
  modules = await find(`${root}/_chunks`, "staticAudioModules.server-");
if (!source || !image || !modules)
  throw new Error("Run npm run build before artifact verification");
const sourcePath = `${root}/_ssr/${source}`,
  original = await readFile(sourcePath, "utf8");
assert.ok(original.includes("async function analyzeAudioStream("));
const port = 8788,
  base = `http://127.0.0.1:${port}`;
const entry = `import {analyzeAudioStream} from './_ssr/${source}';
import {canonicalizeBackground} from './_ssr/${image}';
import {installAudioModules} from './_chunks/${modules}';
installAudioModules();
export default {async fetch(request,env){const url=new URL(request.url);try{
if(url.pathname==='/image'){const result=await canonicalizeBackground(new Uint8Array(await request.arrayBuffer()));return Response.json({mime:result.mime,width:result.width,height:result.height,hash:result.contentHash,bytes:result.bytes.length});}
if(url.pathname==='/audio-upload'){const result=await analyzeAudioStream(request.body,new AbortController().signal);return Response.json({durationMs:result.waveform.durationMs,bytes:result.bytes});}
if(url.pathname==='/audio'){const extension=url.searchParams.get('format');if(!['wav','mp3','ogg','opus','m4a','webm'].includes(extension))return new Response('',{status:400});const target=new URL('/impulse.'+extension,url),response=await env.ASSETS.fetch(target);const result=await analyzeAudioStream(response.body,new AbortController().signal,undefined,async size=>({size,read:async(start,end)=>{const response=await env.ASSETS.fetch(new Request(target,{headers:{Range:'bytes='+start+'-'+(end-1)}}));const bytes=new Uint8Array(await response.arrayBuffer());if(response.status===206)return bytes;
// Local static-asset emulation may ignore Range. These six checked-in fixtures
// are tiny; production Storage ranges are independently tested through the API.
if(response.status!==200||bytes.length!==size||size>1024*1024)throw new Error('TEST_FIXTURE_RANGE_UNAVAILABLE');return bytes.slice(start,end);}}));return Response.json({durationMs:result.waveform.durationMs,format:result.format,hash:result.audioHash,peaks:result.waveform.minMax.length});}
return new Response('ready');}catch(error){return Response.json({code:error.message},{status:422});}}};`;
const config = {
  name: "pulse-song-settings-local-test",
  main: "../../.output/server/runtime-check.mjs",
  compatibility_date: process.env.PULSE_LOCAL_COMPATIBILITY_DATE ?? "2026-10-13",
  compatibility_flags: ["nodejs_compat"],
  no_bundle: true,
  rules: [{ type: "ESModule", globs: ["**/*.mjs", "**/*.js"] }],
  assets: {
    binding: "ASSETS",
    directory: "../../tests/fixtures/song-settings",
    run_worker_first: true,
  },
  dev: { port, ip: "127.0.0.1" },
};
let child;
let log = "";
try {
  await writeFile(sourcePath, original + "\nexport {analyzeAudioStream};\n");
  await writeFile(`${root}/runtime-check.mjs`, entry);
  await writeFile(`${work}/wrangler.json`, JSON.stringify(config));
  const executable = process.env.WRANGLER_BIN ?? "wrangler";
  child = spawn(
    executable,
    ["dev", "--local", "--config", `${work}/wrangler.json`, "--port", String(port)],
    {
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        XDG_CONFIG_HOME: process.cwd() + "/work/cloudflare-home",
        WRANGLER_LOG_PATH: process.cwd() + `/${work}/wrangler.log`,
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const capture = (bytes) => {
    log += bytes.toString();
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("Local workerd exited before readiness");
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(500) });
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const results = [];
  for (const extension of ["wav", "mp3", "ogg", "opus", "m4a", "webm"]) {
    const started = performance.now(),
      response = await fetch(base + "/audio?format=" + extension),
      result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.durationMs, 1125);
    results.push({
      case: extension,
      milliseconds: Math.round(performance.now() - started),
      ...result,
    });
  }
  for (const extension of ["jpg", "png", "webp"]) {
    const response = await fetch(base + "/image", {
        method: "POST",
        body: await readFile(`tests/fixtures/song-settings/image.${extension}`),
      }),
      result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.mime, "image/jpeg");
    assert.equal(result.width, 16);
    assert.equal(result.height, 9);
    results.push({ case: extension, ...result });
  }
  // 100 MiB PCM would require a file-sized decoded buffer in a non-streaming implementation.
  const maximum = 100 * 1024 * 1024;
  const wavStream = (total) => {
    let remaining = total - 44,
      headerSent = false;
    const header = new Uint8Array(44),
      view = new DataView(header.buffer);
    header.set(new TextEncoder().encode("RIFF"));
    view.setUint32(4, total - 8, true);
    header.set(new TextEncoder().encode("WAVEfmt "), 8);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, 48000, true);
    view.setUint32(28, 192000, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    header.set(new TextEncoder().encode("data"), 36);
    view.setUint32(40, total - 44, true);
    return new ReadableStream({
      pull(controller) {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(header);
          return;
        }
        if (remaining <= 0) {
          controller.close();
          return;
        }
        const length = Math.min(32768, remaining);
        controller.enqueue(new Uint8Array(length));
        remaining -= length;
      },
    });
  };
  const longStarted = performance.now();
  const large = await fetch(base + "/audio-upload", {
      method: "POST",
      body: wavStream(maximum),
      duplex: "half",
      signal: AbortSignal.timeout(120000),
    }),
    largeResult = await large.json();
  assert.equal(large.status, 200, JSON.stringify(largeResult));
  assert.equal(largeResult.bytes, maximum);
  assert.equal(largeResult.durationMs, Math.floor(((maximum - 44) / 192000) * 1000));
  results.push({
    case: "100 MiB streaming PCM boundary",
    milliseconds: Math.round(performance.now() - longStarted),
    ...largeResult,
  });
  const oversizedHeader = new Uint8Array(12);
  oversizedHeader.set(new TextEncoder().encode("RIFF"));
  new DataView(oversizedHeader.buffer).setUint32(4, maximum - 7, true);
  oversizedHeader.set(new TextEncoder().encode("WAVE"), 8);
  const oversized = await fetch(base + "/audio-upload", { method: "POST", body: oversizedHeader });
  assert.equal(oversized.status, 422);
  results.push({ case: "100 MiB + 1 declared WAV rejected", status: oversized.status });
  const invalid = await fetch(base + "/image", { method: "POST", body: "<svg/>" });
  assert.equal(invalid.status, 422);
  results.push({ case: "unsupported image rejected", status: invalid.status });
  await writeFile(
    `${work}/results.json`,
    JSON.stringify(
      {
        compatibilityDate: config.compatibility_date,
        productionCompatibilityDate: "2026-10-16",
        note: "Local artifact test; not a deployed target/plan verification. Only an export was added to expose the production analysis function.",
        results,
      },
      null,
      2,
    ),
  );
  await writeFile(`${work}/runtime.log`, log);
  console.log(JSON.stringify({ compatibilityDate: config.compatibility_date, results }));
} finally {
  if (child) {
    await writeFile(`${work}/runtime.log`, log);
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    const force = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, 1500);
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("exit", resolve);
    });
    clearTimeout(force);
  }
  await writeFile(sourcePath, original);
  await unlink(`${root}/runtime-check.mjs`).catch(() => {});
}
