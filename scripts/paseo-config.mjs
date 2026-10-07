import fs from "node:fs";
import path from "node:path";

/** launchd does not inherit the app's shell PATH; Codex may only be bundled in the desktop app. */
export function codexCandidates(home) {
  return ["/Applications", path.join(home, "Applications")].flatMap(root =>
    ["ChatGPT.app", "Codex.app"].map(app => path.join(root, app, "Contents", "Resources", "codex")));
}

export function findBundledCodex(home) {
  return codexCandidates(home).find(file => {
    try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
  });
}

export function usesWebUiConfig(version) {
  const [major, minor] = version.split(".").map(Number);
  return major > 0 || minor >= 9;
}

export function paseoDaemonArgs(cli, home, version) {
  return usesWebUiConfig(version)
    ? [cli, "daemon", "run", "--home", home]
    : [cli, "daemon", "start", "--foreground", "--home", home, "--web-ui"];
}

/** Preserve settings edited in Paseo, especially custom providers, plugins and permission profiles. */
export function managedPaseoConfig(current, { port, passwordHash, cursor, codex, webUiConfig = false }) {
  const providers = { ...current.agents?.providers };
  if (cursor && !providers.cursor) providers.cursor = { extends: "acp", label: "Cursor", command: [cursor, "acp"] };
  if (codex && !providers.codex?.command) providers.codex = { ...providers.codex, command: [codex] };
  return {
    ...current,
    version: 1,
    daemon: {
      ...current.daemon,
      listen: `127.0.0.1:${port}`,
      relay: current.daemon?.relay ?? { enabled: false },
      cors: current.daemon?.cors ?? { allowedOrigins: [] },
      auth: { ...current.daemon?.auth, password: passwordHash },
      mcp: { injectIntoAgents: false, ...current.daemon?.mcp },
    },
    features: {
      ...current.features,
      ...(webUiConfig ? { webUi: { ...current.features?.webUi, enabled: true } } : {}),
      dictation: current.features?.dictation ?? { enabled: false },
      voiceMode: current.features?.voiceMode ?? { enabled: false },
    },
    agents: { ...current.agents, providers },
  };
}
