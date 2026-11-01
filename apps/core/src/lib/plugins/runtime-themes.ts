import fs from "node:fs";
import { PluginApiError, type PluginContext } from "./context";
import { loadRuntime, runtimeCatalog } from "./runtime-host";
import { runtimeFile } from "./runtime-files";
import { rows } from "./views";
import { publicRuntimeThemeSchema, runtimeThemeCatalogSchema, runtimeThemeAssets, type PublicRuntimeTheme } from "../../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";

/** Ambiguous preset IDs disappear together; registry order cannot choose a new owner. */
export function runtimeThemeCatalog(ctx: PluginContext): PublicRuntimeTheme[] {
  const themes = runtimeCatalog(ctx).flatMap(plugin => (plugin.runtime.capabilities?.themes ?? []).map(theme => publicRuntimeThemeSchema.parse({ ...theme, plugin: plugin.name, revision: plugin.revision })));
  const counts = new Map<string, number>();
  for (const theme of themes) counts.set(theme.id, (counts.get(theme.id) ?? 0) + 1);
  return themes.filter(theme => counts.get(theme.id) === 1);
}

export function runtimeThemeSnapshot(ctx: PluginContext) {
  return runtimeThemeCatalogSchema.parse({ themes: runtimeThemeCatalog(ctx), managedPlugins: rows(ctx).filter(plugin => plugin.managed && /^[a-z0-9][a-z0-9_-]{0,62}$/.test(plugin.name)).map(plugin => plugin.name) });
}

export function runtimeThemeAsset(ctx: PluginContext, name: string, preset: string, revision: string, assetId: string) {
  const theme = runtimeThemeCatalog(ctx).find(theme => theme.plugin === name && theme.id === preset && theme.revision === revision);
  const declared = theme && runtimeThemeAssets(theme).find(candidate => candidate.id === assetId);
  if (!theme || !declared) throw new PluginApiError(404, "THEME_UNAVAILABLE", "This reviewed theme asset is unavailable.");
  const plugin = loadRuntime(ctx, name);
  if (plugin.revision !== revision) throw new PluginApiError(409, "THEME_CHANGED", "The theme changed. Refresh before loading it.");
  const bytes = fs.readFileSync(runtimeFile(plugin.root, declared.asset.path));
  const mime = declared.kind === "image" ? (declared.asset.path.endsWith(".png") ? "image/png" : "image/webp") : declared.kind === "font" ? "font/woff2" : "audio/wav";
  return { bytes, mime, kind: declared.kind };
}
