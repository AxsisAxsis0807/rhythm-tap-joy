/** Speech enhancement changes PCM and is never used for canonical waveform analysis. */
export class OpusMLDecoder {
  constructor() {
    throw new Error("OPUS_SPEECH_ENHANCEMENT_DISABLED");
  }
}
export const OpusMLDecoderWebWorker = OpusMLDecoder;
