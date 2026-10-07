/**
 * Repo conventions — the shapes shared by the miner, the store, the API and the UI.
 *
 * Types only (plus two tiny constant tables), so client components can import
 * this without dragging `node:fs` into a browser bundle.
 *
 * The idea: reviewers keep telling you "our pattern is X" in PR comments, and
 * no AGENTS.md captures it. Conventions turns those comments into per-repo
 * rules, each one pointing back at the comments that justify it, and feeds the
 * active ones to review and create-PR agents.
 */
import type { AiProviderId } from "@/lib/ai/preference";

export const RULE_CATEGORIES = [
  "structure",
  "config",
  "naming",
  "testing",
  "errors",
  "security",
  "performance",
  "style",
  "process",
  "other",
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<RuleCategory, string> = {
  structure: "Structure",
  config: "Config",
  naming: "Naming",
  testing: "Testing",
  errors: "Errors",
  security: "Security",
  performance: "Performance",
  style: "Style",
  process: "Process",
  other: "Other",
};

/** `suggested` is legacy data awaiting automatic assessment; new rules are accepted or rejected. */
export type RuleStatus = "suggested" | "accepted" | "rejected";
export type RuleOrigin = "review" | "guidance" | "manual";
export type MineTrigger = "manual" | "review" | "create-pr" | "agent";

export interface RuleEvidence {
  kind: "review" | "guidance";
  /** Comment permalink, or the guidance file on GitHub. */
  url?: string;
  /** Short human label: `PR #42 · reviewer-a` or `AGENTS.md`. */
  label: string;
  prNumber?: number;
  author?: string;
  /** File the review comment was left on. */
  path?: string;
  quote: string;
  at?: string;
  /** An outdated thread plus author resolution or explicit confirmation; the resulting diff is not verified. */
  actedOn?: boolean;
}

export interface ConventionRule {
  /** `r_` + hash of the normalised text; stable, and the dedupe key. */
  id: string;
  /** One imperative sentence. */
  text: string;
  why?: string;
  category: RuleCategory;
  /** Path or glob hint for where the rule applies, when the comments said. */
  scope?: string;
  status: RuleStatus;
  origin: RuleOrigin;
  /** Newest first, capped. */
  evidence: RuleEvidence[];
  /** Distinct PR numbers the evidence came from. */
  prs: number[];
  firstSeen: string;
  lastSeen: string;
  /** A human rewrote the text; the miner never overwrites it. */
  edited?: boolean;
  /** Set when the miner accepted this itself because a PR author acted on the comment; cleared by any human decision. */
  acceptedBy?: "pr";
  /** The miner’s latest evidence-based decision. Human overrides clear it. */
  automaticDecision?: { status: "accepted" | "rejected"; reason: string; at: string };
  /** Changes on human decisions so undo cannot replay across later edits. */
  decisionRevision?: string;
}

export interface MineRun {
  at: string;
  trigger: MineTrigger;
  ok: boolean;
  error?: string;
  prsScanned: number;
  /** Comments sent to the model. */
  comments: number;
  /** Substantive comments found before the caps; `comments` is the part that fit. */
  considered: number;
  added: number;
  /** Rules automatically accepted or rejected this run. */
  autoAccepted?: number;
  autoRejected?: number;
  reinforced: number;
  ms: number;
  /** Provider that answered; blank when the run failed before generating. */
  provider?: string;
  /** Model override in force, or `default`. */
  model?: string;
  guidanceFiles: string[];
}

export interface ConventionsFile {
  version: 1;
  /** `owner/repo` as first seen. */
  repo: string;
  rules: ConventionRule[];
  /** PR number → feedback fingerprint. Legacy counts are re-mined once on upgrade. */
  minedPrs: Record<string, number | string>;
  guidanceHash?: string;
  /** Last attempt, success or not — what the throttle reads. */
  checkedAt?: string;
  /** Newest first, capped. */
  runs: MineRun[];
}

export interface ConventionsPrefs {
  /** Master switch for everything automatic. Manual refresh always works. */
  enabled: boolean;
  /** PRs scanned per run. */
  prLimit: number;
  /** Minimum gap between automatic runs for one repo. */
  minIntervalHours: number;
  /** Blank = the default AI provider. */
  provider: AiProviderId | "";
  /** Blank = that provider's configured model. */
  model: string;
}

export interface ConventionsSummary {
  repo: string;
  rules: number;
  active: number;
  /** Legacy rules awaiting automatic assessment, never a manual review queue. */
  toReview: number;
  rejected: number;
  lastMinedAt: string | null;
  checkedAt: string | null;
  lastRunOk: boolean | null;
  mining: boolean;
}
