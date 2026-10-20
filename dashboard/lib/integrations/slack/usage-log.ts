import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { slackStateRoot } from "./store";

const EntrySchema = z.object({
  at: z.string().datetime(), profile: z.string(),
  route: z.enum(["rules", "tool-rules", "jev", "model"]),
  modelTier: z.enum(["cheap", "mid", "heavy"]).optional(),
  tool: z.string().optional(), jevCalls: z.number().int().min(0), jevCostUsd: z.number().min(0), modelCalls: z.number().int().min(0),
});
export type SlackUsageEntry = z.infer<typeof EntrySchema>;

export interface SlackUsageTotals { date: string; queries: number; rules: number; jevCalls: number; jevCostUsd: number; modelCalls: number }

const MAX_BYTES = 2_000_000;

function file(root: string): string { return path.join(root, "usage.jsonl"); }

/** Best-effort: a usage write must never fail an answer. */
export function recordSlackUsage(entry: Omit<SlackUsageEntry, "at"> & { at?: string }, root = slackStateRoot()): void {
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const target = file(root);
    if (fs.existsSync(target) && fs.statSync(target).size > MAX_BYTES) fs.renameSync(target, `${target}.old`);
    fs.appendFileSync(target, JSON.stringify({ ...entry, at: entry.at ?? new Date().toISOString() }) + "\n", { mode: 0o600 });
  } catch {}
}

function localDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** Totals for one local calendar day (default today). */
export function slackUsageTotals(root = slackStateRoot(), now = new Date()): SlackUsageTotals {
  const date = localDate(now);
  const totals: SlackUsageTotals = { date, queries: 0, rules: 0, jevCalls: 0, jevCostUsd: 0, modelCalls: 0 };
  let raw = "";
  try { raw = fs.readFileSync(file(root), "utf8"); } catch { return totals; }
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let entry: SlackUsageEntry;
    try { entry = EntrySchema.parse(JSON.parse(line)); } catch { continue; }
    if (localDate(new Date(entry.at)) !== date) continue;
    totals.queries++;
    if (entry.route === "rules" || entry.route === "tool-rules") totals.rules++;
    totals.jevCalls += entry.jevCalls;
    totals.jevCostUsd += entry.jevCostUsd;
    totals.modelCalls += entry.modelCalls;
  }
  return totals;
}

export function describeSlackUsage(totals: SlackUsageTotals): string {
  if (!totals.queries) return "No questions today yet.";
  const parts = [`${totals.queries} question${totals.queries === 1 ? "" : "s"}`, `${totals.rules} answered by rules (free)`];
  parts.push(`${totals.jevCalls} Jev call${totals.jevCalls === 1 ? "" : "s"} ≈ $${totals.jevCostUsd.toFixed(4)}`);
  parts.push(totals.modelCalls ? `${totals.modelCalls} answer/argument model call${totals.modelCalls === 1 ? "" : "s"} (cost not reported)` : "no model calls");
  return `Today: ${parts.join(" · ")}`;
}
