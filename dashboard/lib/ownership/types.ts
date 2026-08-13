export interface OwnedDomainOverride {
  id: string;
  label: string;
  paths: string[];
}

export interface OwnedTeamOverride {
  id: string;
  label: string;
  domains: string[];
}

export interface OwnedRepo {
  name: string;
  fullName: string;
  addedAt: string;
  lastVisited: string | null;
  lastSeenSha: string | null;
  domains: OwnedDomainOverride[] | null;
  teams: OwnedTeamOverride[] | null;
}

export interface ResolvedOwnedRepo extends OwnedRepo {
  owner: string;
  localRepoName: string | null;
  localPath: string | null;
  url: string;
  defaultBranch: string | null;
}

export interface RepoDomain {
  id: string;
  label: string;
  paths: string[];
  source: "override" | "workspace" | "codeowners" | "directory";
  codeowners: string[];
}

export interface RepoTeam {
  id: string;
  label: string;
  /**
   * Where the grouping came from, in descending order of authority. `churn` is
   * inferred from who commits where and is a hint only — it must never be
   * presented as a declared owner.
   */
  source: "override" | "codeowners" | "churn" | "unknown";
  domains: string[];
  /** Logins/emails behind a `churn` grouping; empty for declared sources. */
  members: string[];
}

/** One author's commit count per domain, used to infer teams when no CODEOWNERS exists. */
export interface DomainContribution {
  author: string;
  domainId: string;
  commits: number;
}

export interface RepoPrFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface RepoPrRadarRow {
  number: number;
  title: string;
  url: string;
  author: { login: string; avatarUrl: string | null };
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  files: RepoPrFile[];
  domains: string[];
  team: string;
  review: {
    mineRequested: boolean;
    reviewedBy: string[];
    nobodyLooking: boolean;
    decision: string | null;
  };
  checks: "passing" | "failing" | "pending" | "none";
  stale: boolean;
  uncoveredPaths: string[];
}

export interface RepoObligations {
  defaultBranchCi: "passing" | "failing" | "pending" | "unknown";
  staleBranches: { name: string; lastCommitAt: string }[];
  botPrs: number;
  unassignedIssues: number | null;
  partial: boolean;
}

/**
 * How a single obligation should read. `unknown` exists because "we could not
 * find out" is not the same as "it is fine" — rendering both green is how a
 * failed GitHub call ends up asserting that CI passes.
 */
import type { StatusTone } from "@/lib/status";

export type ObligationTone = StatusTone;

export interface ObligationCell {
  label: string;
  value: string;
  tone: ObligationTone;
  /** Contribution to the repo's attention score; see `attentionScore`. */
  weight: number;
}

export interface KnowledgeGap {
  domainId: string;
  label: string;
  inboundChurn: number;
  familiarity: number;
  score: number;
  evidence: {
    commits90d: number;
    authoredByMe: number;
    reviewedByMe: number;
    learnOpenedAt: string | null;
  };
}

export interface RepoDigest {
  sinceSha: string | null;
  headSha: string;
  generatedAt: string | null;
  cached: boolean;
  aiConfigured: boolean;
  summaryMarkdown: string | null;
  commits: { sha: string; subject: string; committedAt: string; domains: string[]; domainIds: string[] }[];
}

export interface OwnerBrief {
  repo: ResolvedOwnedRepo;
  domains: RepoDomain[];
  teams: RepoTeam[];
  prs: RepoPrRadarRow[];
  obligations: RepoObligations;
  gaps: KnowledgeGap[];
  digest: RepoDigest | null;
  warnings: string[];
}

export interface RepoOwnershipEvidence {
  fullName: string;
  domains: RepoDomain[];
  gaps: KnowledgeGap[];
}
