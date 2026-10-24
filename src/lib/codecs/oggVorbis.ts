import OggVorbisDecoder, {
  Decoder,
} from "../../../node_modules/@wasm-audio-decoders/ogg-vorbis/src/OggVorbisDecoder.js";
// Keep both imports on the same pinned source module across the two-stage SSR
// build. Mixing its public entry with a bundled private Decoder duplicates the
// constructor and loses the injected static WASM module on Cloudflare.
Object.defineProperty(OggVorbisDecoder, "name", { value: "OggVorbisDecoder" });
export { OggVorbisDecoder, Decoder };
