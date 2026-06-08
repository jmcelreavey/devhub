import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalizeAgentMarkdown } from "./agent-sync-format";
import { agentDirEntries } from "./sync-skills";
import { canImportLocalCandidate, type LocalSkillImportCandidate, type LocalSkillSource } from "./local-skills-types";
import { classifyLocalAgentRecord, newestLocalSource } from "./local-catalog-compare";
import { newestMeaningfulMtimeMs } from "./tree-compare";

const AGENT_SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export interface CollectAgentsOptions {
  dryRun?: boolean;
  excludeAgents?: string[];
  importAgentNames?: string[];
  emit: (line: string) => void;
  repoRoot: string;
}

export function scanLocalAgentImportCandidates(repoRoot: string): LocalSkillImportCandidate[] {
  const repoAgentsDir = path.join(repoRoot, "agents", "shared");
  const byName = new Map<string, LocalSkillSource[]>();

  for (const { tool, path: root } of agentDirEntries(os.homedir())) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const name = entry.name.slice(0, -".md".length);
      if (!AGENT_SLUG.test(name)) continue;
      const sources = byName.get(name) ?? [];
      const absPath = path.join(root, entry.name);
      sources.push({ tool, absPath, kind: "agent", latestMtimeMs: newestMeaningfulMtimeMs(absPath) });
      byName.set(name, sources);
    }
  }

  return [...byName.entries()]
    .map(([name, sources]) => {
      const repoPath = path.join(repoAgentsDir, `${name}.md`);
      const source = newestLocalSource(sources) ?? sources[0];
      const classification = source
        ? classifyLocalAgentRecord(source.absPath, repoPath)
        : { status: "changed" as const, repoMtimeMs: newestMeaningfulMtimeMs(repoPath), localMtimeMs: null };
      return {
        name,
        kind: "agent" as const,
        sources,
        alreadyInRepo: classification.status !== "new",
        status: classification.status,
        repoPath: fs.existsSync(repoPath) ? repoPath : undefined,
        repoMtimeMs: classification.repoMtimeMs,
        localMtimeMs: classification.localMtimeMs,
        excludedFromAutoCollect: false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function collectAgents(opts: CollectAgentsOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  const repoAgentsDir = path.join(repoRoot, "agents", "shared");
  const excluded = new Set((opts.excludeAgents ?? []).map((s) => s.trim()).filter(Boolean));
  const candidates = scanLocalAgentImportCandidates(repoRoot).filter((c) => !excluded.has(c.name));
  const explicit = [...new Set((opts.importAgentNames ?? []).map((s) => s.trim()).filter(Boolean))].filter((n) =>
    AGENT_SLUG.test(n),
  );
  const importable = explicit.length
    ? explicit.map((name) => candidates.find((candidate) => candidate.name === name)).filter((candidate): candidate is LocalSkillImportCandidate => !!candidate)
    : candidates.filter((c) => c.status === "new");

  if (importable.length === 0) {
    emit("No new agents found. Everything is in sync.");
    return 0;
  }

  emit(`Importing ${importable.length} agent(s) into ${repoAgentsDir}`);
  let collected = 0;
  let skipped = 0;
  for (const candidate of importable) {
    if (!canImportLocalCandidate(candidate)) {
      emit(`  SKIP (${candidate.status.replace("-", " ")}): ${candidate.name}`);
      skipped++;
      continue;
    }
    const source = newestLocalSource(candidate.sources);
    if (!source) continue;
    if (opts.dryRun) {
      emit(`  [DRY-RUN] Would ${candidate.alreadyInRepo ? "update" : "collect"}: ${candidate.name} <- ${source.absPath}`);
      collected++;
      continue;
    }
    try {
      fs.mkdirSync(repoAgentsDir, { recursive: true });
      const raw = fs.readFileSync(source.absPath, "utf-8");
      fs.writeFileSync(
        path.join(repoAgentsDir, `${candidate.name}.md`),
        canonicalizeAgentMarkdown(raw),
        "utf-8",
      );
      spawnSync("git", ["add", path.join("agents/shared", `${candidate.name}.md`)], { cwd: repoRoot });
      emit(`  + ${candidate.alreadyInRepo ? "Updated" : "Collected"}: ${candidate.name}`);
      collected++;
    } catch (e) {
      emit(`  FAILED: ${candidate.name} (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  if (opts.dryRun) emit(`[DRY-RUN] Would collect/update ${collected} agent(s); skipped ${skipped}.`);
  else emit(`Collected/updated ${collected} agent(s); skipped ${skipped}. Staged for commit. Review with: git status`);
  return 0;
}
