import fs from "node:fs";
import type { NextRequest } from "next/server";
import { assertPluginManagement, pluginJson, serverPluginContext } from "@/lib/plugins/http";
import { runtimeCatalog } from "@/lib/plugins/runtime-host";
import { runtimeFile } from "@/lib/plugins/runtime-files";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  const brands = runtimeCatalog(serverPluginContext()).flatMap((plugin) => {
    const brand = plugin.runtime.branding;
    if (!brand) return [];
    const data = (file: string, mime: string) => `data:${mime};base64,${fs.readFileSync(runtimeFile(plugin.root, file)).toString("base64")}`;
    return [{ name: plugin.name, label: brand.label, dark: brand.dark, light: brand.light,
      logo: brand.logo ? data(brand.logo.path, brand.logo.path.endsWith(".png") ? "image/png" : "image/webp") : null,
      font: brand.font ? data(brand.font.path, "font/woff2") : null,
    }];
  });
  return pluginJson(brands);
}
