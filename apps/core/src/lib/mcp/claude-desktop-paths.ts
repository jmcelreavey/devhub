import path from "node:path";

/**
 * The Claude desktop app's MCP config.
 *
 * Distinct from `~/.claude.json`, which belongs to the Claude Code CLI — the
 * desktop app never reads that file. A server synced only to the `claude`
 * target is therefore invisible to the app, and to Cowork sessions, which run
 * in Anthropic's cloud sandbox and reach local MCP servers by proxying the
 * desktop app's list.
 */
export function claudeDesktopMcpConfigPath(
  home: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "Claude", "claude_desktop_config.json");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
}
