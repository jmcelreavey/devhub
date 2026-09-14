/**
 * Tool groups for `DEVHUB_MCP_TOOLSETS`.
 *
 * Every tool definition is loaded into a harness's context on every turn, and
 * this server has well over a hundred. A harness that only needs a few groups
 * can say so: `DEVHUB_MCP_TOOLSETS=notes,tasks,agents,terminal`. Unset or `all`
 * registers everything.
 */
export interface ToolsetSelection {
  /** Groups to register, in registry order. */
  names: string[];
  /** Requested names that do not exist — reported, not fatal. */
  unknown: string[];
}

export function selectToolsets(raw: string | undefined, available: readonly string[]): ToolsetSelection {
  const requested = (raw ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (requested.length === 0 || requested.includes("all")) return { names: [...available], unknown: [] };
  return {
    names: available.filter((name) => requested.includes(name)),
    unknown: requested.filter((name) => !available.includes(name)),
  };
}
