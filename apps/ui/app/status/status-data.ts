export interface ServiceInfo {
  name: string;
  active: boolean;
  uptime: string | null;
  /** Never set up. A stopped optional service is not a health warning. */
  optional?: boolean;
}

export interface ServicesStatus {
  agents: ServiceInfo;
}

export interface McpRuntimeEntry {
  name: string;
  command: string;
  fingerprint: string;
  binaryExists: boolean;
  runningCount: number;
  pids: number[];
}

export interface GitHint {
  severity: "warn" | "error";
  text: string;
  fix?: string;
}

export interface GitStatus {
  branch: string;
  dirtyCount: number;
  /** Dirty files that are NOT syncable content (notes/tasks/diagrams/docs). */
  otherDirtyCount?: number;
  /** Dirty syncable content (notes/tasks/diagrams/docs). */
  contentDirtyCount?: number;
  ahead: number;
  behind: number;
  conflictCount?: number;
  lastCommit: { hash: string; authoredAt: number; message: string };
  hints?: GitHint[];
}


export interface StatusSnapshot {
  services: ServicesStatus | null;
  mcp: McpRuntimeEntry[] | null;
  unavailable: string[];
}

export async function readCheck<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Status check failed (${response.status})`);
  return response.json() as Promise<T>;
}

/** A failed check stays unknown; it must never become an empty, healthy result. */
export async function fetchStatusRows(): Promise<StatusSnapshot> {
  const [services, mcp] = await Promise.allSettled([
    readCheck<ServicesStatus>("/api/status/services"),
    readCheck<{ servers: McpRuntimeEntry[] }>("/api/status/mcp"),
  ]);
  const unavailable: string[] = [];
  const serviceData = services.status === "fulfilled" && typeof services.value?.agents?.active === "boolean" ? services.value : null;
  if (!serviceData) unavailable.push("Agent connection");
  const mcpData = mcp.status === "fulfilled" && Array.isArray(mcp.value?.servers) ? mcp.value.servers : null;
  if (!mcpData) unavailable.push("MCP servers");
  return { services: serviceData, mcp: mcpData, unavailable };
}
