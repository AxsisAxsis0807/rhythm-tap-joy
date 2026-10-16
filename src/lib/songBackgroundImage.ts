import { IMAGE_INPUT_LIMIT, IMAGE_TRANSFER_LIMIT, inspectStaticImage } from "./imageValidation";
/** Client resource protection; the server independently decodes and canonicalizes the upload. */
export async function prepareBackgroundFile(file: File, signal: AbortSignal): Promise<File> {
  if (file.size > IMAGE_INPUT_LIMIT) throw new Error("画像は20MiB以内で指定してください");
  inspectStaticImage(new Uint8Array(await file.arrayBuffer()), {
    bytes: IMAGE_INPUT_LIMIT,
    edge: 8192,
    pixels: 16777216,
  });
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像を処理できませんでした");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("画像を変換できませんでした"))),
        "image/webp",
        0.85,
      ),
    );
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (blob.size > IMAGE_TRANSFER_LIMIT)
      throw new Error("縮小後の画像が3MiBを超えています。小さい画像を選択してください");
    const header = inspectStaticImage(new Uint8Array(await blob.arrayBuffer()));
    return new File([blob], "background.webp", { type: header.mime });
  } finally {
    bitmap.close();
  }
}
