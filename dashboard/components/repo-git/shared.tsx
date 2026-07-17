"use client";

import type { ReactNode } from "react";
import {
  parseHookFailurePayload,
  type GitHookFailurePayload,
} from "@/lib/git-hook-failure";
import type { StashConflictPayload } from "@/app/repos/types";

/* ─── Shared types ─── */

export type RepoGitTabId = "changes" | "branches" | "stash" | "history" | "conflicts" | "blame";

export interface StatusFile {
  path: string;
  status: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface StatusPayload {
  currentBranch: string;
  files: StatusFile[];
  staged: StatusFile[];
  unstaged: StatusFile[];
  conflictCount: number;
  /** DevHub repo only: dirty personal-content files (notes / tasks / docs / diagrams)
   * hidden from Changes — they sync via the top-bar content-sync button. */
  contentSyncCount?: number;
  clean: boolean;
}

export interface BranchInfo {
  name: string;
  current: boolean;
}

export interface BranchesPayload {
  branches: BranchInfo[];
  currentBranch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  stashCount: number;
  hasChanges: boolean;
  unpushedCommits: { hash: string; shortHash: string; subject: string; files: string[] }[];
}

export type CommitMode = "commit-and-push" | "commit-only";

/* ─── Panel props shared by every tab ─── */

export interface GitPanelHandlers {
  onMutate: () => void;
  onConflict: (c: StashConflictPayload) => Promise<void>;
  onHookFailure: (f: GitHookFailurePayload) => void;
}

/* ─── API helpers ─── */

/** Build a repo-scoped API url: repoApi("web", "/git/status"). */
export function repoApi(repoName: string, suffix: string): string {
  return `/api/repos/${encodeURIComponent(repoName)}${suffix}`;
}

export function errorMessageFromBody(body: string, status: number): string {
  try {
    const json = JSON.parse(body) as { error?: string };
    if (json.error) return json.error;
  } catch {
    // fall through
  }
  return body || `HTTP ${status}`;
}

export async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return errorMessageFromBody(text, res.status);
}

export function parseStashConflict(body: string): StashConflictPayload | null {
  try {
    const json = JSON.parse(body) as Partial<StashConflictPayload>;
    if (json.code !== "stash_conflict") return null;
    return {
      code: "stash_conflict",
      action: json.action === "stash-apply" ? "stash-apply" : "checkout",
      branch: typeof json.branch === "string" ? json.branch : undefined,
      switched: Boolean(json.switched),
      conflictFiles: Array.isArray(json.conflictFiles)
        ? json.conflictFiles.filter((f): f is string => typeof f === "string")
        : [],
      error: typeof json.error === "string" ? json.error : "Stash apply left conflicts",
    };
  } catch {
    return null;
  }
}

/** GET a git API payload; throws a user-facing Error on failure. */
export async function fetchGitJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export type GitActionFailure =
  | { kind: "conflict"; conflict: StashConflictPayload }
  | { kind: "hook"; hook: GitHookFailurePayload }
  | { kind: "error"; message: string; status: number };

export type GitActionResult<T> = { ok: true; json: T } | ({ ok: false } & GitActionFailure);

/**
 * POST a git mutation and classify the three failure shapes the API can
 * return — stash conflicts (409), hook failures (422), and plain errors —
 * so panels don't each re-implement the parse chain.
 */
export async function postGitAction<T = Record<string, unknown>>(
  url: string,
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<GitActionResult<T>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  if (res.ok) {
    const json = (await res.json().catch(() => ({}))) as T;
    return { ok: true, json };
  }
  const text = await res.text().catch(() => "");
  if (res.status === 409) {
    const conflict = parseStashConflict(text);
    if (conflict) return { ok: false, kind: "conflict", conflict };
  }
  const hook = parseHookFailurePayload(text);
  if (hook) return { ok: false, kind: "hook", hook };
  return { ok: false, kind: "error", message: errorMessageFromBody(text, res.status), status: res.status };
}

/* ─── Local preferences ─── */

const FULLSCREEN_PREF_KEY = "devhub.repo-git.fullscreen";
const COMMIT_MODE_PREF_KEY = "devhub.repo-git.commit-mode";

export function readFullscreenPref(): boolean {
  try {
    return window.localStorage.getItem(FULLSCREEN_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeFullscreenPref(next: boolean) {
  try {
    window.localStorage.setItem(FULLSCREEN_PREF_KEY, next ? "1" : "0");
  } catch {
    // private mode / blocked storage — preference is best-effort
  }
}

export function readCommitModePref(): CommitMode {
  try {
    return window.localStorage.getItem(COMMIT_MODE_PREF_KEY) === "commit-only"
      ? "commit-only"
      : "commit-and-push";
  } catch {
    return "commit-and-push";
  }
}

export function writeCommitModePref(next: CommitMode) {
  try {
    window.localStorage.setItem(COMMIT_MODE_PREF_KEY, next);
  } catch {
    // private mode / blocked storage — preference is best-effort
  }
}

/* ─── Tiny shared UI ─── */

export function IconBtn({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost repo-git-icon-btn"
      data-danger={danger || undefined}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
