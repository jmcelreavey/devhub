import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, execFileSync } from "node:child_process";

/**
 * Filesystem helpers for building and installing the local DevHub Electron
 * launcher (see `electron-wrapper/`). Kept separate from the route so the
 * path/placement logic stays unit-testable.
 */

export interface BuiltArtifact {
  kind: "app" | "appimage";
  src: string;
}

/** The devhub repo root — the dashboard runs with `cwd` set to `dashboard/`. */
export function repoRoot(): string {
  return path.join(process.cwd(), "..");
}

/** The `electron-wrapper/` dir. */
function electronWrapperDir(): string {
  return path.join(repoRoot(), "electron-wrapper");
}

/** electron-builder output dir for the wrapper. */
export function releaseDir(): string {
  return path.join(electronWrapperDir(), "release");
}

/** Whether the wrapper's node_modules are present (else we must `npm install` first). */
export function wrapperDepsInstalled(): boolean {
  return fs.existsSync(path.join(electronWrapperDir(), "node_modules"));
}

/**
 * Find the built artifact for the current platform in `release/`.
 * macOS produces an unpacked `mac-arm64/DevHub.app`; Linux produces `*.AppImage`.
 */
export function resolveBuiltArtifact(
  release: string,
  platform: NodeJS.Platform,
): BuiltArtifact | null {
  if (platform === "darwin") {
    const app = path.join(release, "mac-arm64", "DevHub.app");
    return fs.existsSync(app) ? { kind: "app", src: app } : null;
  }
  if (!fs.existsSync(release)) return null;
  const appImage = fs
    .readdirSync(release)
    .find((f) => f.toLowerCase().endsWith(".appimage"));
  return appImage ? { kind: "appimage", src: path.join(release, appImage) } : null;
}

/** The PNG used as the app icon (also what electron-builder packages). */
export function defaultAppIcon(): string {
  return path.join(repoRoot(), "dashboard", "public", "icon-512.png");
}

/**
 * Install the app icon into the freedesktop hicolor theme and return the bare
 * icon name (for use as `Icon=devhub`), or "" if no source icon exists.
 *
 * WSLg's Start Menu integration converts `.desktop` icons to Windows `.lnk`
 * icons by resolving the icon name against the theme dirs. An absolute path in
 * `Icon=` is unreliable here (it falls back to the generic distro/Tux logo), so
 * we place the PNG under `icons/hicolor/<size>x<size>/apps/devhub.png` and
 * reference it by name. The source is a single large PNG; WSLg rescales when
 * converting, so the dir size is nominal — we register it at the common sizes
 * WSLg probes rather than resizing (keeps this dependency-free and sync).
 */
function installAppIcon(homeDir: string, iconSource: string): string {
  if (!fs.existsSync(iconSource)) return "";
  const hicolor = path.join(homeDir, ".local", "share", "icons", "hicolor");
  for (const size of ["512x512", "256x256", "128x128", "48x48"]) {
    const appsDir = path.join(hicolor, size, "apps");
    fs.mkdirSync(appsDir, { recursive: true });
    fs.copyFileSync(iconSource, path.join(appsDir, "devhub.png"));
  }
  return "devhub";
}

/**
 * Place a built artifact on the machine without sudo, and return the install path.
 * - macOS: replace `/Applications/DevHub.app`.
 * - Linux: copy the AppImage to `~/Applications`, mark it executable, install the
 *   icon, and write a `.desktop` launcher into `~/.local/share/applications`.
 */
export function placeArtifact(
  artifact: BuiltArtifact,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
  iconSource: string = defaultAppIcon(),
): string {
  if (artifact.kind === "app") {
    const dest = path.join("/Applications", "DevHub.app");
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(artifact.src, dest, { recursive: true });
    return dest;
  }

  const appsDir = path.join(homeDir, "Applications");
  fs.mkdirSync(appsDir, { recursive: true });
  const dest = path.join(appsDir, "DevHub.AppImage");
  fs.copyFileSync(artifact.src, dest);
  fs.chmodSync(dest, 0o755);

  // Best-effort desktop launcher so DevHub shows up in app menus / WSLg.
  if (platform === "linux") {
    const launcherDir = path.join(homeDir, ".local", "share", "applications");
    fs.mkdirSync(launcherDir, { recursive: true });
    const iconName = installAppIcon(homeDir, iconSource);
    const desktop = [
      "[Desktop Entry]",
      "Name=DevHub",
      "Comment=Local DevHub launcher",
      `Exec=${dest} %u`,
      ...(iconName ? [`Icon=${iconName}`] : []),
      "Terminal=false",
      "Type=Application",
      "Categories=Development;IDE;",
      "NoDisplay=false",
      // Match the Electron window class so the running window groups under this
      // launcher's icon in the taskbar instead of a generic entry.
      "StartupWMClass=DevHub",
      "",
    ].join("\n");
    const desktopPath = path.join(launcherDir, "devhub.desktop");
    fs.writeFileSync(desktopPath, desktop, "utf-8");
    fs.chmodSync(desktopPath, 0o644);

    bestEffortUpdateDesktopDatabase(launcherDir);
    bestEffortUpdateIconCache(homeDir);
  }

  return dest;
}

function bestEffortUpdateDesktopDatabase(launcherDir: string): void {
  try {
    execSync("update-desktop-database -q " + JSON.stringify(launcherDir), {
      stdio: "ignore",
      timeout: 5000,
    });
  } catch {
    // Non-critical: the .desktop file is still on disk; most DEs/WSLg will
    // pick it up on next login or after a short delay.
  }
}

function bestEffortUpdateIconCache(homeDir: string): void {
  try {
    const iconDir = path.join(homeDir, ".local", "share", "icons", "hicolor");
    execFileSync("gtk-update-icon-cache", ["-q", "-t", "-f", iconDir], {
      stdio: "ignore",
      timeout: 10000,
    });
  } catch {
    // Non-critical: icons usually resolve without an explicit cache.
  }
}
