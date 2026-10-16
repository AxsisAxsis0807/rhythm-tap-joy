import type { AudioRangeSource } from "./audioRange";
/** Read EBML timing fields which the pinned packet demuxer does not yet expose.
 * Only metadata and a single <=1MiB range are retained; encoded blocks are skipped.
 */
export async function webmOpusTiming(source: AudioRangeSource, signal: AbortSignal) {
  let cache: Uint8Array = new Uint8Array(0),
    cacheStart = -1,
    blocks = 0,
    paddingBlock = -1,
    paddingNs = 0,
    delayNs = 0,
    trackNumber = 0;
  const bytes = async (start: number, length: number) => {
    if (signal.aborted) throw signal.reason;
    if (start < 0 || length < 1 || start + length > source.size || length > 1048576)
      throw new Error("WEBM_TRUNCATED");
    if (start < cacheStart || start + length > cacheStart + cache.length) {
      cacheStart = start;
      cache = await source.read(start, Math.min(source.size, start + 1048576));
    }
    return cache.subarray(start - cacheStart, start - cacheStart + length);
  };
  const vint = async (pos: number, id = false) => {
    const first = (await bytes(pos, 1))[0]!;
    let length = 1,
      mask = 128;
    while (length <= 8 && !(first & mask)) {
      length++;
      mask >>= 1;
    }
    if (length > 8 || (id && length > 4)) throw new Error("WEBM_INVALID");
    const valueBytes = await bytes(pos, length);
    let value = id ? first : first & (mask - 1),
      unknown = !id && value === mask - 1;
    for (let i = 1; i < length; i++) {
      value = value * 256 + valueBytes[i]!;
      unknown &&= valueBytes[i] === 255;
    }
    if (!unknown && !Number.isSafeInteger(value)) throw new Error("WEBM_INVALID");
    return { length, value, unknown };
  };
  const integer = async (pos: number, length: number, signed = false) => {
    if (length > 8) throw new Error("WEBM_INVALID");
    const value = await bytes(pos, length);
    let n = signed && value[0]! & 128 ? -1 : 0;
    for (const b of value) n = n * 256 + b;
    if (!Number.isSafeInteger(n)) throw new Error("WEBM_INVALID");
    return n;
  };
  type Track = { number: number; type: number; codec: string; delay: number };
  const tracks: Track[] = [];
  const masters = new Set([0x18538067, 0x1654ae6b, 0xae, 0x1f43b675, 0xa0]);
  const walk = async (
    start: number,
    end: number,
    parent: number,
    depth = 0,
    track?: Track,
  ): Promise<number> => {
    if (depth > 8) throw new Error("WEBM_INVALID");
    let pos = start;
    while (pos < end) {
      const id = await vint(pos, true);
      if (parent === 0x1f43b675 && id.value === 0x1f43b675) return pos;
      const size = await vint(pos + id.length),
        data = pos + id.length + size.length,
        next = size.unknown ? end : data + size.value;
      if (next > end || next <= pos) throw new Error("WEBM_TRUNCATED");
      if (size.unknown && ![0x18538067, 0x1f43b675].includes(id.value))
        throw new Error("WEBM_INVALID");
      if (id.value === 0xae) {
        const item = { number: 0, type: 0, codec: "", delay: 0 };
        await walk(data, next, id.value, depth + 1, item);
        tracks.push(item);
        if (item.type === 2) {
          if (trackNumber) throw new Error("WEBM_MULTIPLE_AUDIO_TRACKS");
          if (item.codec !== "A_OPUS") throw new Error("UNSUPPORTED_AUDIO_FORMAT");
          trackNumber = item.number;
          delayNs = item.delay;
        }
      } else if (masters.has(id.value)) {
        const consumed = await walk(data, next, id.value, depth + 1, track);
        if (size.unknown && consumed < next) {
          pos = consumed;
          continue;
        }
      } else if (track && id.value === 0xd7) track.number = await integer(data, size.value);
      else if (track && id.value === 0x83) track.type = await integer(data, size.value);
      else if (track && id.value === 0x86)
        track.codec = new TextDecoder().decode(await bytes(data, size.value));
      else if (track && id.value === 0x56aa) track.delay = await integer(data, size.value);
      else if (id.value === 0xa3 || id.value === 0xa1) {
        const number = await vint(data);
        if (number.value === trackNumber) blocks++;
      } else if (id.value === 0x75a2) {
        const padding = await integer(data, size.value, true);
        if (padding < 0 || paddingNs) throw new Error("WEBM_UNSUPPORTED_PADDING");
        paddingNs = padding;
        paddingBlock = blocks;
      }
      pos = next;
    }
    return pos;
  };
  await walk(0, source.size, 0);
  if (!trackNumber || !blocks || (paddingNs && paddingBlock !== blocks))
    throw new Error("WEBM_INVALID");
  return { delayNs, paddingNs };
}
