import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatAgentForTool } from "./agent-sync-format";
import { agentDirEntries, TOOL_DIRS } from "./sync-skills";
import { safeRemovePath } from "./server-utils";
import { pluginAssetDirs } from "./plugins/registry";
import type { AssetOrigin } from "./plugins/types";

export interface SyncAgentsOptions {
  prune?: boolean;
  dryRun?: boolean;
  agents?: string[];
  excludeAgents?: string[];
  tool?: string;
  emit: (line: string) => void;
  repoRoot: string;
}

interface AgentSource {
  file: string;
  origin: AssetOrigin;
}

function repoAgentNames(sourceDir: string): string[] {
  if (!fs.existsSync(sourceDir)) return [];
  return fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .filter((e) => e.name.endsWith(".md"))
    .map((e) => e.name.slice(0, -".md".length));
}

/**
 * Merge core `agents/shared` with agent dirs contributed by enabled plugins. Core wins
 * on name collisions, then plugins in registry order. With no plugins registered this is
 * exactly the core directory — byte-identical to the pre-plugin behaviour.
 */
export function resolveAgentSources(
  repoRoot: string,
  home: string,
  warn: (line: string) => void = () => {},
): Map<string, AgentSource> {
  const sources = new Map<string, AgentSource>();
  const coreDir = path.join(repoRoot, "agents", "shared");
  for (const name of repoAgentNames(coreDir)) {
    sources.set(name, { file: path.join(coreDir, `${name}.md`), origin: "core" });
  }
  for (const { dir, origin } of pluginAssetDirs("agents", home, warn)) {
    for (const name of repoAgentNames(dir)) {
      if (sources.has(name)) continue; // core (and earlier plugins) win
      sources.set(name, { file: path.join(dir, `${name}.md`), origin });
    }
  }
  return sources;
}

export async function syncAgents(opts: SyncAgentsOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  const sourceDir = path.join(repoRoot, "agents", "shared");
  if (!fs.existsSync(sourceDir)) {
    emit(`ERROR: Source agents directory not found: ${sourceDir}`);
    return 1;
  }

  const home = os.homedir();
  const agentSources = resolveAgentSources(repoRoot, home, emit);

  const excluded = new Set((opts.excludeAgents ?? []).map((s) => s.trim()).filter(Boolean));
  const allSourceAgents = [...agentSources.keys()].sort();
  const pluginCount = [...agentSources.values()].filter((s) => s.origin !== "core").length;
  const pruneKeepAgents = allSourceAgents.filter((n) => !excluded.has(n));
  let sourceAgents = allSourceAgents;
  if (opts.agents?.length) sourceAgents = sourceAgents.filter((n) => opts.agents!.includes(n));
  sourceAgents = sourceAgents.filter((n) => !excluded.has(n));
  const knownTools = new Set([...Object.keys(TOOL_DIRS), ...agentDirEntries(home).map((entry) => entry.tool)]);
  if (opts.tool && !knownTools.has(opts.tool)) {
    emit(`ERROR: Unknown tool '${opts.tool}'. Options: ${[...knownTools].sort().join(", ")}`);
    return 1;
  }

  const entries = agentDirEntries(home).filter((entry) => !opts.tool || entry.tool === opts.tool);
  if (excluded.size > 0) emit(`Excluding agents from sync/prune: ${[...excluded].sort().join(", ")}`);
  const originSummary = pluginCount > 0 ? ` (${allSourceAgents.length - pluginCount} core, ${pluginCount} plugin)` : "";
  emit(`Syncing ${sourceAgents.length} agent(s)${originSummary} to ${entries.length} target(s)...`);
  if (opts.dryRun) emit("(DRY RUN — no changes will be made)");

  let synced = 0;
  for (const { tool, path: targetRoot } of entries) {
    emit(`[${tool}:agents] ${targetRoot}`);
    for (const agent of sourceAgents) {
      const src = agentSources.get(agent)?.file;
      if (!src) continue;
      const dst = path.join(targetRoot, `${agent}.md`);
      if (opts.dryRun) {
        emit(`  WOULD: ${agent} -> ${dst}`);
        synced++;
        continue;
      }
      try {
        fs.mkdirSync(targetRoot, { recursive: true });
        safeRemovePath(dst);
        const raw = fs.readFileSync(src, "utf-8");
        const formatted = formatAgentForTool(raw, tool);
        if (formatted === raw && !raw.startsWith("---")) {
          emit(`  WARN: ${agent} has no frontmatter; copied unchanged`);
        }
        fs.writeFileSync(dst, formatted, "utf-8");
        emit(`  SYNCED: ${agent}`);
        synced++;
      } catch (e) {
        emit(`  FAILED: ${agent} (${e instanceof Error ? e.message : String(e)})`);
      }
    }

    if (opts.prune && fs.existsSync(targetRoot)) {
      for (const existing of fs.readdirSync(targetRoot, { withFileTypes: true })) {
        if (!existing.isFile() || !existing.name.endsWith(".md")) continue;
        const name = existing.name.slice(0, -".md".length);
        if (pruneKeepAgents.includes(name)) continue;
        if (excluded.has(name)) continue;
        const stale = path.join(targetRoot, existing.name);
        if (opts.dryRun) {
          emit(`  WOULD PRUNE: ${name}`);
          continue;
        }
        try {
          fs.rmSync(stale, { force: true });
          emit(`  PRUNED: ${name}`);
        } catch (e) {
          emit(`  PRUNE FAILED: ${name} (${e instanceof Error ? e.message : String(e)})`);
        }
      }
    }
  }

  emit(`Done. ${synced} agent(s) synced.`);
  return 0;
}
