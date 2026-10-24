declare module "*.wasm?module" {
  const module: WebAssembly.Module;
  export default module;
}
declare module "*ogg-vorbis/src/OggVorbisDecoder.js" {
  import { OggVorbisDecoder } from "@wasm-audio-decoders/ogg-vorbis";
  export default OggVorbisDecoder;
  export const Decoder: { module?: WebAssembly.Module };
}
