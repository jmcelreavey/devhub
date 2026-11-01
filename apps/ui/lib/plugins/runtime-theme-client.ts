import { z } from "zod";
import { publicRuntimeThemeSchema, runtimeThemeCatalogSchema, runtimeThemeAssetUrl, type PublicRuntimeTheme } from "../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";
import { hollowBrandAssetUrl } from "../themes/brand-mark";

export const RUNTIME_THEMES_EVENT = "devhub:runtime-themes";
const catalogSchema = z.array(publicRuntimeThemeSchema).max(512);
const empty: PublicRuntimeTheme[] = [];
let current: PublicRuntimeTheme[] | undefined;
let serialised = "";
let managedPlugins: string[] = [];

declare global {
  interface Window { __DEVHUB_RUNTIME_THEMES__?: unknown; __DEVHUB_MANAGED_THEME_PLUGINS__?: unknown }
}

export function parseRuntimeThemes(value: unknown): PublicRuntimeTheme[] {
  const themes = catalogSchema.parse(value);
  if (new Set(themes.map(theme => theme.id)).size !== themes.length) throw new Error("Ambiguous runtime themes");
  return themes;
}

export function getRuntimeThemes(): PublicRuntimeTheme[] {
  if (typeof window === "undefined") return empty;
  if (!current) {
    const parsed = runtimeThemeCatalogSchema.safeParse({ themes: window.__DEVHUB_RUNTIME_THEMES__ ?? [], managedPlugins: window.__DEVHUB_MANAGED_THEME_PLUGINS__ ?? [] });
    current = parsed.success ? parsed.data.themes : empty;
    managedPlugins = parsed.success ? parsed.data.managedPlugins : [];
    serialised = JSON.stringify({ themes: current, managedPlugins });
  }
  return current;
}

export function getManagedThemePlugins(): string[] { getRuntimeThemes(); return managedPlugins; }

export function replaceRuntimeThemes(themes: PublicRuntimeTheme[], managed: string[] = []): void {
  const next = runtimeThemeCatalogSchema.parse({ themes: parseRuntimeThemes(themes), managedPlugins: managed });
  const value = JSON.stringify(next);
  if (value === serialised) return;
  current = next.themes;
  managedPlugins = next.managedPlugins;
  serialised = value;
  window.dispatchEvent(new Event(RUNTIME_THEMES_EVENT));
}

export function subscribeRuntimeThemes(onChange: () => void): () => void {
  window.addEventListener(RUNTIME_THEMES_EVENT, onChange);
  return () => window.removeEventListener(RUNTIME_THEMES_EVENT, onChange);
}

export function runtimeThemeKey(theme: PublicRuntimeTheme): string { return `${theme.revision}:${theme.id}`; }

/** The selector and every declaration come from strict schemas, never plugin CSS. */
export function runtimeThemeCss(themes: PublicRuntimeTheme[]): string {
  return themes.map(theme => {
    const key = runtimeThemeKey(theme);
    const family = `runtime-${theme.id}-${theme.revision}`;
    const font = theme.font ? `@font-face{font-family:"${family}";src:url("${runtimeThemeAssetUrl(theme, "font")}") format("woff2");font-display:swap}` : "";
    return font + (["dark", "light"] as const).map(mode => {
      const colours = Object.entries(theme[mode]).map(([token, colour]) => `--${token}:${colour};`).join("");
      const hollowMark = hollowBrandAssetUrl(theme, mode);
      return `:root[data-runtime-theme="${key}"][data-theme-preset="${theme.id}"][data-theme="${mode}"]{${colours}${theme.font ? `--font-display:"${family}",sans-serif;` : ""}${hollowMark ? `--hollow-brand-image:url("${hollowMark}");` : ""}}`;
    }).join("");
  }).join("");
}

export function runtimeThemeBootstrap(themes: PublicRuntimeTheme[], managed: string[] = []): string {
  const literal = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `(function(){window.__DEVHUB_RUNTIME_THEMES__=${literal(themes)};window.__DEVHUB_MANAGED_THEME_PLUGINS__=${literal(managed)};try{var p=localStorage.getItem("devhub:theme-preset");var t=window.__DEVHUB_RUNTIME_THEMES__.find(function(t){return t.id===p;});if(t){document.documentElement.setAttribute("data-theme-preset",t.id);document.documentElement.setAttribute("data-runtime-theme",t.revision+":"+t.id);}}catch(e){}})();`;
}
