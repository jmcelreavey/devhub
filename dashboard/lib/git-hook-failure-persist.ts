import fs from "node:fs";
import path from "node:path";
import {
  HOOK_FAILURE_LOG_REL,
  type GitHookFailurePayload,
} from "./git-hook-failure";

/** Write full hook output under `.git/` so the AI handoff can `cat` a short path. */
export function persistHookFailureLog(repoRoot: string, output: string): string {
  const abs = path.join(repoRoot, HOOK_FAILURE_LOG_REL);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${output.trimEnd()}\n`, "utf8");
  } catch {
    // Best-effort — UI still has the payload output.
  }
  return HOOK_FAILURE_LOG_REL;
}

export function withPersistedLog(
  repoRoot: string,
  failure: GitHookFailurePayload,
): GitHookFailurePayload {
  const logPath = persistHookFailureLog(repoRoot, failure.output);
  return { ...failure, logPath };
}
