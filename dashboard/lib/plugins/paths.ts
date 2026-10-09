/**
 * Where plugin settings and managed downloads live.
 *
 * An explicit DEVHUB_CONFIG_DIR is authoritative: resolution stops there and
 * never falls back into the personal registry. Callers that pass a home other
 * than the real home directory (the existing test injection) do not inherit
 * process.env unless they pass `env` themselves.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultAppDataDir } from "@/lib/desktop/runtime-paths";

export interface PluginPaths {
  home: string;
  /** True when DEVHUB_CONFIG_DIR selected the registry. */
  explicitConfig: boolean;
  configDir: string;
  registryPath: string;
  pluginHome: string;
  /** Skill/agent copies. DEVHUB_PLUGIN_TARGET_HOME isolates tests from ~/.claude. */
  targetHome: string;
  /** Set when legacy and XDG registries both exist and were not merged. */
  registryDiagnostic: string | null;
}

export interface ResolvePluginPathsOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function envFor(home: string, env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  if (env) return env;
  if (samePath(home, os.homedir())) return process.env;
  return { NODE_ENV: process.env.NODE_ENV };
}

function resolvePluginHome(env: NodeJS.ProcessEnv, home: string, configDir: string | null): string {
  const explicitHome = env.DEVHUB_PLUGIN_HOME?.trim();
  if (explicitHome) return path.resolve(explicitHome);
  if (configDir) return path.join(configDir, "plugins");
  const appData = env.DEVHUB_APP_DATA?.trim();
  if (appData) return path.join(path.resolve(appData), "plugins");
  const appRoot = env.WSL_DISTRO_NAME ? path.join(env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share"), "devhub") : defaultAppDataDir(home, env);
  return path.join(appRoot, "plugins");
}

function resolveTargetHome(env: NodeJS.ProcessEnv, home: string): string {
  const explicit = env.DEVHUB_PLUGIN_TARGET_HOME?.trim();
  return explicit ? path.resolve(explicit) : home;
}

export function resolvePluginPaths(opts: ResolvePluginPathsOptions = {}): PluginPaths {
  const home = opts.home ?? os.homedir();
  const env = envFor(home, opts.env);
  if (env.WSL_DISTRO_NAME) {
    const candidates = [home, env.DEVHUB_CONFIG_DIR, env.DEVHUB_PLUGIN_HOME, env.DEVHUB_PLUGIN_TARGET_HOME, env.DEVHUB_APP_DATA, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME];
    for (const candidate of candidates) {
      if (!candidate?.trim()) continue;
      if (!path.posix.isAbsolute(candidate) || candidate.includes("\\") || /^\/mnt\/[a-z](?:\/|$)/i.test(candidate)) throw new Error("Plugin paths must use the Linux filesystem inside the DevHub WSL distro.");
      // Catch existing parent aliases into a Windows mount as well.
      let ancestor = candidate;
      while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
      if (/^\/mnt\/[a-z](?:\/|$)/i.test(fs.realpathSync(ancestor))) throw new Error("Plugin paths must stay inside the DevHub WSL distro.");
    }
  }
  const explicit = env.DEVHUB_CONFIG_DIR?.trim();
  if (explicit) {
    const configDir = path.resolve(explicit);
    return {
      home,
      explicitConfig: true,
      configDir,
      registryPath: path.join(configDir, "plugins.json"),
      pluginHome: resolvePluginHome(env, home, configDir),
      targetHome: resolveTargetHome(env, home),
      registryDiagnostic: null,
    };
  }

  const legacy = path.join(home, ".config", "devhub", "plugins.json");
  const xdgRoot = env.XDG_CONFIG_HOME?.trim();
  const xdgFile = xdgRoot ? path.join(path.resolve(xdgRoot), "devhub", "plugins.json") : null;
  const legacyExists = fs.existsSync(legacy);
  const xdgExists = Boolean(xdgFile && fs.existsSync(xdgFile));
  const registryPath = legacyExists || !xdgFile ? legacy : xdgFile;
  return {
    home,
    explicitConfig: false,
    configDir: path.dirname(registryPath),
    registryPath,
    pluginHome: resolvePluginHome(env, home, null),
    targetHome: resolveTargetHome(env, home),
    registryDiagnostic: legacyExists && xdgExists
      ? "DevHub is using ~/.config/devhub/plugins.json and leaving the XDG registry unread."
      : null,
  };
}
