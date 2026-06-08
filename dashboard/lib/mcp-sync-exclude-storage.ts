import { readExcludedIdsFromStorage, writeExcludedIdsToStorage } from "./sync-exclude-storage";

/** Browser key for MCP servers excluded from Sync / Collect MCP (dashboard UI only). */
export const MCP_SYNC_EXCLUDE_STORAGE_KEY = "devhub:mcp-sync-exclude";

/** Same-tab + other-tab listeners use this event name after `writeExcludedMcpIdsToStorage`. */
export const MCP_SYNC_EXCLUDE_CHANGED_EVENT = "devhub-mcp-sync-exclude-change";

export function readExcludedMcpIdsFromStorage(): string[] {
  return readExcludedIdsFromStorage(MCP_SYNC_EXCLUDE_STORAGE_KEY);
}

export function writeExcludedMcpIdsToStorage(ids: string[]): void {
  writeExcludedIdsToStorage(MCP_SYNC_EXCLUDE_STORAGE_KEY, MCP_SYNC_EXCLUDE_CHANGED_EVENT, ids);
}
