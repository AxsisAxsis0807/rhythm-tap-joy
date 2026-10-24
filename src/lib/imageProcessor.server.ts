import jpegDecode, { init as initJpeg } from "@jsquash/jpeg/decode.js";
import pngDecode, { init as initPng } from "@jsquash/png/decode.js";
import webpDecode, { init as initWebp } from "@jsquash/webp/decode.js";
import jpegEncode, { init as initJpegEncoder } from "@jsquash/jpeg/encode.js";
import jpegWasm from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm?module";
import jpegEncoderWasm from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?module";
import pngWasm from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm?module";
import webpWasm from "@jsquash/webp/codec/dec/webp_dec.wasm?module";
import { IMAGE_TRANSFER_LIMIT, inspectStaticImage } from "./imageValidation";
import { sha256 } from "./xpContract";

// jSquash JS supports the documented compiled-module argument; its released .d.ts
// only declares the options overload. Keep the adaptation at this boundary.
const withModule = (init: unknown) =>
  init as (module: WebAssembly.Module, options?: { printErr: () => void }) => Promise<void>;
let initialized: Promise<void> | null = null;
let decodeWarning = false;
let busy = false;
async function initialize() {
  initialized ??= Promise.all([
    withModule(initJpeg)(jpegWasm, {
      printErr: () => {
        decodeWarning = true;
      },
    }),
    withModule(initJpegEncoder)(jpegEncoderWasm),
    initPng(pngWasm),
    withModule(initWebp)(webpWasm),
  ]).then(() => {});
  await initialized;
}
/** Bounded header checks precede real pixel decode. No original bytes are served. */
export async function canonicalizeBackground(bytes: Uint8Array) {
  const header = inspectStaticImage(bytes);
  if (busy) throw new Error("IMAGE_PROCESSOR_BUSY");
  busy = true;
  try {
    await initialize();
    decodeWarning = false;
    const buffer = bytes.slice().buffer;
    const pixels =
      header.mime === "image/jpeg"
        ? await jpegDecode(buffer)
        : header.mime === "image/png"
          ? await pngDecode(buffer)
          : await webpDecode(buffer);
    if (decodeWarning) throw new Error("IMAGE_DECODE_INVALID");
    if (
      pixels.width !== header.width ||
      pixels.height !== header.height ||
      pixels.data.byteLength !== pixels.width * pixels.height * 4
    )
      throw new Error("IMAGE_DECODE_MISMATCH");
    // Backgrounds are composited on the application's dark canvas before JPEG rewrite.
    // This removes alpha and all source metadata in a deterministic canonical image.
    const rgba = pixels.data;
    for (let i = 0; i < rgba.length; i += 4) {
      const alpha = rgba[i + 3]! / 255;
      rgba[i] = Math.round(rgba[i]! * alpha + 16 * (1 - alpha));
      rgba[i + 1] = Math.round(rgba[i + 1]! * alpha + 21 * (1 - alpha));
      rgba[i + 2] = Math.round(rgba[i + 2]! * alpha + 34 * (1 - alpha));
      rgba[i + 3] = 255;
    }
    const output = new Uint8Array(await jpegEncode(pixels, { quality: 85, progressive: false }));
    if (output.byteLength > IMAGE_TRANSFER_LIMIT) throw new Error("IMAGE_CANONICAL_TOO_LARGE");
    const canonical = inspectStaticImage(output);
    return { bytes: output, ...canonical, contentHash: await sha256(output) };
  } finally {
    busy = false;
  }
}
