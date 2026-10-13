/** Bounded container metadata parsing. Unsupported formats require conversion; no native codec dependency. */
export function audioMetadata(bytes: Uint8Array): { durationMs: number; mime: string } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) =>
    new TextDecoder().decode(bytes.subarray(start, start + length));
  let duration = 0,
    mime = "";
  if (bytes.length >= 44 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") {
    if (v.getUint32(4, true) + 8 !== bytes.length) throw new Error("WAV container length mismatch");
    let rate = 0,
      size = 0;
    for (let pos = 12; pos + 8 <= bytes.length;) {
      const length = v.getUint32(pos + 4, true),
        end = pos + 8 + length;
      if (end > bytes.length) throw new Error("Truncated WAV chunk");
      if (ascii(pos, 4) === "fmt ") {
        if (length < 16) throw new Error("Invalid WAV format");
        const codec = v.getUint16(pos + 8, true),
          channels = v.getUint16(pos + 10, true),
          sampleRate = v.getUint32(pos + 12, true),
          bits = v.getUint16(pos + 22, true);
        rate = v.getUint32(pos + 16, true);
        if (
          ![1, 3].includes(codec) ||
          channels < 1 ||
          channels > 8 ||
          sampleRate < 8000 ||
          sampleRate > 192000 ||
          ![8, 16, 24, 32].includes(bits) ||
          rate !== (sampleRate * channels * bits) / 8
        )
          throw new Error("Unsupported WAV encoding");
      }
      if (ascii(pos, 4) === "data") size += length;
      pos = end + (length % 2);
    }
    if (!rate || !size) throw new Error("WAV data missing");
    duration = (size / rate) * 1000;
    mime = "audio/wav";
  } else if (bytes.length >= 47 && ascii(0, 4) === "OggS") {
    let pos = 0,
      sequence = 0,
      serial: number | undefined,
      rate = 0,
      skip = 0,
      lastGranule = 0n,
      ended = false;
    while (pos < bytes.length) {
      if (pos + 27 > bytes.length || ascii(pos, 4) !== "OggS" || bytes[pos + 4] !== 0 || ended)
        throw new Error("Invalid or chained Ogg stream");
      const pageSerial = v.getUint32(pos + 14, true),
        pageSequence = v.getUint32(pos + 18, true),
        segments = bytes[pos + 26]!;
      serial ??= pageSerial;
      if (
        pageSerial !== serial ||
        pageSequence !== sequence++ ||
        pos + 27 + segments > bytes.length
      )
        throw new Error("Invalid Ogg page sequence");
      let size = 0;
      for (let i = 0; i < segments; i++) size += bytes[pos + 27 + i]!;
      const body = pos + 27 + segments,
        end = body + size;
      if (end > bytes.length) throw new Error("Truncated Ogg page");
      // Ogg CRC includes the whole page with its checksum field cleared.
      let crc = 0;
      for (let i = pos; i < end; i++) {
        crc ^= (i >= pos + 22 && i < pos + 26 ? 0 : bytes[i]!) << 24;
        for (let b = 0; b < 8; b++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
      }
      if (crc >>> 0 !== v.getUint32(pos + 22, true)) throw new Error("Ogg checksum mismatch");
      if (sequence === 1) {
        if (ascii(body, 8) === "OpusHead" && size >= 19) {
          rate = 48000;
          skip = v.getUint16(body + 10, true);
        } else if (bytes[body] === 1 && ascii(body + 1, 6) === "vorbis" && size >= 30)
          rate = v.getUint32(body + 12, true);
        else throw new Error("Only Ogg Vorbis/Opus audio is supported");
        if (rate < 8000 || rate > 192000) throw new Error("Invalid Ogg sample rate");
      }
      const granule = v.getBigUint64(pos + 6, true);
      if (granule !== 0xffffffffffffffffn) {
        if (granule < lastGranule) throw new Error("Ogg time rewinds");
        lastGranule = granule;
      }
      ended = Boolean(bytes[pos + 5]! & 4);
      pos = end;
    }
    if (!ended || lastGranule > BigInt(rate) * 7200n || lastGranule <= BigInt(skip))
      throw new Error("Invalid Ogg ending");
    duration = ((Number(lastGranule) - skip) / rate) * 1000;
    mime = "audio/ogg";
  } else throw new Error("新しいRevisionではPCM WAVまたはOgg Vorbis/Opusを使用してください。");
  const durationMs = Math.floor(duration);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 7200000)
    throw new Error("Invalid audio duration");
  return { durationMs, mime };
}
