/**
 * In-process port of scripts/collect_local_skills.sh.
 *
 * Scans the per-tool skill directories under ~/. for skills that exist locally
 * but aren't in the repo, copies them into skills/shared/, and stages them with
 * git so the user can review before committing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { upstreamOnlySkillNames } from "./skill-catalog";
import { copyTreeSync } from "./server-utils";
import { devhubSharedSkillsDir, SKILL_MD, SKILL_SLUG } from "./skills-shared";
import { toolDirPaths, TOOL_DIRS } from "./sync-skills";
import { spawnSync } from "node:child_process";
import { canImportLocalCandidate, type LocalSkillImportCandidate, type LocalSkillSource } from "./local-skills-types";
import { classifyLocalCatalogRecord, newestLocalSource } from "./local-catalog-compare";
import { newestMeaningfulMtimeMs } from "./tree-compare";

export type { LocalSkillImportCandidate, LocalSkillSource } from "./local-skills-types";

const EXCLUDED = new Set([
  "mempalace",
  "paseo",
  "paseo-chat",
  "paseo-committee",
  "paseo-handoff",
  "paseo-loop",
  "paseo-orchestrate",
]);

export interface CollectSkillsOptions {
  dryRun?: boolean;
  /** Extra skill names to skip collecting (in addition to built-in excludes). */
  excludeSkills?: string[];
  /**
   * When set, copy only these directory names from local tool dirs (UI / CLI picks).
   * Bypasses built-in EXCLUDED — you asked for these by name.
   */
  importSkillNames?: string[];
  emit: (line: string) => void;
  repoRoot: string;
}

/** Discover skills with a SKILL.md under ~/.claude/skills, ~/.codex/skills, etc. */
export function scanLocalSkillImportCandidates(repoRoot: string): LocalSkillImportCandidate[] {
  const home = os.homedir();
  const repoSkillsDir = devhubSharedSkillsDir(repoRoot);
  const byName = new Map<string, LocalSkillSource[]>();

  for (const [tool, sub] of Object.entries(TOOL_DIRS)) {
    const root = path.join(home, sub);
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (!SKILL_SLUG.test(name)) continue;
      const skillRoot = path.join(root, name);
      if (!fs.existsSync(path.join(skillRoot, SKILL_MD))) continue;
      const list = byName.get(name) ?? [];
      list.push({ tool, absPath: skillRoot, kind: "skill", latestMtimeMs: newestMeaningfulMtimeMs(skillRoot) });
      byName.set(name, list);
    }
  }

  return [...byName.entries()]
    .map(([name, sources]) => {
      const repoPath = path.join(repoSkillsDir, name);
      const source = newestLocalSource(sources) ?? sources[0];
      const classification = source
        ? classifyLocalCatalogRecord(source.absPath, repoPath)
        : { status: "changed" as const, repoMtimeMs: newestMeaningfulMtimeMs(repoPath), localMtimeMs: null };
      return {
        name,
        kind: "skill" as const,
        sources,
        alreadyInRepo: classification.status !== "new",
        status: classification.status,
        repoPath: fs.existsSync(repoPath) ? repoPath : undefined,
        repoMtimeMs: classification.repoMtimeMs,
        localMtimeMs: classification.localMtimeMs,
        excludedFromAutoCollect: EXCLUDED.has(name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function collectSkills(opts: CollectSkillsOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  const skipNames = new Set([...EXCLUDED, ...(opts.excludeSkills ?? []).map((s) => s.trim()).filter(Boolean)]);
  const home = os.homedir();
  const repoSkillsDir = devhubSharedSkillsDir(repoRoot);

  const localDirs = toolDirPaths(home).filter((d) => fs.existsSync(d));

  if (localDirs.length === 0) {
    emit("WARNING: No local skill directories found.");
    emit("Expected one of: ~/.claude/skills, ~/.codex/skills, ~/.opencode/skills, ~/.cursor/skills, ~/.cursor/skills-cursor");
    return 0;
  }

  const explicit = [...new Set((opts.importSkillNames ?? []).map((s) => s.trim()).filter(Boolean))].filter((n) =>
    SKILL_SLUG.test(n),
  );

  if (explicit.length > 0) {
    const candidates = new Map(scanLocalSkillImportCandidates(repoRoot).map((candidate) => [candidate.name, candidate]));
    emit(`Importing ${explicit.length} selected skill(s) into ${repoSkillsDir}`);
    let collected = 0;
    let skipped = 0;
    for (const skillName of explicit) {
      const candidate = candidates.get(skillName);
      if (!candidate) {
        emit(`  SKIP (not found under any tool skills dir): ${skillName}`);
        skipped++;
        continue;
      }
      if (!canImportLocalCandidate(candidate)) {
        emit(`  SKIP (${candidate.status.replace("-", " ")}): ${skillName}`);
        skipped++;
        continue;
      }
      if (EXCLUDED.has(skillName)) {
        emit(`  Note: ${skillName} is skipped by auto-collect policy; importing anyway (explicit pick).`);
      }
      const source = newestLocalSource(candidate.sources);
      if (!source) {
        emit(`  SKIP (no usable source): ${skillName}`);
        skipped++;
        continue;
      }
      if (opts.dryRun) {
        emit(`  [DRY-RUN] Would ${candidate.alreadyInRepo ? "update" : "collect"}: ${skillName} <- ${source.absPath}`);
        collected++;
        continue;
      }
      try {
        copyTreeSync(source.absPath, path.join(repoSkillsDir, skillName));
        spawnSync("git", ["add", path.join("skills/shared", skillName)], { cwd: repoRoot });
        emit(`  + ${candidate.alreadyInRepo ? "Updated" : "Collected"}: ${skillName}`);
        collected++;
      } catch (e) {
        emit(`  FAILED: ${skillName} (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    if (collected === 0) {
      emit("No skills imported (all skipped or missing locally).");
    } else if (opts.dryRun) {
      emit(`[DRY-RUN] Would collect ${collected} skill(s); skipped ${skipped}.`);
    } else {
      emit(`Imported ${collected} skill(s); skipped ${skipped}.`);
      emit("Staged for commit. Review with: git status");
    }
    return 0;
  }

  emit(`Scanning ${localDirs.length} local skill directories...`);
  emit(`Repo skills dir: ${repoSkillsDir}`);

  const aiToolsOnly = upstreamOnlySkillNames(repoRoot);

  let collected = 0;
  let skipped = 0;

  for (const dir of localDirs) {
    emit(`Scanning: ${dir}`);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillName = entry.name;
      const skillSrc = path.join(dir, skillName);

      if (skipNames.has(skillName)) {
        skipped++;
        continue;
      }
      if (fs.existsSync(path.join(repoSkillsDir, skillName))) {
        skipped++;
        continue;
      }
      if (aiToolsOnly.has(skillName)) {
        emit(`  SKIP (ai-tools upstream): ${skillName}`);
        skipped++;
        continue;
      }
      if (!fs.existsSync(path.join(skillSrc, SKILL_MD))) {
        emit(`  Skipping ${skillName} (no ${SKILL_MD})`);
        continue;
      }

      if (opts.dryRun) {
        emit(`  [DRY-RUN] Would collect: ${skillName}`);
        collected++;
        continue;
      }

      try {
        copyTreeSync(skillSrc, path.join(repoSkillsDir, skillName));
        spawnSync("git", ["add", path.join("skills/shared", skillName)], {
          cwd: repoRoot,
        });
        emit(`  + Collected: ${skillName}`);
        collected++;
      } catch (e) {
        emit(`  FAILED: ${skillName} (${e instanceof Error ? e.message : String(e)})`);
      }
    }
  }

  if (collected === 0) {
    emit("No new skills found. Everything is in sync.");
  } else if (opts.dryRun) {
    emit(`[DRY-RUN] Would collect ${collected} skill(s), skip ${skipped} existing.`);
  } else {
    emit(`Collected ${collected} new skill(s), skipped ${skipped} existing.`);
    emit("Staged for commit. Review with: git status");
  }
  return 0;
}
