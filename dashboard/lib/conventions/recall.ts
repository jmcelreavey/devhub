/**
 * Conventions as a Recall source.
 *
 * Active rules are indexed as one `learning` document per repo, so a `recall`
 * (or a search) about anything in that repo surfaces what its reviewers expect
 * without the agent having to know to ask for it. They live under `.config`,
 * which Recall's vault walker skips by design, so this is their own reader —
 * the same arrangement as the event spine.
 */
import fs from "node:fs";
import path from "node:path";
import { entityKey } from "@/lib/entity-note";
import { conventionsPrefsFilePath } from "./prefs";
import { renderConventionsMarkdown } from "./render";
import { activeRules } from "./rules";
import { conventionsDir, listConventions, repoFileKey } from "./store";

const MAX_PR_REFS = 20;

export interface ConventionRecallDoc {
  sourceKind: "learning";
  sourceId: string;
  title: string;
  text: string;
  href: string;
  ts: number;
  refs: string[];
}

export function conventionRecallDocs(): ConventionRecallDoc[] {
  const docs: ConventionRecallDoc[] = [];
  for (const file of listConventions()) {
    const text = renderConventionsMarkdown(file);
    if (!text) continue;

    const refs = new Set<string>([entityKey({ kind: "repo", id: file.repo.split("/")[1] ?? file.repo })]);
    const prs = new Set(activeRules(file).flatMap((rule) => rule.prs));
    for (const pr of [...prs].sort((a, b) => b - a).slice(0, MAX_PR_REFS)) {
      refs.add(entityKey({ kind: "pr", id: `${file.repo}#${pr}` }));
    }

    const lastOk = file.runs.find((run) => run.ok);
    docs.push({
      sourceKind: "learning",
      sourceId: `conventions/${repoFileKey(file.repo)}`,
      title: `Conventions — ${file.repo}`,
      text,
      href: `/conventions?repo=${encodeURIComponent(file.repo)}`,
      ts: Date.parse(lastOk?.at ?? file.checkedAt ?? "") || Date.now(),
      refs: [...refs],
    });
  }
  return docs;
}

/** Newest mtime across the rule files and the prefs that decide what is active. Stat-only. */
export function conventionsNewestMtime(): number {
  let newest = 0;
  const consider = (file: string): void => {
    try {
      newest = Math.max(newest, Math.floor(fs.statSync(file).mtimeMs));
    } catch {
      // Missing is fine: nothing mined yet.
    }
  };
  const dir = conventionsDir();
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) if (name.endsWith(".json")) consider(path.join(dir, name));
  }
  consider(conventionsPrefsFilePath());
  return newest;
}
