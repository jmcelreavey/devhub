/**
 * Human edits to a repo's rules — the review half of "mined, then reviewed".
 * Pure mutators over a `ConventionsFile`; the API route runs them inside
 * `updateConventions` so they land on the latest file.
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { coerceCategory, findSimilarRule, isSafeRuleText, ruleId } from "./rules";
import type { ConventionRule, ConventionsFile, RuleCategory, RuleStatus } from "./types";

export class RuleEditError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

function find(file: ConventionsFile, id: string): ConventionRule {
  const rule = file.rules.find((candidate) => candidate.id === id);
  if (!rule) throw new RuleEditError("Rule not found.", 404);
  return rule;
}

function ruleFingerprint(rule: ConventionRule): string {
  return createHash("sha256").update(JSON.stringify(rule)).digest("hex");
}

const undoSchema = z.object({
  repo: z.string(),
  ruleId: z.string().min(3).max(40),
  status: z.enum(["suggested", "accepted", "rejected"]),
  acceptedBy: z.literal("pr").optional(),
  automaticDecision: z.object({
    status: z.enum(["accepted", "rejected"]),
    reason: z.string().max(400),
    at: z.string(),
  }).optional(),
  expected: z.string().regex(/^[a-f0-9]{64}$/),
});

export function setRuleStatus(file: ConventionsFile, id: string, status: RuleStatus): void {
  const rule = find(file, id);
  // Legacy clients restoring to suggested now reinstate the rule directly.
  rule.status = status === "suggested" ? "accepted" : status;
  delete rule.acceptedBy;
  delete rule.automaticDecision;
  rule.decisionRevision = randomUUID();
}

/** Capture the state inside the store mutex, not from a possibly stale browser. */
export function setRuleStatusWithUndo(file: ConventionsFile, id: string, status: RuleStatus): string {
  const rule = find(file, id);
  const previous = { repo: file.repo.toLowerCase(), ruleId: id, status: rule.status, acceptedBy: rule.acceptedBy, automaticDecision: rule.automaticDecision };
  setRuleStatus(file, id, status);
  return JSON.stringify({ ...previous, expected: ruleFingerprint(rule) });
}

export function undoRuleStatus(file: ConventionsFile, token: string): void {
  let raw: unknown;
  try {
    raw = JSON.parse(token);
  } catch {
    throw new RuleEditError("Invalid undo token.");
  }
  const parsed = undoSchema.safeParse(raw);
  if (!parsed.success || parsed.data.repo !== file.repo.toLowerCase()) {
    throw new RuleEditError("Invalid undo token for this repo.");
  }
  const previous = parsed.data;
  const rule = find(file, previous.ruleId);
  if (ruleFingerprint(rule) !== previous.expected) {
    throw new RuleEditError("This rule changed after your decision. Refresh it before making another decision.", 409);
  }
  rule.status = previous.status;
  if (previous.automaticDecision) rule.automaticDecision = previous.automaticDecision;
  else delete rule.automaticDecision;
  if (previous.acceptedBy) rule.acceptedBy = previous.acceptedBy;
  else delete rule.acceptedBy;
  rule.decisionRevision = randomUUID();
}

export interface RulePatch {
  text?: string;
  why?: string;
  category?: RuleCategory;
  scope?: string;
}

function cleanText(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length < 8) throw new RuleEditError("A rule needs at least a short sentence.");
  if (cleaned.length > 240) throw new RuleEditError("Keep a rule under 240 characters.");
  if (!isSafeRuleText(cleaned)) {
    throw new RuleEditError("Rules can't contain links, shell commands or instructions to ignore other instructions.");
  }
  return cleaned;
}

/** Editing text accepts the rule: someone read it and chose these words. */
export function editRule(file: ConventionsFile, id: string, patch: RulePatch): void {
  const rule = find(file, id);
  if (patch.text !== undefined) {
    rule.text = cleanText(patch.text);
    rule.edited = true;
    rule.status = "accepted";
    delete rule.acceptedBy;
  }
  rule.decisionRevision = randomUUID();
  delete rule.automaticDecision;
  if (patch.why !== undefined) rule.why = patch.why.trim() || undefined;
  if (patch.scope !== undefined) rule.scope = patch.scope.trim() || undefined;
  if (patch.category !== undefined) rule.category = coerceCategory(patch.category);
}

export function addManualRule(file: ConventionsFile, input: RulePatch & { text: string }, now: string): ConventionRule {
  const text = cleanText(input.text);
  if (findSimilarRule(file.rules, text)) throw new RuleEditError("A rule like that already exists.", 409);
  const rule: ConventionRule = {
    id: ruleId(text),
    text,
    ...(input.why?.trim() ? { why: input.why.trim() } : {}),
    category: coerceCategory(input.category),
    ...(input.scope?.trim() ? { scope: input.scope.trim() } : {}),
    status: "accepted",
    origin: "manual",
    evidence: [],
    prs: [],
    firstSeen: now,
    lastSeen: now,
    edited: true,
  };
  file.rules.push(rule);
  return rule;
}

/** Only rules you wrote can be deleted; mined ones are rejected so they stay rejected. */
export function deleteRule(file: ConventionsFile, id: string): void {
  const rule = find(file, id);
  if (rule.origin !== "manual") {
    throw new RuleEditError("Mined rules can't be deleted — reject it and it won't come back.");
  }
  file.rules = file.rules.filter((candidate) => candidate.id !== id);
}
