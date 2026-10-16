import moduleUrl from "./aac.wasm?url";
let compiled: Promise<WebAssembly.Module> | null = null;
/** Server injects the statically imported module; browser fetches only its bundled asset. */
export function setAacModule(module: WebAssembly.Module) {
  compiled = Promise.resolve(module);
}
type Exports = {
  memory: WebAssembly.Memory;
  allocate: (bytes: number) => number;
  deallocate: (pointer: number, bytes: number) => void;
  configure: (pointer: number, bytes: number) => number;
  decode_packet: (pointer: number, bytes: number) => number;
  output_ptr: () => number;
  sample_rate: () => number;
  channels: () => number;
  release: () => void;
};
export async function createAacDecoder(configuration: Uint8Array) {
  compiled ??= fetch(moduleUrl, { redirect: "error" }).then(async (response) => {
    if (!response.ok) throw new Error("AAC_MODULE_UNAVAILABLE");
    return WebAssembly.compile(await response.arrayBuffer());
  });
  const instance = await WebAssembly.instantiate(await compiled, {}),
    wasm = instance.exports as Exports;
  const input = (bytes: Uint8Array, call: (pointer: number, bytes: number) => number) => {
    const pointer = wasm.allocate(bytes.length);
    if (!pointer) throw new Error("AAC_PACKET_TOO_LARGE");
    try {
      new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
      return call(pointer, bytes.length);
    } finally {
      wasm.deallocate(pointer, bytes.length);
    }
  };
  if (input(configuration, wasm.configure) !== 0) throw new Error("UNSUPPORTED_AAC_PROFILE");
  return {
    decode(bytes: Uint8Array) {
      const frames = input(bytes, wasm.decode_packet),
        channels = wasm.channels(),
        sampleRate = wasm.sample_rate();
      if (frames < 0 || channels < 1 || channels > 8) throw new Error("AUDIO_DECODE_INVALID");
      const interleaved = new Float32Array(
        wasm.memory.buffer,
        wasm.output_ptr(),
        frames * channels,
      );
      const channelData = Array.from({ length: channels }, (_, channel) =>
        Float32Array.from(
          { length: frames },
          (_, frame) => interleaved[frame * channels + channel]!,
        ),
      );
      return { channelData, sampleRate, errors: [] };
    },
    free: () => wasm.release(),
  };
}
