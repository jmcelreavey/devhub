import fs from "node:fs";
import path from "node:path";

export function resolvePluginRegistryPath(home: string, env: NodeJS.ProcessEnv): {
  registryPath: string;
  registryDiagnostic: string | null;
} {
  if (env.WSL_DISTRO_NAME) {
    const candidates = [home, env.DEVHUB_CONFIG_DIR, env.DEVHUB_PLUGIN_HOME, env.DEVHUB_PLUGIN_TARGET_HOME, env.DEVHUB_APP_DATA, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME];
    for (const candidate of candidates) {
      if (!candidate?.trim()) continue;
      if (!path.posix.isAbsolute(candidate) || candidate.includes("\\") || /^\/mnt\/[a-z](?:\/|$)/i.test(candidate)) throw new Error("Plugin paths must use the Linux filesystem inside the DevHub WSL distro.");
      let ancestor = candidate;
      while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
      if (/^\/mnt\/[a-z](?:\/|$)/i.test(fs.realpathSync(ancestor))) throw new Error("Plugin paths must stay inside the DevHub WSL distro.");
    }
  }
  const explicit = env.DEVHUB_CONFIG_DIR?.trim();
  if (explicit) return { registryPath: path.join(path.resolve(explicit), "plugins.json"), registryDiagnostic: null };

  const legacy = path.join(home, ".config", "devhub", "plugins.json");
  const xdgRoot = env.XDG_CONFIG_HOME?.trim();
  const xdgFile = xdgRoot ? path.join(path.resolve(xdgRoot), "devhub", "plugins.json") : null;
  const legacyExists = fs.existsSync(legacy);
  const xdgExists = Boolean(xdgFile && fs.existsSync(xdgFile));
  return {
    registryPath: legacyExists || !xdgFile ? legacy : xdgFile,
    registryDiagnostic: legacyExists && xdgExists
      ? "DevHub is using ~/.config/devhub/plugins.json and leaving the XDG registry unread."
      : null,
  };
}
