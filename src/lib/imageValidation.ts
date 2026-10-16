export type StaticImageHeader = {
  mime: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
};
export const IMAGE_TRANSFER_LIMIT = 3 * 1024 * 1024;
export const IMAGE_INPUT_LIMIT = 20 * 1024 * 1024;
const invalid = (): never => {
  throw new Error(
    "JPEG・PNG・静止WebPの完全な画像を指定してください。アニメーションやHEICには対応していません。",
  );
};
export function inspectStaticImage(
  bytes: Uint8Array,
  limits = { bytes: IMAGE_TRANSFER_LIMIT, edge: 2048, pixels: 4194304 },
): StaticImageHeader {
  if (!bytes.byteLength || bytes.byteLength > limits.bytes)
    throw new Error("画像ファイルのサイズが上限を超えています");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  const header = (
    mime: StaticImageHeader["mime"],
    width: number,
    height: number,
  ): StaticImageHeader => {
    if (
      !width ||
      !height ||
      width > limits.edge ||
      height > limits.edge ||
      width * height > limits.pixels
    )
      throw new Error("画像の寸法が上限を超えています");
    return { mime, width, height };
  };
  if (bytes.length >= 33 && bytes[0] === 137 && ascii(1, 7) === "PNG\r\n\x1a\n") {
    let result: StaticImageHeader | null = null,
      data = false,
      ended = false;
    for (let pos = 8; pos < bytes.length;) {
      if (pos + 12 > bytes.length) invalid();
      const length = view.getUint32(pos),
        end = pos + 12 + length,
        kind = ascii(pos + 4, 4);
      if (end > bytes.length) invalid();
      if (["acTL", "fcTL", "fdAT"].includes(kind)) invalid();
      let crc = 0xffffffff;
      for (let i = pos + 4; i < end - 4; i++) {
        crc ^= bytes[i]!;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(end - 4)) invalid();
      if (pos === 8) {
        if (kind !== "IHDR" || length !== 13) invalid();
        result = header("image/png", view.getUint32(pos + 8), view.getUint32(pos + 12));
      } else if (kind === "IHDR") invalid();
      if (kind === "IDAT") data = true;
      if (kind === "IEND") {
        if (length !== 0 || end !== bytes.length || !data) invalid();
        ended = true;
      }
      pos = end;
    }
    if (!result || !ended) return invalid();
    return result;
  }
  if (bytes.length >= 20 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    if (view.getUint32(4, true) + 8 !== bytes.length) invalid();
    let result: StaticImageHeader | null = null,
      payload = false;
    for (let pos = 12; pos < bytes.length;) {
      if (pos + 8 > bytes.length) invalid();
      const kind = ascii(pos, 4),
        size = view.getUint32(pos + 4, true),
        end = pos + 8 + size;
      if (end > bytes.length) invalid();
      if (kind === "ANIM" || kind === "ANMF") invalid();
      if (kind === "VP8X") {
        if (size !== 10 || bytes[pos + 8]! & 2) invalid();
        result = header(
          "image/webp",
          1 + bytes[pos + 12]! + (bytes[pos + 13]! << 8) + (bytes[pos + 14]! << 16),
          1 + bytes[pos + 15]! + (bytes[pos + 16]! << 8) + (bytes[pos + 17]! << 16),
        );
      } else if (kind === "VP8 ") {
        if (size < 10 || ascii(pos + 11, 3) !== "\x9d\x01\x2a" || payload) invalid();
        const dimensions = header(
          "image/webp",
          view.getUint16(pos + 14, true) & 0x3fff,
          view.getUint16(pos + 16, true) & 0x3fff,
        );
        if (result && (result.width !== dimensions.width || result.height !== dimensions.height))
          invalid();
        result = dimensions;
        payload = true;
      } else if (kind === "VP8L") {
        if (size < 5 || bytes[pos + 8] !== 0x2f || payload) invalid();
        const packed = view.getUint32(pos + 9, true);
        const dimensions = header(
          "image/webp",
          (packed & 0x3fff) + 1,
          ((packed >>> 14) & 0x3fff) + 1,
        );
        if (result && (result.width !== dimensions.width || result.height !== dimensions.height))
          invalid();
        result = dimensions;
        payload = true;
      }
      pos = end + (size % 2);
      if (pos > bytes.length) invalid();
    }
    if (!result || !payload) return invalid();
    return result;
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let result: StaticImageHeader | null = null,
      scan = false,
      ended = false;
    for (let pos = 2; pos < bytes.length;) {
      if (bytes[pos++] !== 255) invalid();
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++];
      if (marker === undefined || marker === 0 || marker === 216) return invalid();
      if (marker === 217) {
        if (pos !== bytes.length || !scan) invalid();
        ended = true;
        break;
      }
      if (marker >= 208 && marker <= 215) continue;
      if (pos + 2 > bytes.length) invalid();
      const size = view.getUint16(pos),
        end = pos + size;
      if (size < 2 || end > bytes.length) invalid();
      if ([192, 193, 194].includes(marker)) {
        if (size < 8 || bytes[pos + 2] !== 8 || result) invalid();
        result = header("image/jpeg", view.getUint16(pos + 5), view.getUint16(pos + 3));
      }
      pos = end;
      if (marker === 218) {
        scan = true;
        while (pos < bytes.length) {
          if (bytes[pos] !== 255) {
            pos++;
            continue;
          }
          const next = bytes[pos + 1];
          if (next === 0 || (next !== undefined && next >= 208 && next <= 215)) {
            pos += 2;
            continue;
          }
          if (next === 255) {
            pos++;
            continue;
          }
          break;
        }
      }
    }
    if (!result || !ended) return invalid();
    return result;
  }
  return invalid();
}
