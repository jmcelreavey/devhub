import type { Json } from "../json-file";

/** Canonical per-server JSON stored under mcp/shared/<name>.json. */
export interface SharedMcpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
  type?: string;
  url?: string;
  enabled?: boolean;
  oauth?: Record<string, Json>;
  headers?: Record<string, string>;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
  /** Codex-only tool policy. */
  codex?: CodexToolPolicy;
}

export interface CodexToolPolicy {
  /** Run without an approval prompt. Only read-only tools the server leaves unannotated. */
  approvedTools?: string[];
  /** Hide from Codex, e.g. tools that duplicate Codex's own shell or editor and would prompt. */
  disabledTools?: string[];
}

