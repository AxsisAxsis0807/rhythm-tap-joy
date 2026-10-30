/** Snapshot the just-built measurement output and add a deterministic local audio fixture. */
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const label = process.argv[2];
if (!/^[A-Z][A-Za-z0-9-]*$/.test(label || ""))
  throw new Error("Usage: node scripts/prepare-performance-preview.mjs A");
const root = resolve(`work/phase3/${label}/.output`);
await mkdir(root, { recursive: true });
const source = resolve(process.argv[3] || ".output");
const buildProject = dirname(source);
await cp(source, root, { recursive: true });
const count = 90 * 8000;
const wav = Buffer.alloc(44 + count * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + count * 2, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(count * 2, 40);
for (let i = 0; i < count; i++)
  wav.writeInt16LE(Math.trunc(1000 * Math.sin((i * 2 * Math.PI * 220) / 8000)), 44 + i * 2);
await mkdir(resolve(root, "public/audio"), { recursive: true });
await writeFile(resolve(root, "public/audio/performance-local.wav"), wav);
const hash = (x) => createHash("sha256").update(x).digest("hex");
const files = {};
async function collect(dir) {
  for (const name of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, name.name);
    if (name.isDirectory()) await collect(path);
    else files[relative(root, path)] = hash(await readFile(path));
  }
}
await collect(root);
const manifest = {
  label,
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: buildProject }).trim(),
  sourceDiffSha256: hash(execFileSync("git", ["diff", "HEAD", "--", "src"], { cwd: buildProject })),
  measurementConfigSha256: hash(
    await readFile(resolve(buildProject, "scripts/vite.performance.config.ts")),
  ),
  audioSha256: hash(wav),
  files,
};
await writeFile(resolve(root, "../build.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(root);
