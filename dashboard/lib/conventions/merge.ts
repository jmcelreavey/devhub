/**
 * Folding the model's proposals into the repo's rules.
 *
 * Everything the model can't be trusted with is decided here: which comments a
 * rule is evidence-backed by (it only cites numbers), whether a "new" rule is
 * really one we already have, and that a rejected rule never comes back.
 */
import type { FeedbackItem } from "./feedback";
import type { GuidanceDoc } from "./github";
import type { MineProposal } from "./prompt";
import { findSimilarRule, isSafeRuleText, ruleId } from "./rules";
import type { ConventionRule, ConventionsFile, RuleEvidence } from "./types";

const MAX_EVIDENCE = 8;
const MAX_PRS = 60;
const MAX_RULES = 300;
const QUOTE_CHARS = 280;

export interface MergeResult {
  added: number;
  reinforced: number;
  skipped: number;
  autoAccepted: number;
  autoRejected: number;
}

function reviewEvidence(item: FeedbackItem): RuleEvidence {
  return {
    kind: "review",
    url: item.url,
    label: `PR #${item.prNumber} · ${item.author}`,
    prNumber: item.prNumber,
    author: item.author,
    path: item.path,
    quote: item.body.length > QUOTE_CHARS ? `${item.body.slice(0, QUOTE_CHARS)}…` : item.body,
    at: item.at,
    ...(item.actedOn ? { actedOn: true } : {}),
  };
}

function guidanceEvidence(repo: string, doc: GuidanceDoc): RuleEvidence {
  return {
    kind: "guidance",
    url: `https://github.com/${repo}/blob/HEAD/${doc.path}`,
    label: doc.path,
    quote: `Stated in ${doc.path}`,
  };
}

function evidenceKey(evidence: RuleEvidence): string {
  return `${evidence.kind}:${evidence.url ?? evidence.label}`;
}

/** Attach evidence to a rule. Returns true when it taught the rule something new. */
function addEvidence(rule: ConventionRule, incoming: readonly RuleEvidence[], now: string): boolean {
  const byKey = new Map(rule.evidence.map((evidence) => [evidenceKey(evidence), evidence]));
  const fresh = incoming.filter((evidence) => {
    const prior = byKey.get(evidenceKey(evidence));
    return !prior || prior.quote !== evidence.quote || !!prior.actedOn !== !!evidence.actedOn;
  });
  if (fresh.length === 0) return false;
  for (const evidence of fresh) byKey.set(evidenceKey(evidence), evidence);

  const guidance = [...byKey.values()].filter((e) => e.kind === "guidance");
  const reviews = [...byKey.values()]
    .filter((e) => e.kind === "review")
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  rule.evidence = [...reviews.slice(0, MAX_EVIDENCE), ...guidance];

  const prs = new Set(rule.prs);
  for (const evidence of fresh) if (evidence.prNumber !== undefined) prs.add(evidence.prNumber);
  rule.prs = [...prs].sort((a, b) => b - a).slice(0, MAX_PRS);
  rule.lastSeen = now;
  return true;
}

/** Manual decisions and legacy acceptances are never overturned by the miner. */
export function canDecideAutomatically(rule: ConventionRule): boolean {
  return !rule.edited && rule.origin !== "manual" &&
    (rule.status === "suggested" || rule.automaticDecision !== undefined);
}

function applyDecision(rule: ConventionRule, proposal: MineProposal, now: string, result: MergeResult): void {
  const status = proposal.decision === "accepted" && rule.evidence.length > 0 ? "accepted" : "rejected";
  const changed = rule.status !== status || rule.automaticDecision === undefined;
  rule.status = status;
  delete rule.acceptedBy;
  rule.automaticDecision = {
    status,
    reason: status !== proposal.decision ? "No source evidence supports this rule." : proposal.decisionReason,
    at: now,
  };
  if (changed) {
    if (status === "accepted") result.autoAccepted += 1;
    else result.autoRejected += 1;
  }
}

export interface MergeInput {
  repo: string;
  proposals: readonly MineProposal[];
  items: readonly FeedbackItem[];
  guidance: readonly GuidanceDoc[];
  now: string;
  /** Reassess automatic decisions when the current guidance changes. */
  guidanceChanged?: boolean;
}

/** Mutates `file.rules`. */
export function mergeProposals(file: ConventionsFile, input: MergeInput): MergeResult {
  const { repo, proposals, items, guidance, now, guidanceChanged = false } = input;
  const itemByIndex = new Map(items.map((item) => [item.index, item]));
  const result: MergeResult = { added: 0, reinforced: 0, skipped: 0, autoAccepted: 0, autoRejected: 0 };

  for (const proposal of proposals) {
    if ([proposal.text, proposal.why, proposal.scope, proposal.decisionReason].some((text) => text !== undefined && !isSafeRuleText(text))) {
      result.skipped += 1;
      continue;
    }

    const evidence: RuleEvidence[] = [
      ...proposal.evidence.flatMap((index) => {
        const item = itemByIndex.get(index);
        return item ? [reviewEvidence(item)] : [];
      }),
      ...proposal.guidance.flatMap((index) => {
        const doc = guidance[index - 1];
        return doc ? [guidanceEvidence(repo, doc)] : [];
      }),
    ];

    const target =
      (proposal.id ? file.rules.find((rule) => rule.id === proposal.id) : undefined) ??
      file.rules.find((rule) => rule.id === ruleId(proposal.text)) ??
      findSimilarRule(file.rules, proposal.text);

    if (target) {
      if (target.status === "rejected" && !canDecideAutomatically(target)) {
        result.skipped += 1;
        continue;
      }
      const fresh = addEvidence(target, evidence, now);
      if (fresh) result.reinforced += 1;
      if (canDecideAutomatically(target) && (target.status === "suggested" || fresh || guidanceChanged)) {
        applyDecision(target, proposal, now, result);
      }
      continue;
    }

    // No real comment behind it, or the file is full: not a rule we can stand behind.
    if (evidence.length === 0 || file.rules.length >= MAX_RULES) {
      result.skipped += 1;
      continue;
    }

    const rule: ConventionRule = {
      id: ruleId(proposal.text),
      text: proposal.text,
      ...(proposal.why ? { why: proposal.why } : {}),
      category: proposal.category,
      ...(proposal.scope ? { scope: proposal.scope } : {}),
      status: "suggested",
      origin: evidence.every((e) => e.kind === "guidance") ? "guidance" : "review",
      evidence: [],
      prs: [],
      firstSeen: now,
      lastSeen: now,
    };
    addEvidence(rule, evidence, now);
    applyDecision(rule, proposal, now, result);
    file.rules.push(rule);
    result.added += 1;
  }

  return result;
}
