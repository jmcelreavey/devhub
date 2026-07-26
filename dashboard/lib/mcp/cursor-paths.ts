import path from "node:path";

/** Cursor's user-level MCP config (where IDE-enabled servers such as agentmemory live). */
export function cursorMcpConfigPath(home: string): string {
  return path.join(home, ".cursor", "mcp.json");
}

/** Legacy path DevHub used before Cursor standardized on ~/.cursor/mcp.json. */
export function cursorMcpLegacyConfigPath(home: string): string {
  return path.join(home, ".config", "cursor", "mcp.json");
}

/** Read paths for Cursor MCP: primary first, then legacy (for import / merge). */
export function cursorMcpReadPaths(home: string): string[] {
  return [cursorMcpConfigPath(home), cursorMcpLegacyConfigPath(home)];
}
