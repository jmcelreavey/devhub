import fs from "node:fs";
import path from "node:path";

/**
 * Shared OpenChamber theming helpers.
 *
 * DevHub no longer vendors @openchamber/web, so we can't patch the app's bundled
 * `index.html`. Instead we write into OpenChamber's own data directory
 * (`~/.config/openchamber`, or `OPENCHAMBER_DATA_DIR`), which the system-installed
 * version reads on startup:
 *   - custom themes → `<data-dir>/themes/*.json`
 *   - default theme selection → `<data-dir>/settings.json`
 *
 * This is version-independent and survives the developer's own upgrades, since
 * we never touch the OpenChamber install itself.
 *
 * Called from `scripts/postinstall.ts` after `npm install`.
 */

export type ThemeLog = (msg: string) => void;

/** OpenChamber's data dir — matches the resolution in @openchamber/web's server. */
function openChamberDataDir(): string {
  const override = process.env.OPENCHAMBER_DATA_DIR?.trim();
  if (override) return path.resolve(override);
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return home ? path.join(home, ".config", "openchamber") : "";
}

function themesSrcDir(dashboardDir: string): string {
  return path.join(dashboardDir, "config", "openchamber-themes");
}

function themesDestDir(): string {
  const dataDir = openChamberDataDir();
  return dataDir ? path.join(dataDir, "themes") : "";
}

function settingsFilePath(): string {
  const dataDir = openChamberDataDir();
  return dataDir ? path.join(dataDir, "settings.json") : "";
}

/** True when an OpenChamber data dir exists (i.e. OpenChamber has run on this machine). */
export function isOpenChamberInstalled(): boolean {
  const dir = openChamberDataDir();
  return Boolean(dir) && fs.existsSync(dir);
}

/** Copy every `*.json` theme from an arbitrary source dir into OpenChamber's themes dir. */
export function installOpenChamberThemesFrom(srcDir: string): number {
  const dest = themesDestDir();
  if (!fs.existsSync(srcDir) || !dest) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const f of fs.readdirSync(srcDir)) {
    if (!f.endsWith(".json")) continue;
    fs.copyFileSync(path.join(srcDir, f), path.join(dest, f));
    count++;
  }
  return count;
}

/**
 * Seed explicit dark/light theme ids (and the starting variant) into OpenChamber's
 * `settings.json`, non-destructively — an existing user choice is never overwritten.
 * Returns true when the file was written.
 */
export function setDefaultOpenChamberThemeIds(
  ids: { darkId?: string | null; lightId?: string | null; defaultVariant?: "dark" | "light" },
  log?: ThemeLog,
): boolean {
  const settingsPath = settingsFilePath();
  if (!settingsPath) return false;
  const { darkId, lightId } = ids;
  if (!darkId && !lightId) return false;

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      if (parsed && typeof parsed === "object") settings = parsed as Record<string, unknown>;
    } catch {
      log?.("OpenChamber settings.json unreadable; skipping default-theme seed");
      return false;
    }
  }

  let changed = false;
  const setIfAbsent = (key: string, value: string): void => {
    if (typeof settings[key] === "string" && (settings[key] as string).length > 0) return;
    settings[key] = value;
    changed = true;
  };

  if (darkId) setIfAbsent("darkThemeId", darkId);
  if (lightId) setIfAbsent("lightThemeId", lightId);
  const variant = ids.defaultVariant ?? "dark";
  setIfAbsent("themeVariant", variant);
  const startId = variant === "light" ? lightId ?? darkId : darkId ?? lightId;
  if (startId) setIfAbsent("themeId", startId);

  if (!changed) return false;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  log?.("OpenChamber default theme seeded in settings.json");
  return true;
}

/** Read theme `metadata.id` (keyed by variant) from every .json in the source dir. */
export function discoverThemeIds(dashboardDir: string): { dark: string | null; light: string | null } {
  const src = themesSrcDir(dashboardDir);
  if (!fs.existsSync(src)) return { dark: null, light: null };
  const ids: Record<string, string> = {};
  for (const f of fs.readdirSync(src)) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(src, f), "utf8"));
      const id = raw?.metadata?.id;
      const variant = raw?.metadata?.variant;
      if (id && (variant === "dark" || variant === "light")) {
        ids[variant] = id;
      }
    } catch {
      // skip malformed json
    }
  }
  return { dark: ids.dark ?? null, light: ids.light ?? null };
}

/** Copy all theme .json files into the user's OpenChamber themes directory. Returns count copied. */
export function installOpenChamberThemes(dashboardDir: string, log?: ThemeLog): number {
  const src = themesSrcDir(dashboardDir);
  const dest = themesDestDir();
  if (!fs.existsSync(src) || !dest) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const f of fs.readdirSync(src)) {
    if (!f.endsWith(".json")) continue;
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
    count++;
  }
  if (count > 0) log?.(`OpenChamber themes installed (${count})`);
  return count;
}

/**
 * Seed DevHub's default theme into OpenChamber's `settings.json`.
 *
 * Non-destructive: only sets a key the user hasn't already chosen, so an
 * existing theme selection is never overridden. Returns true when the file was
 * written.
 */
export function setDefaultOpenChamberTheme(dashboardDir: string, log?: ThemeLog): boolean {
  const { dark, light } = discoverThemeIds(dashboardDir);
  // Default to dark on first run, matching the previous DevHub behaviour.
  return setDefaultOpenChamberThemeIds({ darkId: dark, lightId: light, defaultVariant: "dark" }, log);
}

/** Install theme assets and seed the default-theme selection. */
export function applyOpenChamberTheme(dashboardDir: string, log?: ThemeLog): void {
  installOpenChamberThemes(dashboardDir, log);
  setDefaultOpenChamberTheme(dashboardDir, log);
}
