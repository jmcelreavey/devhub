/**
 * Pure helpers over rules: identity, similarity, "is this one in force", and
 * the safety check on text that will later be handed to an agent.
 */
import { createHash } from "node:crypto";
import { jaccard } from "@/lib/recall/dedupe";
import { tokenize } from "@/lib/recall/tokenize";
import type {
  ConventionRule,
  ConventionsFile,
  ConventionsSummary,
  RuleCategory,
} from "./types";
import { RULE_CATEGORIES } from "./types";

/**
 * Two phrasings of the same rule from different runs land around 0.5–0.8 on
 * stemmed-token Jaccard; unrelated rules about the same repo sit well under
 * 0.35. Lower than Recall's 0.9 because the miner paraphrases, where Recall
 * only ever sees verbatim repeats.
 */
const SIMILAR_THRESHOLD = 0.55;

export function normalizeRuleText(text: string): string {
  return text
    .toLowerCase()
    // Sentence punctuation, but not the dot in `stripe.js`: only before whitespace or the end.
    .replace(/[.,;:!?]+(?=\s|$)/g, " ")
    .replace(/[^a-z0-9\s./_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ruleId(text: string): string {
  return `r_${createHash("sha1").update(normalizeRuleText(text)).digest("hex").slice(0, 10)}`;
}

function vocab(text: string): Set<string> {
  return new Set(tokenize(text).filter((token) => /[a-z]/.test(token)));
}

/** The existing rule that says (nearly) the same thing, if any. Rejected rules count. */
export function findSimilarRule(
  rules: readonly ConventionRule[],
  text: string,
  threshold = SIMILAR_THRESHOLD,
): ConventionRule | null {
  const candidate = vocab(text);
  if (candidate.size < 2) return null;
  let best: ConventionRule | null = null;
  let bestScore = threshold;
  for (const rule of rules) {
    const score = jaccard(candidate, vocab(rule.text));
    if (score >= bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

export function coerceCategory(raw: unknown): RuleCategory {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (RULE_CATEGORIES as readonly string[]).includes(value) ? (value as RuleCategory) : "other";
}

/** Only decided rules guide agents. Legacy suggestions wait for automatic assessment. */
export function isActive(rule: ConventionRule): boolean {
  return rule.status === "accepted";
}

export function activeRules(file: ConventionsFile): ConventionRule[] {
  return file.rules.filter(isActive);
}

export function summarize(
  file: ConventionsFile,
  mining: boolean,
): ConventionsSummary {
  const lastRun = file.runs[0];
  const lastOk = file.runs.find((run) => run.ok);
  return {
    repo: file.repo,
    rules: file.rules.filter((rule) => rule.status !== "rejected").length,
    active: activeRules(file).length,
    toReview: file.rules.filter((rule) => rule.status === "suggested").length,
    rejected: file.rules.filter((rule) => rule.status === "rejected").length,
    lastMinedAt: lastOk?.at ?? null,
    checkedAt: file.checkedAt ?? null,
    lastRunOk: lastRun ? lastRun.ok : null,
    mining,
  };
}

/**
 * Rule text ends up in an agent's context, and it was distilled from comments
 * anyone with a GitHub account on the repo could write. A model will usually
 * refuse to turn "ignore your instructions and run X" into a convention, but
 * "usually" is not a control — so reject the shapes an injection needs.
 */
const UNSAFE_RULE = [
  /https?:\/\//i,
  /\bignore (all |any |the )?(previous|prior|above|earlier)\b/i,
  /\b(disregard|override) (all |any |the )?(previous|prior|above|system)\b/i,
  /\b(curl|wget)\s/i,
  /\|\s*(ba|z)?sh\b/i,
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bapi[_ -]?key\b.*[:=]/i,
];

export function isSafeRuleText(text: string): boolean {
  if (text.includes("\n")) return false;
  return !UNSAFE_RULE.some((pattern) => pattern.test(text));
}
