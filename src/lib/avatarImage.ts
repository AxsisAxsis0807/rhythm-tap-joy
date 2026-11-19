export const AVATAR_BUCKET = "player-avatars";
export const AVATAR_MAX_BYTES = 3 * 1024 * 1024;
const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 512;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
]);

export function validateAvatarInput(file: Pick<File, "type" | "size">) {
  if (!ALLOWED_TYPES.has(file.type.toLowerCase())) {
    throw new Error("JPEG・PNG・WebP・HEIC・AVIFの画像を選択してください。");
  }
  if (file.size <= 0 || file.size > MAX_INPUT_BYTES) {
    throw new Error("画像は12MB以下にしてください。");
  }
}

export function loadAvatarImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (error) {
        image.removeAttribute("src");
        reject(error);
      } else {
        resolve(image);
      }
    };
    const timer = window.setTimeout(() => finish(new Error("画像の読み込みがタイムアウトしました。")), 15000);
    image.onload = () => finish();
    image.onerror = () => finish(new Error("画像を読み込めませんでした。"));
    image.src = url;
  });
}

export async function normalizeAvatar(file: File): Promise<Blob> {
  validateAvatarInput(file);
  const source = URL.createObjectURL(file);
  try {
    const image = await loadAvatarImage(source);
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width * height > MAX_PIXELS) {
      throw new Error("画像の解像度が大きすぎるか、正常に読み込めませんでした。");
    }
    const edge = Math.min(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(edge, MAX_EDGE);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像を変換できませんでした。");
    context.drawImage(image, (width - edge) / 2, (height - edge) / 2, edge, edge, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value && value.type === "image/png" && value.size > 0 && value.size <= AVATAR_MAX_BYTES) {
          resolve(value);
        } else {
          reject(new Error("画像をPNGに変換できませんでした。"));
        }
      }, "image/png");
    });
    return blob;
  } finally {
    URL.revokeObjectURL(source);
  }
}
