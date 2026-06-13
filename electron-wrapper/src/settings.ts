import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LauncherSettings {
  killDashboardOnClose: boolean;
  killChamberOnClose: boolean;
  killOpenCodeOnClose: boolean;
  /** Last window bounds — restored on next launch. */
  windowBounds?: WindowBounds;
  windowMaximized?: boolean;
}

const DEFAULTS: LauncherSettings = {
  killDashboardOnClose: true,
  killChamberOnClose: true,
  killOpenCodeOnClose: true,
};

function settingsPath(): string {
  return path.join(app.getPath("userData"), "launcher-settings.json");
}

export function loadSettings(): LauncherSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      killDashboardOnClose: parsed.killDashboardOnClose ?? DEFAULTS.killDashboardOnClose,
      killChamberOnClose: parsed.killChamberOnClose ?? DEFAULTS.killChamberOnClose,
      killOpenCodeOnClose: parsed.killOpenCodeOnClose ?? DEFAULTS.killOpenCodeOnClose,
      windowBounds: parsed.windowBounds,
      windowMaximized: parsed.windowMaximized,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: LauncherSettings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}
