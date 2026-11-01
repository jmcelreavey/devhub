import crypto from "node:crypto";
import { parseGitHubRepoUrl } from "../../../../../packages/shared/ui-lib/plugins/github-url";

export interface RegistryRow {
  id: string;
  /** Empty when the entry has no name of its own. */
  name: string;
  path: string;
  enabled: boolean;
  managed: boolean;
  url: string | null;
  sha: string | null;
  /** Branch name for display, e.g. "main". */
  ref: string | null;
  installedAt: string | null;
  lastOperation: { kind: string; at: string } | null;
}

export type RawEntry = Record<string, unknown>;

export const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

export function rowFrom(entry: RawEntry): RegistryRow {
  const source = (entry.source && typeof entry.source === "object" ? entry.source : {}) as Record<string, unknown>;
  const rawPath = text(entry.path) ?? "";
  const name = text(entry.name) ?? "";
  const operation = entry.lastOperation as { kind?: unknown; at?: unknown } | undefined;
  const ref = text(source.ref);
  const sourceUrl = text(source.url);
  const parsedUrl = sourceUrl ? parseGitHubRepoUrl(sourceUrl) : null;
  return {
    // Entries written before ids existed are addressed by name; an entry with
    // neither gets a stable id derived from its folder, never the folder itself.
    id: text(entry.id) ?? (name || `folder-${crypto.createHash("sha256").update(rawPath).digest("hex").slice(0, 12)}`),
    name,
    path: rawPath,
    enabled: entry.enabled !== false,
    managed: entry.managed === true,
    url: parsedUrl?.ok ? parsedUrl.repo.url : null,
    sha: text(entry.approvedSha) ?? text(source.sha),
    ref: ref ? ref.replace(/^refs\/heads\//, "") : null,
    installedAt: text(entry.installedAt),
    lastOperation: operation && typeof operation.kind === "string" && typeof operation.at === "string"
      ? { kind: operation.kind, at: operation.at }
      : null,
  };
}

