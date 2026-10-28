import { MPEGDecoder } from "mpg123-decoder";
import { OpusDecoder } from "opus-decoder";
import { Decoder as VorbisDecoder } from "./oggVorbis";
import mpeg from "./mpg123.wasm?module";
import opus from "./opus.wasm?module";
import vorbis from "./vorbis.wasm?module";
import aac from "./aac.wasm?module";
import { setAacModule } from "./aacDecoder";
/** Explicit invocation is essential: this app declares sideEffects:false. */
export function installAudioModules() {
  (MPEGDecoder as typeof MPEGDecoder & { module: WebAssembly.Module }).module = mpeg;
  (OpusDecoder as typeof OpusDecoder & { module: WebAssembly.Module }).module = opus;
  VorbisDecoder.module = vorbis;
  setAacModule(aac);
}
