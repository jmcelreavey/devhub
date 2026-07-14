/**
 * Capability Radar — "why did this appear?" explainer.
 *
 * For a diff entry, gathers grounding evidence (the commits that introduced the
 * signal's files, recent commit subjects touching them) from local clones, then
 * asks the model to explain why the technology/pattern showed up. Cached per
 * (snapshot, delta) so the model is paid at most once per delta. Degrades to a
 * deterministic evidence summary when AI_API_KEY is unset.
 */

import fs from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import { getNotesAiModel, getNotesAiCallOptions } from "@/lib/ai-provider";
import { safeReadJSON, writeAtomic } from "@/lib/atomic-write";
import { gitLog } from "./git";
import { capabilityCacheDir, safeSegment } from "./paths";
import type { CapabilitySnapshot, DiffEntry } from "./types";

export interface DeltaExplanation {
  deltaId: string;
  markdown: string;
  generatedAt: string;
  source: "ai" | "evidence-only";
}

function explainFile(snapshotId: string, deltaId: string): string {
  return capabilityCacheDir("explain", `${safeSegment(`${snapshotId}__${deltaId}`)}.json`);
}

interface RepoEvidence {
  repoName: string;
  introduced: string | null; // "<sha> <subject> (<date>)"
  recent: string[];
}

async function gatherEvidence(snapshot: CapabilitySnapshot, entry: DiffEntry): Promise<RepoEvidence[]> {
  const out: RepoEvidence[] = [];
  for (const repoName of entry.repos.slice(0, 4)) {
    const repo = snapshot.repos.find((r) => r.repoName === repoName);
    if (!repo || repo.source !== "local") continue;
    const sig = repo.signals.find((s) => s.id === entry.id);
    const paths = (sig?.evidence ?? []).slice(0, 10);
    if (paths.length === 0) continue;

    const introduced = await gitLog(repo.repoRef, [
      "log", "--diff-filter=A", "-1", "--format=%h %s (%cs)", "--", ...paths,
    ]);
    const recent = await gitLog(repo.repoRef, ["log", "-3", "--format=%h %s (%cs)", "--", ...paths]);
    out.push({
      repoName,
      introduced: introduced || null,
      recent: recent ? recent.split("\n").filter(Boolean) : [],
    });
  }
  return out;
}

function evidenceSummary(entry: DiffEntry, evidence: RepoEvidence[]): string {
  const lines = [`### ${entry.label}`, "", `Detected in: ${entry.repos.join(", ") || "—"}`, ""];
  for (const e of evidence) {
    lines.push(`**${e.repoName}**`);
    if (e.introduced) lines.push(`- Introduced: ${e.introduced}`);
    for (const r of e.recent) lines.push(`- ${r}`);
    lines.push("");
  }
  if (evidence.length === 0) lines.push("_No local commit history available (remote-only or no clone)._");
  return lines.join("\n");
}

function buildPrompt(entry: DiffEntry, evidence: RepoEvidence[]): string {
  return [
    `A developer's engineering environment just gained "${entry.label}" (${entry.kind}, ${entry.area}).`,
    "Explain, in 3-5 sentences, the most likely reason it appeared and why it matters to this developer.",
    "Ground your answer ONLY in the evidence below. Do not invent commits, versions, or vendors.",
    "If evidence is thin, say what you can infer and note the uncertainty.",
    "End with one line: **Watch for:** <where they'll encounter it, e.g. in reviews>.",
    "",
    "Evidence:",
    evidenceSummary(entry, evidence),
  ].join("\n");
}

export async function explainDelta(
  snapshot: CapabilitySnapshot,
  entry: DiffEntry,
  refresh = false,
): Promise<DeltaExplanation> {
  const file = explainFile(snapshot.id, entry.id);
  if (!refresh) {
    const cached = safeReadJSON<DeltaExplanation | null>(file, null);
    if (cached) return cached;
  }

  const evidence = await gatherEvidence(snapshot, entry);
  const model = getNotesAiModel();

  let result: DeltaExplanation;
  if (!model) {
    result = {
      deltaId: entry.id,
      markdown: evidenceSummary(entry, evidence),
      generatedAt: new Date().toISOString(),
      source: "evidence-only",
    };
  } else {
    try {
      const { text } = await generateText({
        model,
        prompt: buildPrompt(entry, evidence),
        maxOutputTokens: 512,
        ...getNotesAiCallOptions(),
      });
      const markdown = text.trim();
      result = {
        deltaId: entry.id,
        markdown: markdown || evidenceSummary(entry, evidence),
        generatedAt: new Date().toISOString(),
        source: markdown ? "ai" : "evidence-only",
      };
    } catch (err) {
      result = {
        deltaId: entry.id,
        markdown: `${evidenceSummary(entry, evidence)}\n\n_AI explanation failed: ${String(err).slice(0, 120)}_`,
        generatedAt: new Date().toISOString(),
        source: "evidence-only",
      };
    }
  }

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await writeAtomic(file, JSON.stringify(result));
  } catch {
    // caching is best-effort
  }
  return result;
}
