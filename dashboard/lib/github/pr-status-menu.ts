/**
 * Actions for a right-click on a PR / CI status pill.
 * Pure so the menu can be tested without rendering the shell.
 */
import { parseGithubPrUrl } from "@/lib/entity-links/parse-pr";

export type PrChecksMenuState = "passing" | "failing" | "pending" | "none";

export interface PrStatusMenuTarget {
  /** GitHub pull request URL. */
  url: string;
  repo?: string;
  number?: number;
  /** Head branch, when the surface already knows it. */
  branch?: string | null;
  /** Local clone folder name, when DevHub has the repo. */
  localRepoName?: string | null;
  checks?: PrChecksMenuState | null;
  checkCounts?: { passed: number; failed: number; pending: number } | null;
}

export type PrStatusMenuAction =
  | { type: "open-external"; url: string }
  | { type: "copy"; text: string; toastLabel: string }
  | { type: "navigate"; href: string };

export interface PrStatusMenuModelItem {
  id: string;
  label: string;
  description?: string;
  danger?: boolean;
  action: PrStatusMenuAction;
}

export function asPrChecksState(value: string | null | undefined): PrChecksMenuState | null {
  if (value === "passing" || value === "failing" || value === "pending" || value === "none") return value;
  return null;
}

function safeBranch(branch: string | null | undefined): string | null {
  const trimmed = branch?.trim();
  if (!trimmed || trimmed.length > 250) return null;
  if (trimmed.startsWith("-")) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function safeLocalRepoName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed || !/^[\w.-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function resolvePrStatusRef(
  target: Pick<PrStatusMenuTarget, "url" | "repo" | "number">,
): { repo: string; number: number } | null {
  if (target.repo && target.number && /^[\w.-]+\/[\w.-]+$/.test(target.repo)) {
    const fromParts = parseGithubPrUrl(`https://github.com/${target.repo}/pull/${target.number}`);
    if (fromParts) return fromParts;
  }
  return parseGithubPrUrl(target.url);
}

/** Canonical https://github.com/{repo}/pull/{n}, or null when it isn't a PR URL. */
export function canonicalPrUrl(target: Pick<PrStatusMenuTarget, "url" | "repo" | "number">): string | null {
  const ref = resolvePrStatusRef(target);
  if (!ref) return null;
  return `https://github.com/${ref.repo}/pull/${ref.number}`;
}

export function githubPrChecksUrl(target: Pick<PrStatusMenuTarget, "url" | "repo" | "number">): string | null {
  const url = canonicalPrUrl(target);
  return url ? `${url}/checks` : null;
}

export function githubActionsUrl(repo: string, branch?: string | null): string | null {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  const base = `https://github.com/${repo}/actions`;
  const head = safeBranch(branch);
  if (!head) return base;
  return `${base}?query=${encodeURIComponent(`branch:${head}`)}`;
}

export function devhubRepoHref(localRepoName: string): string | null {
  const name = safeLocalRepoName(localRepoName);
  if (!name) return null;
  return `/repos/${encodeURIComponent(name)}`;
}

/** Filter the Pull requests page to this PR. `owner/repo#n` is add-mode in the search box, so the query is two terms. */
export function devhubPullRequestsHref(repo: string, number: number): string | null {
  const ref = resolvePrStatusRef({ url: `https://github.com/${repo}/pull/${number}`, repo, number });
  if (!ref) return null;
  return `/prs?q=${encodeURIComponent(`${ref.repo} ${ref.number}`)}`;
}

function checksDescription(target: PrStatusMenuTarget): string {
  const counts = target.checkCounts;
  if (counts) return `${counts.failed} failed, ${counts.passed} passed, ${counts.pending} pending`;
  return "Checks tab for this pull request";
}

export function buildPrStatusMenuModel(target: PrStatusMenuTarget): PrStatusMenuModelItem[] {
  const ref = resolvePrStatusRef(target);
  const prUrl = canonicalPrUrl(target);
  if (!prUrl || !ref) return [];

  const failing = target.checks === "failing";
  const checksUrl = githubPrChecksUrl(target);
  const actionsUrl = githubActionsUrl(ref.repo, target.branch);
  const branch = safeBranch(target.branch);
  const repoHref = target.localRepoName ? devhubRepoHref(target.localRepoName) : null;
  const prsHref = devhubPullRequestsHref(ref.repo, ref.number);

  const items: PrStatusMenuModelItem[] = [
    {
      id: "open-pr",
      label: "Open PR in GitHub",
      description: `${ref.repo}#${ref.number}`,
      action: { type: "open-external", url: prUrl },
    },
  ];

  if (checksUrl) {
    items.push({
      id: "open-checks",
      label: failing ? "Open failing checks" : "Open checks",
      description: checksDescription(target),
      ...(failing ? { danger: true } : {}),
      action: { type: "open-external", url: checksUrl },
    });
  }

  if (actionsUrl) {
    items.push({
      id: "open-actions",
      label: "Open CI runs",
      description: branch ? `Actions for ${branch}` : "GitHub Actions for this repository",
      action: { type: "open-external", url: actionsUrl },
    });
  }

  items.push({
    id: "copy-link",
    label: "Copy PR link",
    action: { type: "copy", text: prUrl, toastLabel: "PR link" },
  });

  items.push({
    id: "copy-ref",
    label: "Copy PR reference",
    description: `${ref.repo}#${ref.number}`,
    action: { type: "copy", text: `${ref.repo}#${ref.number}`, toastLabel: "PR reference" },
  });

  if (branch) {
    items.push({
      id: "copy-branch",
      label: "Copy branch name",
      description: branch,
      action: { type: "copy", text: branch, toastLabel: "branch name" },
    });
  }

  if (repoHref && target.localRepoName) {
    items.push({
      id: "open-devhub-repo",
      label: "Open repo in DevHub",
      description: target.localRepoName,
      action: { type: "navigate", href: repoHref },
    });
  }

  if (prsHref) {
    items.push({
      id: "open-devhub-prs",
      label: "Open in Pull requests",
      description: "Filter the Pull requests page to this PR",
      action: { type: "navigate", href: prsHref },
    });
  }

  return items;
}
