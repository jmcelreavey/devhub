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
  git: GitStatus | null;
  mcp: McpRuntimeEntry[] | null;
  lan: string[] | null;
  unavailable: string[];
  /** Checked, and skipped on purpose (no checkout, Git not installed). */
  notices: string[];
}

async function readCheck<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Status check failed (${response.status})`);
  return response.json() as Promise<T>;
}

/** A failed check stays unknown; it must never become an empty, healthy result. */
export async function fetchStatusRows(): Promise<StatusSnapshot> {
  const [services, git, mcp, lan] = await Promise.allSettled([
    readCheck<ServicesStatus>("/api/status/services"),
    readCheck<GitStatus>("/api/status/git"),
    readCheck<{ servers: McpRuntimeEntry[] }>("/api/status/mcp"),
    readCheck<{ addresses: unknown }>("/api/status/lan"),
  ]);
  const unavailable: string[] = [];
  const notices: string[] = [];
  const serviceData = services.status === "fulfilled" && typeof services.value?.agents?.active === "boolean" ? services.value : null;
  if (!serviceData) unavailable.push("Agent connection");
  const gitPayload = git.status === "fulfilled" ? git.value as GitStatus & { available?: boolean; reason?: string } : null;
  const gitSkipped = gitPayload?.available === false && (gitPayload.reason === "no-checkout" || gitPayload.reason === "git-missing");
  const gitData = !gitSkipped && git.status === "fulfilled" && typeof git.value?.branch === "string" && typeof git.value?.dirtyCount === "number" ? git.value : null;
  if (gitSkipped) {
    notices.push(gitPayload?.reason === "no-checkout"
      ? "No linked checkout, so the repository check is skipped."
      : "Git isn't installed, so the repository wasn't checked.");
  } else if (!gitData) unavailable.push("Repository");
  const mcpData = mcp.status === "fulfilled" && Array.isArray(mcp.value?.servers) ? mcp.value.servers : null;
  if (!mcpData) unavailable.push("MCP servers");
  const lanData = lan.status === "fulfilled" && Array.isArray(lan.value?.addresses)
    ? lan.value.addresses.filter((address): address is string => typeof address === "string" && address.length > 0)
    : null;
  if (!lanData) unavailable.push("Local network");
  return { services: serviceData, git: gitData, mcp: mcpData, lan: lanData, unavailable, notices };
}
