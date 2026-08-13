import fs from "node:fs";
import path from "node:path";
import { safeReadJSON, writeAtomic } from "@/lib/atomic-write";
import { textToBlocks } from "@/lib/markdown-convert";
import { getNotesDir } from "@/lib/notes/dir";
import { pMapSettled } from "@/lib/p-limit";
import { listOwnedRepos } from "./owned-repos";
import { loadOwnerBrief } from "./service";
import type { OwnerBrief } from "./types";

export interface OwnershipMorningBrief {
  id: string;
  createdAt: string;
  markdown: string;
  repos: number;
  failures: string[];
}

export function buildOwnershipBriefMarkdown(briefs: OwnerBrief[], failures: string[]): string {
  const lines = ["# Repo ownership brief", ""];
  if (briefs.length === 0) lines.push("No owned repositories are configured.", "");
  for (const brief of briefs) {
    const unattended = brief.prs.filter((pr) => pr.review.nobodyLooking).length;
    lines.push(`## ${brief.repo.fullName}`, "");
    lines.push(
      `- Default CI: **${brief.obligations.defaultBranchCi}**`,
      `- Open PRs: **${brief.prs.length}** (${unattended} unattended)`,
      `- Stale branches: **${brief.obligations.staleBranches.length}**`,
      `- Bot PRs: **${brief.obligations.botPrs}**`,
      `- Unassigned issues: **${brief.obligations.unassignedIssues ?? "unknown"}**`,
    );
    const topGap = brief.gaps[0];
    if (topGap) lines.push(`- Highest knowledge gap: **${topGap.label}** (${topGap.score})`);
    lines.push("");
  }
  if (failures.length) lines.push("## Partial data", "", ...failures.map((failure) => `- ${failure}`), "");
  lines.push("Open `/own` for the full radar.");
  return lines.join("\n");
}

function cacheDir(): string {
  return path.join(getNotesDir(), ".cache", "ownership", "briefs");
}

export function readLatestOwnershipBrief(): OwnershipMorningBrief | null {
  const dir = cacheDir();
  if (!fs.existsSync(dir)) return null;
  const file = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().at(-1);
  return file ? safeReadJSON<OwnershipMorningBrief | null>(path.join(dir, file), null) : null;
}

export async function runOwnershipBrief(options: { emit?: (line: string) => void } = {}): Promise<OwnershipMorningBrief> {
  const emit = options.emit ?? (() => {});
  const repos = listOwnedRepos();
  emit(`Loading ${repos.length} owned repo${repos.length === 1 ? "" : "s"}...`);
  const results = await pMapSettled(repos, 3, (repo) => loadOwnerBrief(repo.fullName));
  const briefs = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failures = results.flatMap((result, index) =>
    result.status === "rejected" ? [`${repos[index]!.fullName}: ${String(result.reason)}`] : [],
  );
  const id = new Date().toISOString().slice(0, 10);
  const markdown = buildOwnershipBriefMarkdown(briefs, failures);
  const brief: OwnershipMorningBrief = {
    id,
    createdAt: new Date().toISOString(),
    markdown,
    repos: briefs.length,
    failures,
  };
  fs.mkdirSync(cacheDir(), { recursive: true });
  await writeAtomic(path.join(cacheDir(), `${id}.json`), JSON.stringify(brief, null, 2) + "\n");
  const notePath = path.join(getNotesDir(), "learnings", "ownership-briefs", `${id}.json`);
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  await writeAtomic(notePath, JSON.stringify(textToBlocks(markdown)));
  emit(`Ownership brief ready for ${briefs.length} repo${briefs.length === 1 ? "" : "s"}.`);
  return brief;
}
