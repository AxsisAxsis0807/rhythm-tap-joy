/** Strict bounded container validation supplements decoders which otherwise recover silently. */
const oggCrc = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value << 24;
  for (let i = 0; i < 8; i++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  return crc >>> 0;
});
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
export class OggStreamValidator {
  private pending: Uint8Array = new Uint8Array(0);
  private serial: number | undefined;
  private sequence = 0;
  private ended = false;
  private rate = 0;
  private preSkip = 0;
  private granule = 0n;
  push(bytes: Uint8Array) {
    const merged = new Uint8Array(this.pending.length + bytes.length);
    merged.set(this.pending);
    merged.set(bytes, this.pending.length);
    let pos = 0;
    while (merged.length - pos >= 27) {
      if (
        this.ended ||
        text(merged.subarray(pos, pos + 4)) !== "OggS" ||
        merged[pos + 4] !== 0 ||
        merged[pos + 5]! & ~7
      )
        throw new Error("OGG_CONTAINER_INVALID");
      const segments = merged[pos + 26]!,
        header = 27 + segments;
      if (merged.length - pos < header) break;
      let size = header;
      for (let i = 0; i < segments; i++) size += merged[pos + 27 + i]!;
      if (merged.length - pos < size) break;
      const page = merged.subarray(pos, pos + size),
        view = new DataView(page.buffer, page.byteOffset, page.length);
      const serial = view.getUint32(14, true),
        sequence = view.getUint32(18, true);
      this.serial ??= serial;
      if (
        serial !== this.serial ||
        sequence !== this.sequence++ ||
        (sequence === 0 && !(page[5]! & 2)) ||
        (sequence !== 0 && page[5]! & 2)
      )
        throw new Error("OGG_SEQUENCE_INVALID");
      let crc = 0;
      for (let i = 0; i < page.length; i++)
        crc = (crc << 8) ^ oggCrc[((crc >>> 24) ^ (i >= 22 && i < 26 ? 0 : page[i]!)) & 255]!;
      if (crc >>> 0 !== view.getUint32(22, true)) throw new Error("OGG_CHECKSUM_INVALID");
      if (sequence === 0) {
        const body = page.subarray(header);
        if (text(body.subarray(0, 8)) === "OpusHead" && body.length >= 19) {
          this.rate = 48000;
          this.preSkip = new DataView(body.buffer, body.byteOffset, body.length).getUint16(
            10,
            true,
          );
        } else if (body[0] === 1 && text(body.subarray(1, 7)) === "vorbis" && body.length >= 30)
          this.rate = new DataView(body.buffer, body.byteOffset, body.length).getUint32(12, true);
        else throw new Error("UNSUPPORTED_AUDIO_FORMAT");
      }
      this.ended = Boolean(page[5]! & 4);
      this.granule = view.getBigUint64(6, true);
      pos += size;
    }
    this.pending = merged.slice(pos);
    if (this.pending.length > 65307) throw new Error("OGG_PAGE_TOO_LARGE");
  }
  finish() {
    if (
      this.pending.length ||
      !this.ended ||
      !this.rate ||
      this.granule > BigInt(this.rate) * 7200n ||
      this.granule < BigInt(this.preSkip)
    )
      throw new Error("OGG_TRUNCATED");
    return Math.floor((Number(this.granule - BigInt(this.preSkip)) * 1000) / this.rate);
  }
}
export class Mp3StreamValidator {
  private pending: Uint8Array = new Uint8Array(0);
  private first = true;
  private tagRemaining = 0;
  private frames = 0;
  private tail = false;
  push(bytes: Uint8Array) {
    if (this.tail && bytes.length) throw new Error("MP3_TRAILING_BYTES");
    const merged = new Uint8Array(this.pending.length + bytes.length);
    merged.set(this.pending);
    merged.set(bytes, this.pending.length);
    let pos = 0;
    if (this.first) {
      if (merged.length < 10) {
        this.pending = merged;
        return;
      }
      this.first = false;
      if (text(merged.subarray(0, 3)) === "ID3") {
        if (![2, 3, 4].includes(merged[3]!) || merged.subarray(6, 10).some((value) => value & 128))
          throw new Error("ID3_INVALID");
        this.tagRemaining =
          10 +
          (merged[6]! << 21) +
          (merged[7]! << 14) +
          (merged[8]! << 7) +
          merged[9]! +
          (merged[3] === 4 && merged[5]! & 16 ? 10 : 0);
        if (this.tagRemaining > 8 * 1024 * 1024) throw new Error("ID3_TOO_LARGE");
      }
    }
    if (this.tagRemaining) {
      const skip = Math.min(this.tagRemaining, merged.length);
      pos += skip;
      this.tagRemaining -= skip;
    }
    while (merged.length - pos >= 4) {
      if (text(merged.subarray(pos, pos + 3)) === "TAG") {
        if (merged.length - pos < 128) break;
        if (merged.length - pos !== 128) throw new Error("MP3_TRAILING_BYTES");
        pos += 128;
        this.tail = true;
        break;
      }
      const a = merged[pos]!,
        b = merged[pos + 1]!,
        c = merged[pos + 2]!,
        version = (b >> 3) & 3,
        layer = (b >> 1) & 3,
        index = c >> 4,
        rateIndex = (c >> 2) & 3;
      if (
        a !== 255 ||
        (b & 224) !== 224 ||
        version === 1 ||
        layer !== 1 ||
        index === 0 ||
        index === 15 ||
        rateIndex === 3
      )
        throw new Error("MP3_FRAME_INVALID");
      const rate = [44100, 48000, 32000][rateIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4);
      const kbps = (
        version === 3
          ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
          : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
      )[index]!;
      const size = Math.floor(((version === 3 ? 144 : 72) * kbps * 1000) / rate) + ((c >> 1) & 1);
      if (merged.length - pos < size) break;
      pos += size;
      this.frames++;
    }
    this.pending = merged.slice(pos);
    if (this.pending.length > 65536) throw new Error("MP3_FRAME_TOO_LARGE");
  }
  finish() {
    if (this.first || this.tagRemaining || this.pending.length || !this.frames)
      throw new Error("MP3_TRUNCATED");
  }
}
