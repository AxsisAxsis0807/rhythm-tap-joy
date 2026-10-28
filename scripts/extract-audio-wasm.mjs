import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MPEGDecoder } from "mpg123-decoder";
import { OpusDecoder } from "opus-decoder";
import { OggVorbisDecoder } from "@wasm-audio-decoders/ogg-vorbis";
// Extract official, lock-pinned bytes at build time. No network/CDN or runtime compilation on the server.
const original = WebAssembly.compile;
const captures = [];
WebAssembly.compile = async function (bytes) {
  captures.push(new Uint8Array(bytes).slice());
  return original.call(WebAssembly, bytes);
};
const manifest = [];
try {
  for (const [name, Decoder] of [
    ["mpg123", MPEGDecoder],
    ["opus", OpusDecoder],
    ["vorbis", OggVorbisDecoder],
  ]) {
    captures.length = 0;
    const decoder = new Decoder();
    await decoder.ready;
    decoder.free();
    const bytes = captures.at(-1);
    if (!bytes) throw new Error(`No module extracted for ${name}`);
    await mkdir(new URL("../src/lib/codecs/", import.meta.url), { recursive: true });
    await writeFile(new URL(`../src/lib/codecs/${name}.wasm`, import.meta.url), bytes);
    manifest.push({
      name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
} finally {
  WebAssembly.compile = original;
}
// The independently built MPL-2.0 AAC adapter is not extracted from npm.
// Rebuild it using codecs/aac/README.md before refreshing this manifest.
const aac = await readFile(new URL("../src/lib/codecs/aac.wasm", import.meta.url));
manifest.push({
  name: "aac",
  bytes: aac.length,
  sha256: createHash("sha256").update(aac).digest("hex"),
});
await writeFile(
  new URL("../src/lib/codecs/manifest.json", import.meta.url),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(manifest);
