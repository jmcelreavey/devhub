/**
 * Tier-3 branding materialiser.
 *
 * Reads the `branding` block of the first enabled plugin that declares one and writes
 * machine-local generated files the rest of the app consumes:
 *
 *   - `dashboard/app/plugin-branding.generated.css`  — palette blocks + @font-face
 *   - `dashboard/lib/plugin-branding.generated.ts`   — presets, default preset/mode, logo
 *   - `dashboard/public/fonts-plugin/*`              — copied font files
 *   - `dashboard/public/plugin-brand-logo.*`         — sidebar/boot logo
 *   - `dashboard/public/plugin-electron-icon.png`    — Electron app icon
 *   - the user's OpenChamber data dir                — themes + seeded default (if installed)
 *
 * The two generated source files are committed as *empty baselines* so a fresh clone and
 * CI build work without running sync; when a branding plugin is active we rewrite them and
 * `git update-index --skip-worktree` so the local whitelabel never shows as repo churn.
 * Copied public assets are git-ignored via committed `dashboard/.gitignore` rules.
 *
 * Design goals: KISS (a plugin authors its own palette CSS — we just relocate + concatenate),
 * DRY (one source of truth: the plugin's `branding` block), and reusable (any plugin can
 * whitelabel; nothing here is BI-specific).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { listEnabledPlugins } from "./registry";
import type { BrandingContribution, RegisteredPlugin } from "./types";
import {
  installOpenChamberThemesFrom,
  setDefaultOpenChamberThemeIds,
  isOpenChamberInstalled,
} from "../openchamber-theme";

const GEN_CSS_REL = "app/plugin-branding.generated.css";
const GEN_TS_REL = "lib/plugin-branding.generated.ts";
const FONTS_DIR_REL = "public/fonts-plugin";
const LOGO_STEM_REL = "public/plugin-brand-logo";
const ELECTRON_ICON_REL = "public/plugin-electron-icon.png";

const EMPTY_CSS = `/* GENERATED — machine-local plugin branding palette + @font-face.
   Rewritten by lib/plugins/branding.ts (sync_plugins) from the active branding plugin,
   then git update-index --skip-worktree so local whitelabel state is not committed.
   Committed baseline is intentionally empty (no branding plugin). Do not edit by hand. */
`;

function emptyTs(): string {
  return `/**
 * GENERATED — machine-local plugin branding.
 *
 * This file is rewritten by \`lib/plugins/branding.ts\` (run via \`sync_plugins\`) from the
 * \`branding\` block of whichever enabled plugin declares one, then marked
 * \`git update-index --skip-worktree\` so local whitelabel state never shows as repo churn.
 *
 * The committed version below is the *empty* baseline (no branding plugin) so a fresh
 * clone, typecheck and CI build all work without running sync first. Do not edit by hand.
 */
import type { ThemePresetMeta } from "./theme-presets-types";

export interface PluginBrandLogo {
  /** Public URL of the brand image, e.g. "/plugin-brand-logo.svg?v=1". */
  src: string;
  /** Accessible label, e.g. "BI". */
  label: string;
}

/** Extra theme presets contributed by the active branding plugin. */
export const PLUGIN_THEME_PRESETS: ThemePresetMeta[] = [];

/** Preset id seeded as the default, or null to keep the core default. */
export const PLUGIN_DEFAULT_PRESET: string | null = null;

/** Default colour mode seeded on first run, or null to keep the core default. */
export const PLUGIN_DEFAULT_MODE: "dark" | "light" | "system" | null = null;

/** Default sidebar/boot brand mark, or null to keep the core DevHub bottle. */
export const PLUGIN_BRAND_LOGO: PluginBrandLogo | null = null;
`;
}

interface PresetDescriptor {
  id: string;
  label: string;
  description: string;
  darkSwatch: string;
  lightSwatch: string;
}

export interface BrandingPlan {
  /** The plugin whose branding is active, or null if none. */
  plugin: RegisteredPlugin | null;
  branding: BrandingContribution | null;
  errors: string[];
}

/** Pick the active branding plugin (first enabled plugin that declares `branding`). */
export function planBranding(plugins: RegisteredPlugin[]): BrandingPlan {
  const withBranding = plugins.filter((p) => p.manifest.branding);
  if (withBranding.length === 0) return { plugin: null, branding: null, errors: [] };
  const errors: string[] = [];
  if (withBranding.length > 1) {
    const names = withBranding.map((p) => p.name).join(", ");
    errors.push(
      `Multiple plugins declare branding (${names}); using "${withBranding[0].name}" (first enabled).`,
    );
  }
  return { plugin: withBranding[0], branding: withBranding[0].manifest.branding ?? null, errors };
}

function readJsonArray(file: string): PresetDescriptor[] {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(raw)) throw new Error("presets file must be a JSON array");
  return raw.map((p) => ({
    id: String(p.id),
    label: String(p.label),
    description: String(p.description ?? ""),
    darkSwatch: String(p.darkSwatch ?? "#111111"),
    lightSwatch: String(p.lightSwatch ?? "#ffffff"),
  }));
}

function shortHash(buf: Buffer): string {
  return crypto.createHash("sha1").update(buf).digest("hex").slice(0, 8);
}

function setSkipWorktree(repoRoot: string, rel: string, skip: boolean): void {
  spawnSync("git", ["-C", repoRoot, "update-index", skip ? "--skip-worktree" : "--no-skip-worktree", `dashboard/${rel}`], {
    encoding: "utf-8",
  });
}

/** Remove every asset the materialiser may have copied into `public/` (idempotent). */
function removeCopiedAssets(dash: string): void {
  fs.rmSync(path.join(dash, FONTS_DIR_REL), { recursive: true, force: true });
  fs.rmSync(path.join(dash, ELECTRON_ICON_REL), { force: true });
  const publicDir = path.join(dash, "public");
  if (fs.existsSync(publicDir)) {
    const stem = path.basename(LOGO_STEM_REL);
    for (const f of fs.readdirSync(publicDir)) {
      if (f.startsWith(`${stem}.`)) fs.rmSync(path.join(publicDir, f), { force: true });
    }
  }
}

export interface BrandingOptions {
  repoRoot: string;
  emit: (line: string) => void;
  dryRun?: boolean;
  /** Override the home dir used to resolve the plugin registry (tests). */
  home?: string;
}

/** Materialise (or clear) plugin branding. Returns 0 on success, 1 on error. */
export function materializeBranding(opts: BrandingOptions): number {
  const { repoRoot, emit, dryRun } = opts;
  const dash = path.join(repoRoot, "dashboard");
  const genCss = path.join(dash, GEN_CSS_REL);
  const genTs = path.join(dash, GEN_TS_REL);

  const plugins = listEnabledPlugins(opts.home, emit);
  const plan = planBranding(plugins);
  for (const e of plan.errors) emit(`branding: ${e}`);

  // --- No active branding: restore empty baselines + clear copied assets. ---
  if (!plan.plugin || !plan.branding) {
    if (dryRun) {
      emit("branding: no plugin declares branding (would restore empty baseline)");
      return 0;
    }
    fs.writeFileSync(genCss, EMPTY_CSS);
    fs.writeFileSync(genTs, emptyTs());
    setSkipWorktree(repoRoot, GEN_CSS_REL, false);
    setSkipWorktree(repoRoot, GEN_TS_REL, false);
    removeCopiedAssets(dash);
    emit("branding: none active (baseline restored)");
    return 0;
  }

  const plugin = plan.plugin;
  const b = plan.branding;
  const root = plugin.path;
  const resolve = (rel: string) => path.resolve(root, rel);

  // Validate sources up front.
  const errors: string[] = [];
  const mustExist = (rel: string | undefined, label: string): string | null => {
    if (!rel) return null;
    const abs = resolve(rel);
    if (!abs.startsWith(path.resolve(root) + path.sep)) {
      errors.push(`branding.${label} escapes plugin root: ${rel}`);
      return null;
    }
    if (!fs.existsSync(abs)) {
      errors.push(`branding.${label} missing: ${rel}`);
      return null;
    }
    return abs;
  };

  const themeCssAbs = mustExist(b.themeCss, "themeCss");
  const presetsAbs = mustExist(b.presets, "presets");
  const fontsAbs = mustExist(b.fonts, "fonts");
  const logoAbs = b.logo ? mustExist(b.logo.src, "logo.src") : null;
  const electronAbs = mustExist(b.electronIcon, "electronIcon");

  let presets: PresetDescriptor[] = [];
  if (presetsAbs) {
    try {
      presets = readJsonArray(presetsAbs);
    } catch (e) {
      errors.push(`branding.presets invalid: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (errors.length) {
    for (const e of errors) emit(`ERROR: ${e}`);
    return 1;
  }

  if (dryRun) {
    emit(`branding: would apply "${plugin.name}" (preset=${b.defaultPreset ?? "—"}, mode=${b.defaultMode ?? "—"})`);
    return 0;
  }

  // Clear any previously-copied assets first (e.g. a logo that changed extension).
  removeCopiedAssets(dash);

  // --- Fonts → public/fonts-plugin/ ---
  if (fontsAbs) {
    const dest = path.join(dash, FONTS_DIR_REL);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(fontsAbs)) {
      fs.copyFileSync(path.join(fontsAbs, f), path.join(dest, f));
    }
  }

  // --- Logo → public/plugin-brand-logo.<ext> ---
  let logoUrl: string | null = null;
  let logoLabel = "";
  if (logoAbs && b.logo) {
    const ext = path.extname(logoAbs) || ".svg";
    const destRel = `${LOGO_STEM_REL}${ext}`;
    const dest = path.join(dash, destRel);
    const buf = fs.readFileSync(logoAbs);
    fs.writeFileSync(dest, buf);
    logoUrl = `/${path.basename(destRel)}?v=${shortHash(buf)}`;
    logoLabel = b.logo.label ?? ""; // omit label → show the logo alone, no wordmark
  }

  // --- Electron icon → public/plugin-electron-icon.png ---
  if (electronAbs) {
    const dest = path.join(dash, ELECTRON_ICON_REL);
    fs.copyFileSync(electronAbs, dest);
  }

  // --- CSS: relocate the plugin's palette + @font-face verbatim. ---
  const cssHeader = `/* GENERATED from plugin "${plugin.name}" branding — do not edit (see lib/plugins/branding.ts). */\n`;
  const cssBody = themeCssAbs ? fs.readFileSync(themeCssAbs, "utf8") : "";
  fs.writeFileSync(genCss, cssHeader + cssBody + "\n");

  // --- TS: presets + seeded defaults + logo. ---
  const tsLogo = logoUrl
    ? `{ src: ${JSON.stringify(logoUrl)}, label: ${JSON.stringify(logoLabel)} }`
    : "null";
  const ts = `/* GENERATED from plugin "${plugin.name}" branding — do not edit (see lib/plugins/branding.ts). */
import type { ThemePresetMeta } from "./theme-presets-types";

export interface PluginBrandLogo {
  src: string;
  label: string;
}

export const PLUGIN_THEME_PRESETS: ThemePresetMeta[] = ${JSON.stringify(presets, null, 2)};

export const PLUGIN_DEFAULT_PRESET: string | null = ${JSON.stringify(b.defaultPreset ?? null)};

export const PLUGIN_DEFAULT_MODE: "dark" | "light" | "system" | null = ${JSON.stringify(b.defaultMode ?? null)};

export const PLUGIN_BRAND_LOGO: PluginBrandLogo | null = ${tsLogo};
`;
  fs.writeFileSync(genTs, ts);

  // Hide the local rewrite of the committed baselines from git status.
  setSkipWorktree(repoRoot, GEN_CSS_REL, true);
  setSkipWorktree(repoRoot, GEN_TS_REL, true);

  // --- OpenChamber (only if installed) ---
  if (b.openchamber?.themes) {
    if (isOpenChamberInstalled()) {
      const ocSrc = resolve(b.openchamber.themes);
      const n = installOpenChamberThemesFrom(ocSrc);
      setDefaultOpenChamberThemeIds(
        { darkId: b.openchamber.defaultDarkId, lightId: b.openchamber.defaultLightId, defaultVariant: b.defaultMode === "light" ? "light" : "dark" },
        emit,
      );
      if (n > 0) emit(`branding: OpenChamber themed (${n} theme${n === 1 ? "" : "s"})`);
    } else {
      emit("branding: OpenChamber not installed — skipping its theme");
    }
  }

  emit(`branding: applied "${plugin.name}" — preset "${b.defaultPreset ?? "(none)"}", mode "${b.defaultMode ?? "(core default)"}"`);
  return 0;
}
