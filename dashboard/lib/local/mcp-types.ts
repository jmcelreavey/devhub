/** Shared types for local MCP discovery (safe to import from client components). */

export interface LocalMcpServerSource {
  tool: string;
  configPath: string;
  /** True when the entry is remote (HTTP/SSE). */
  remote: boolean;
  /** Canonical MCP shape if recognisable, else null. */
  canonical: {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    type?: string;
    url?: string;
    enabled?: boolean;
    oauth?: Record<string, unknown>;
    headers?: Record<string, string>;
  } | null;
}

export interface LocalMcpImportCandidate {
  name: string;
  sources: LocalMcpServerSource[];
  alreadyInRepo: boolean;
  alreadyInPersonal: boolean;
  alreadyInCatalog: boolean;
  unsupported: boolean;
}
