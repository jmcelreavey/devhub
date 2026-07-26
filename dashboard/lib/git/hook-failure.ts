/**
 * Detect and format git hook failures (pre-commit, pre-push, husky, etc.).
 * Pure helpers — safe for client + unit tests. Persist helpers are server-only.
 */

export type GitHookPhase = "commit" | "amend" | "push" | "other";

export interface GitHookFailurePayload {
  code: "hook_failed";
  hook?: string;
  phase: GitHookPhase;
  output: string;
  summary?: string;
  /** Relative path under the repo where full output was written (if persisted). */
  logPath?: string;
}

export const HOOK_FAILURE_LOG_REL = ".git/devhub-hook-failure.log";

const NAMED_HOOKS = [
  "pre-push",
  "pre-commit",
  "commit-msg",
  "prepare-commit-msg",
  "pre-receive",
  "update",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "post-commit",
  "pre-applypatch",
  "post-applypatch",
] as const;

const NOISE_LINE =
  /^(npm (error|warn) |ELIFECYCLE|command not found: |Done in \d|yarn (error|warn) )/i;

/** Merge stdout/stderr the way hooks usually print (real signal often on stdout). */
export function combineGitStreams(stdout: string, stderr: string): string {
  const out = stdout.replace(/\r\n/g, "\n").trim();
  const err = stderr.replace(/\r\n/g, "\n").trim();
  if (out && err && out !== err) return `${out}\n${err}`;
  return out || err;
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

export function detectHookName(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const name of NAMED_HOOKS) {
    if (lower.includes(name)) return name;
  }
  if (/\bhusky\b/i.test(text)) return "husky";
  if (/\blefthook\b/i.test(text)) return "lefthook";
  return undefined;
}

function looksLikeHookFailure(text: string, phase: GitHookPhase): boolean {
  if (
    /hook declined|hook failed|husky -|lefthook|githooks\/|\.git\/hooks\/|\[pre-push\]|\[pre-commit\]|\[commit-msg\]/i.test(
      text,
    )
  ) {
    return true;
  }
  if (NAMED_HOOKS.some((h) => new RegExp(`\\b${h}\\b`, "i").test(text))) {
    return true;
  }
  // Push failed + verify/lint noise — typical DevHub pre-push hook dump.
  if (
    phase === "push" &&
    /failed to push some refs|error: failed to push/i.test(text) &&
    /verify failed|npm run.*verify|eslint|typecheck|vitest|leak scan|DEVHUB_SKIP_VERIFY/i.test(text)
  ) {
    return true;
  }
  if (
    (phase === "commit" || phase === "amend") &&
    /lint-staged|commitlint|pre-commit|husky/i.test(text)
  ) {
    return true;
  }
  return false;
}

/** Prefer a short human line when hooks emit a clear failure banner. */
export function summarizeHookFailure(text: string, hook?: string): string {
  const lines = stripAnsi(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const banner = lines.find((l) =>
    /verify failed|hook declined|hook failed|leak scan failed|commitlint|lint-staged/i.test(l),
  );
  if (banner) return banner.length > 160 ? `${banner.slice(0, 157)}…` : banner;
  const hookLabel = hook ?? "git hook";
  return `${hookLabel} failed`;
}

/**
 * Keep the useful tail of a hook dump: drop blank runs and obvious npm noise,
 * cap length so the UI stays readable.
 */
export function formatHookOutput(raw: string, maxLines = 120): string {
  const cleaned = stripAnsi(raw)
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .filter((l) => l.trim().length > 0)
    .filter((l) => !NOISE_LINE.test(l.trim()));
  if (cleaned.length === 0) return stripAnsi(raw).trim();
  const omitted = Math.max(0, cleaned.length - maxLines);
  const body = cleaned.slice(omitted);
  if (omitted > 0) {
    return [`[… ${omitted} earlier line(s) omitted]`, ...body].join("\n");
  }
  return body.join("\n");
}

export function detectGitHookFailure(
  stdout: string,
  stderr: string,
  phase: GitHookPhase,
): GitHookFailurePayload | null {
  const combined = combineGitStreams(stdout, stderr);
  if (!combined.trim()) return null;
  if (!looksLikeHookFailure(combined, phase)) return null;
  const hook =
    detectHookName(combined) ??
    (phase === "push" ? "pre-push" : phase === "commit" || phase === "amend" ? "pre-commit" : undefined);
  const output = formatHookOutput(combined);
  return {
    code: "hook_failed",
    hook,
    phase,
    output,
    summary: summarizeHookFailure(combined, hook),
  };
}

/** Parse a structured hook_failed JSON body (API or client). */
export function parseHookFailurePayload(body: string): GitHookFailurePayload | null {
  try {
    const json = JSON.parse(body) as Partial<GitHookFailurePayload>;
    if (json.code !== "hook_failed") return null;
    if (typeof json.output !== "string" || !json.output.trim()) return null;
    const phase: GitHookPhase =
      json.phase === "commit" || json.phase === "amend" || json.phase === "push" || json.phase === "other"
        ? json.phase
        : "other";
    return {
      code: "hook_failed",
      hook: typeof json.hook === "string" ? json.hook : undefined,
      phase,
      output: json.output,
      summary: typeof json.summary === "string" ? json.summary : undefined,
      logPath: typeof json.logPath === "string" ? json.logPath : undefined,
    };
  } catch {
    return null;
  }
}

/** Detect from a flat script/orchestrator log (single stream). */
export function detectGitHookFailureFromLog(log: string, phase: GitHookPhase): GitHookFailurePayload | null {
  return detectGitHookFailure(log, "", phase);
}

export function hookFailureTitle(failure: GitHookFailurePayload): string {
  const hook = failure.hook ?? "Git hook";
  const phase =
    failure.phase === "amend"
      ? "amend"
      : failure.phase === "commit"
        ? "commit"
        : failure.phase === "push"
          ? "push"
          : "git";
  return `${hook} failed during ${phase}`;
}
