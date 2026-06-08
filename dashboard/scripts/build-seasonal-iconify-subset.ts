/**
 * Rebuild `lib/seasonal-iconify-subset.json` from @iconify-json/fluent-emoji-flat.
 * Keeps client bundle small (~17KB) instead of shipping the full ~8MB icon set.
 *
 * Run from dashboard/: `npx tsx scripts/build-seasonal-iconify-subset.ts`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import iconsJson from "@iconify-json/fluent-emoji-flat/icons.json";
import { SEASONAL_MARK_ICONIFY } from "../lib/seasonal-mark-icon-map";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const wanted = new Set(
  Object.values(SEASONAL_MARK_ICONIFY).map((full) => {
    const [, slug] = full.split(":");
    if (!slug) throw new Error(`Bad icon key: ${full}`);
    return slug;
  }),
);

const icons: Record<string, { body: string }> = {};
for (const slug of wanted) {
  const icon = iconsJson.icons[slug as keyof typeof iconsJson.icons];
  if (!icon) throw new Error(`Missing fluent-emoji-flat icon: ${slug}`);
  icons[slug] = icon;
}

const subset = {
  prefix: iconsJson.prefix,
  icons,
  width: iconsJson.width,
  height: iconsJson.height,
};

const out = path.join(root, "lib", "seasonal-iconify-subset.json");
fs.writeFileSync(out, JSON.stringify(subset));
console.log(`Wrote ${out} (${fs.statSync(out).size} bytes, ${wanted.size} icons)`);
