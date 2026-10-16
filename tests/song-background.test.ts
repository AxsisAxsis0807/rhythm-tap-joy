// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { inspectStaticImage } from "@/lib/imageValidation";
import { canonicalizeBackground } from "@/lib/imageProcessor.server";
import { sha256 } from "@/lib/xpContract";
const fixture = (name: string) =>
  new Uint8Array(readFileSync(`tests/fixtures/song-settings/${name}`));
for (const file of ["image.jpg", "image.png", "image.webp", "alpha.webp"])
  it(`real pixel decode and deterministic canonical rewrite: ${file}`, async () => {
    const original = fixture(file),
      result = await canonicalizeBackground(original),
      again = await canonicalizeBackground(original);
    expect(result.mime).toBe("image/jpeg");
    expect(result.width).toBe(16);
    expect(result.height).toBe(9);
    expect(result.contentHash).toBe(await sha256(result.bytes));
    expect(again.contentHash).toBe(result.contentHash);
    expect(inspectStaticImage(result.bytes)).toEqual({ mime: "image/jpeg", width: 16, height: 9 });
  });
it("rejects unsupported markup, truncation and a forged PNG size before decoding", async () => {
  for (const data of [
    new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    new TextEncoder().encode("GIF89a"),
    fixture("image.png").subarray(0, 35),
    fixture("image.webp").subarray(0, 24),
    fixture("image.jpg").subarray(0, 100),
  ])
    expect(() => inspectStaticImage(data)).toThrow();
  const oversized = fixture("image.png");
  new DataView(oversized.buffer).setUint32(16, 100000);
  expect(() => inspectStaticImage(oversized)).toThrow();
});
it("rejects a complete image header with invalid compressed pixels", async () => {
  const broken = fixture("image.jpg");
  const scan = broken.findIndex((value, i) => value === 0xff && broken[i + 1] === 0xda);
  const start = scan + 2 + new DataView(broken.buffer).getUint16(scan + 2);
  broken.fill(0, start, broken.length - 2);
  await expect(canonicalizeBackground(broken)).rejects.toThrow();
});
