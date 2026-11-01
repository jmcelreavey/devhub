import { runtimeThemeAssets, runtimeThemeAssetUrl, type PublicRuntimeTheme } from "../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";

/** The opaque scene receives image bytes, never an authenticated dashboard URL. */
export async function runtimeThemeImages(theme: PublicRuntimeTheme, signal: AbortSignal): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
  const cache = new Map<string, string>();
  let total = 0;
  let encoded = 0;
  function assign(id: string, data: string) {
    encoded += data.length;
    if (encoded > 24 * 1024 * 1024) throw new Error("Theme image payload is too large");
    images[id] = data;
  }
  for (const { id, asset } of runtimeThemeAssets(theme).filter(asset => asset.kind === "image" && !asset.id.startsWith("static:"))) {
    const previous = cache.get(asset.path);
    if (previous) { assign(id, previous); continue; }
    const response = await fetch(runtimeThemeAssetUrl(theme, id), { signal, cache: "no-store" });
    const mime = response.headers.get("content-type");
    if (!response.ok || (mime !== "image/png" && mime !== "image/webp")) throw new Error("Theme image unavailable");
    const bytes = new Uint8Array(await response.arrayBuffer());
    total += bytes.byteLength;
    if (bytes.byteLength > 4 * 1024 * 1024 || total > 16 * 1024 * 1024) throw new Error("Theme images are too large");
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    const data = `data:${mime};base64,${btoa(binary)}`;
    assign(id, data);
    cache.set(asset.path, data);
  }
  return images;
}
