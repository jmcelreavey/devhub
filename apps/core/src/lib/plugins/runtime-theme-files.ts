import type { ThemeAssetKind } from "../../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";

/** Only inert image/font/audio formats can be served from the dashboard origin. */
export function verifyThemeAsset(bytes: Buffer, kind: ThemeAssetKind): void {
  if (bytes.length > (kind === "html" ? 256 * 1024 : 4 * 1024 * 1024)) throw new Error("Theme asset is too large");
  if (kind === "html") { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return; }
  if (kind === "font" && bytes.length >= 48 && bytes.subarray(0, 4).toString("ascii") === "wOF2") return;
  if (kind === "audio" && bytes.length >= 44 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE") return;
  if (kind === "image") {
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      let offset = 8;
      while (offset + 12 <= bytes.length) {
        const size = bytes.readUInt32BE(offset);
        const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
        if (size > bytes.length - offset - 12 || type === "acTL") throw new Error("Invalid or animated theme image");
        if (type === "IEND") return;
        offset += size + 12;
      }
    }
    if (bytes.length >= 20 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
      let offset = 12;
      while (offset + 8 <= bytes.length) {
        const type = bytes.subarray(offset, offset + 4).toString("ascii");
        const size = bytes.readUInt32LE(offset + 4);
        if (size > bytes.length - offset - 8 || ["ANIM", "ANMF"].includes(type) || (type === "VP8X" && (bytes[offset + 8] & 2))) throw new Error("Invalid or animated theme image");
        offset += 8 + size + (size % 2);
      }
      if (offset === bytes.length) return;
    }
  }
  throw new Error("Invalid theme asset format");
}
