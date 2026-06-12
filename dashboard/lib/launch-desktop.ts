import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import http from "node:http";

export type LaunchResult =
  | { ok: true; path?: string; openUrl?: string; serverUrl?: string; focusedExisting?: boolean }
  | { error: string; detail?: string; hint?: string; releasesUrl?: string; status: number };

export interface LaunchConfig {
  appName: string;
  macAppName: string;
  linuxBinName: string;
  releasesUrl: string;
  releasesApiUrl?: string;
  webFallbackUrl?: string;
  envInject?: { key: string; valueFn: () => string };
}

const HOME = process.env.HOME ?? os.homedir() ?? "";

function buildPaths(macName: string, linuxBin: string) {
  const mac = [`/Applications/${macName}.app`, `${HOME}/Applications/${macName}.app`];
  const linux = [
    path.join(HOME, "Applications", `${macName}.AppImage`),
    path.join(HOME, ".local", "bin", linuxBin),
    `/usr/local/bin/${linuxBin}`,
    `/usr/bin/${linuxBin}`,
    path.join("/opt", macName, `${macName}.AppImage`),
  ];
  return { mac, linux };
}

function findBinary(appPath: string): string | null {
  if (process.platform !== "darwin") return appPath;
  const macosDir = path.join(appPath, "Contents", "MacOS");
  try {
    const entries = fs.readdirSync(macosDir);
    return entries[0] ? path.join(macosDir, entries[0]) : null;
  } catch {
    return null;
  }
}

export function findInstalledApp(macName: string, linuxBin: string): string | null {
  const { mac, linux } = buildPaths(macName, linuxBin);
  for (const p of (process.platform === "darwin" ? mac : linux)) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * True when the desktop app already has a running instance (macOS). Every
 * launch used to spawn a brand-new process — each one its own Electron tree
 * eating RAM, and a fresh instance can bind a different port / miss the
 * injected server URL. If it's already up, we just bring it to front.
 */
function isAppRunning(macAppName: string): boolean {
  if (process.platform !== "darwin") return false;
  const res = spawnSync("pgrep", ["-f", `${macAppName}.app/Contents/MacOS`], {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 3_000,
  });
  return res.status === 0;
}

function focusExistingApp(macAppName: string): void {
  spawn("open", ["-a", macAppName], { detached: true, stdio: "ignore" }).unref();
}

function getLinuxArch(): "x86_64" | "aarch64" {
  const arch = os.arch();
  return arch === "arm64" || arch === "aarch64" ? "aarch64" : "x86_64";
}

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "devhub-launcher" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "devhub-launcher" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      const dir = path.dirname(dest);
      fs.mkdirSync(dir, { recursive: true });
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
      file.on("error", reject);
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function installFromReleases(
  config: LaunchConfig,
): Promise<{ ok: true; path: string; serverUrl?: string } | { error: string; detail?: string; hint?: string; releasesUrl?: string; status: number }> {
  if (!config.releasesApiUrl) {
    return {
      error: `${config.appName} Desktop is not installed.`,
      hint: `${config.appName} does not provide Linux builds. Download a macOS build from the releases page.`,
      releasesUrl: config.releasesUrl,
      status: 404,
    };
  }

  const arch = getLinuxArch();
  const appsDir = path.join(HOME, "Applications");
  const dest = path.join(appsDir, `${config.macAppName}.AppImage`);

  try {
    const release = await fetchJson<{ tag_name: string; assets: { name: string; browser_download_url: string }[] }>(config.releasesApiUrl);

    const assetPattern = new RegExp(`${config.macAppName}.*linux-${arch}\\.AppImage`, "i");
    const asset = release.assets.find((a) => assetPattern.test(a.name));
    if (!asset) {
      return {
        error: `${config.appName} Desktop is not installed.`,
        hint: `No Linux/${arch} build found in the latest release (${release.tag_name}). Check the releases page manually.`,
        releasesUrl: config.releasesUrl,
        status: 404,
      };
    }

    await downloadFile(asset.browser_download_url, dest);
    fs.chmodSync(dest, 0o755);

    const bin = findBinary(dest) ?? dest;

    spawn(bin, [], {
      detached: true,
      stdio: "ignore",
      env: config.envInject
        ? { ...process.env, [config.envInject.key]: config.envInject.valueFn() }
        : undefined,
    }).unref();

    const serverUrl = config.envInject?.valueFn();
    return { ok: true as const, path: dest, ...(serverUrl ? { serverUrl } : {}) };
  } catch (err) {
    return {
      error: `Failed to install ${config.appName} Desktop`,
      detail: err instanceof Error ? err.message : String(err),
      releasesUrl: config.releasesUrl,
      status: 500,
    };
  }
}

export async function launchDesktopApp(config: LaunchConfig): Promise<LaunchResult> {
  const installed = findInstalledApp(config.macAppName, config.linuxBinName);
  if (!installed) {
    if (process.platform === "darwin") {
      return {
        error: `${config.appName} Desktop is not installed.`,
        hint: `Download it from the ${config.appName} releases page.`,
        releasesUrl: config.releasesUrl,
        status: 404,
      };
    }

    if (config.releasesApiUrl) {
      return installFromReleases(config);
    }

    if (config.webFallbackUrl) {
      return { ok: true as const, openUrl: config.webFallbackUrl };
    }

    return {
      error: `${config.appName} Desktop is not installed.`,
      hint: `Download it from the ${config.appName} releases page.`,
      releasesUrl: config.releasesUrl,
      status: 404,
    };
  }

  const binary = findBinary(installed);
  const bin = binary ?? installed;

  try {
    if (process.platform === "darwin" && isAppRunning(config.macAppName)) {
      // Already running — focus it instead of stacking another instance.
      focusExistingApp(config.macAppName);
      const serverUrl = config.envInject?.valueFn();
      return { ok: true as const, path: installed, focusedExisting: true, ...(serverUrl ? { serverUrl } : {}) };
    }
    if (process.platform === "darwin") {
      if (binary && !config.envInject) {
        spawn("open", [installed], { detached: true, stdio: "ignore" }).unref();
      } else {
        spawn(bin, [], {
          detached: true,
          stdio: "ignore",
          env: config.envInject
            ? { ...process.env, [config.envInject.key]: config.envInject.valueFn() }
            : process.env,
        }).unref();
      }
    } else {
      spawn(bin, [], {
        detached: true,
        stdio: "ignore",
        env: config.envInject
          ? { ...process.env, [config.envInject.key]: config.envInject.valueFn() }
          : undefined,
      }).unref();
    }

    const serverUrl = config.envInject?.valueFn();
    return { ok: true as const, path: installed, ...(serverUrl ? { serverUrl } : {}) };
  } catch (err) {
    return {
      error: `Failed to launch ${config.appName} Desktop`,
      detail: err instanceof Error ? err.message : String(err),
      status: 500,
    };
  }
}
