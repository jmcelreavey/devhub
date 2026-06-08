/**
 * Reverse-sync for MCP servers.
 *
 * Scans each tool's real config (~/.claude.json, ~/.cursor/mcp.json,
 * etc.) and surfaces MCP servers that aren't yet in mcp/shared/. Local stdio
 * and remote HTTP/SSE entries can both be copied into the shared config.
 *
 * Mirrors collect-skills.ts in style — explicit list of names via
 * `importServerNames` triggers selective copy.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  listPersonalMcpServerNames,
  personalMcpDir,
  writePersonalMcpServer,
} from "./mcp-personal";
import {
  MCP_TOOL_TARGETS,
  listSharedMcpServerNames,
  reverseSubstituteRepoRoot,
  sharedMcpDir,
  type Json,
  type SharedMcpServer,
} from "./sync-mcp";

export interface LocalMcpServerSource {
  tool: string;
  configPath: string;
  /** Raw tool-specific entry (helpful for debugging / showing in the UI). */
  raw: Json;
  /** Already canonicalised + REPO_ROOT-reversed. Null when shape is unknown. */
  canonical: SharedMcpServer | null;
  /** True when this entry is remote HTTP/SSE. */
  remote: boolean;
}

export interface LocalMcpImportCandidate {
  name: string;
  sources: LocalMcpServerSource[];
  alreadyInRepo: boolean;
  alreadyInPersonal: boolean;
  alreadyInCatalog: boolean;
  /** True when no source has a usable canonical form. */
  unsupported: boolean;
}

function readJson(file: string): Record<string, Json> | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, Json>)
      : null;
  } catch {
    return null;
  }
}

function looksRemote(entry: Json): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const e = entry as Record<string, Json>;
  if (typeof e.url === "string") return true;
  if (typeof e.type === "string" && (e.type === "remote" || e.type === "sse" || e.type === "http")) {
    return true;
  }
  return false;
}

/** Discover MCP servers in each tool's config. */
export function scanLocalMcpImportCandidates(repoRoot: string): LocalMcpImportCandidate[] {
  const home = os.homedir();
  const repoNames = new Set(listSharedMcpServerNames(repoRoot));
  const personalNames = new Set(listPersonalMcpServerNames());

  const byName = new Map<string, LocalMcpServerSource[]>();

  for (const tool of MCP_TOOL_TARGETS) {
    const configPaths = [
      ...(tool.extraReadConfigPaths?.(home) ?? []),
      tool.configPath(home),
    ];
    for (const configPath of configPaths) {
      const cfg = readJson(configPath);
      if (!cfg) continue;
      const block = cfg[tool.topKey];
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      for (const [name, entry] of Object.entries(block as Record<string, Json>)) {
        const canonical = tool.fromTool(entry);
        const canonicalReversed = canonical
          ? (reverseSubstituteRepoRoot(
              canonical as Json,
              repoRoot,
            ) as SharedMcpServer)
          : null;
        const source: LocalMcpServerSource = {
          tool: tool.id,
          configPath,
          raw: entry,
          canonical: canonicalReversed
            ? {
                ...(canonicalReversed.command ? { command: canonicalReversed.command } : {}),
                args: canonicalReversed.args,
                env: canonicalReversed.env,
                type: canonicalReversed.type,
                url: canonicalReversed.url,
                enabled: canonicalReversed.enabled,
                oauth: canonicalReversed.oauth,
                headers: canonicalReversed.headers,
              }
            : null,
          remote: looksRemote(entry),
        };
        const list = byName.get(name) ?? [];
        list.push(source);
        byName.set(name, list);
      }
    }
  }

  return [...byName.entries()]
    .map(([name, sources]) => ({
      name,
      sources,
      alreadyInRepo: repoNames.has(name),
      alreadyInPersonal: personalNames.has(name),
      alreadyInCatalog: repoNames.has(name) || personalNames.has(name),
      unsupported: sources.every((s) => s.canonical === null),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type McpImportTarget = "repo" | "personal";

export interface CollectMcpServersOptions {
  dryRun?: boolean;
  excludeServers?: string[];
  /** When set, import only these names. Bypasses any other filtering. */
  importServerNames?: string[];
  /** `personal` writes to ~/.config/devhub/mcp-personal/ (not git). Default `repo`. */
  importTarget?: McpImportTarget;
  emit: (line: string) => void;
  repoRoot: string;
}

const SERVER_SLUG = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

export async function collectMcpServers(opts: CollectMcpServersOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  const repoMcpDir = sharedMcpDir(repoRoot);
  fs.mkdirSync(repoMcpDir, { recursive: true });

  const skip = new Set((opts.excludeServers ?? []).map((s) => s.trim()).filter(Boolean));
  const candidates = scanLocalMcpImportCandidates(repoRoot);
  const importTarget: McpImportTarget = opts.importTarget === "personal" ? "personal" : "repo";
  const destDir = importTarget === "personal" ? personalMcpDir() : repoMcpDir;

  const explicit = [...new Set((opts.importServerNames ?? []).map((s) => s.trim()).filter(Boolean))].filter(
    (n) => SERVER_SLUG.test(n),
  );

  let pickList: LocalMcpImportCandidate[];
  if (explicit.length > 0) {
    pickList = candidates.filter((c) => explicit.includes(c.name));
    emit(
      `Importing ${explicit.length} selected MCP server(s) into ${importTarget === "personal" ? destDir : repoMcpDir}`,
    );
  } else {
    pickList = candidates.filter((c) => !c.alreadyInCatalog && !c.unsupported && !skip.has(c.name));
    emit(`Scanning ${candidates.length} local MCP server(s); ${pickList.length} importable.`);
  }

  let collected = 0;
  let skipped = 0;

  for (const c of pickList) {
    if (c.alreadyInRepo) {
      emit(`  SKIP (already in repo): ${c.name}`);
      skipped++;
      continue;
    }
    if (skip.has(c.name)) {
      emit(`  SKIP (excluded): ${c.name}`);
      skipped++;
      continue;
    }
    const source = c.sources.find((s) => s.canonical !== null);
    if (!source || !source.canonical) {
      emit(`  SKIP (unsupported shape): ${c.name}`);
      skipped++;
      continue;
    }
    const payload: SharedMcpServer = {
      ...(source.canonical.command ? { command: source.canonical.command } : {}),
      ...(source.canonical.args && source.canonical.args.length > 0 ? { args: source.canonical.args } : {}),
      ...(source.canonical.env && Object.keys(source.canonical.env).length > 0 ? { env: source.canonical.env } : {}),
      ...(source.canonical.type ? { type: source.canonical.type } : {}),
      ...(source.canonical.url ? { url: source.canonical.url } : {}),
      ...(typeof source.canonical.enabled === "boolean" ? { enabled: source.canonical.enabled } : {}),
      ...(source.canonical.oauth && Object.keys(source.canonical.oauth).length > 0 ? { oauth: source.canonical.oauth } : {}),
      ...(source.canonical.headers && Object.keys(source.canonical.headers).length > 0
        ? { headers: source.canonical.headers }
        : {}),
    };

    if (opts.dryRun) {
      emit(`  [DRY-RUN] Would write: ${c.name} → ${importTarget} (from ${source.tool})`);
      collected++;
      continue;
    }
    try {
      if (importTarget === "personal") {
        writePersonalMcpServer(os.homedir(), c.name, payload);
        emit(`  + Personal: ${c.name} (from ${source.tool}) → ${personalMcpDir()}`);
      } else {
        const file = path.join(repoMcpDir, `${c.name}.json`);
        fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf-8");
        spawnSync("git", ["add", path.join("mcp/shared", `${c.name}.json`)], { cwd: repoRoot });
        emit(`  + Collected: ${c.name} (from ${source.tool})`);
      }
      collected++;
    } catch (e) {
      emit(`  FAILED: ${c.name} (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  if (collected === 0) {
    emit("No MCP servers imported.");
  } else if (opts.dryRun) {
    emit(`[DRY-RUN] Would collect ${collected} server(s); skipped ${skipped}.`);
  } else {
    emit(`Imported ${collected} MCP server(s); skipped ${skipped}.`);
    emit("Staged for commit. Review with: git status");
  }
  return 0;
}
