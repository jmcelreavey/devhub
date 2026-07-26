/**
 * Generating an Upstart is not the same act as running one.
 *
 * Until now they were a single shell command:
 *
 *     agent "...write the script..." && bash upstarts/<repo>/upstart.sh
 *
 * That `&&` is the problem. An agent writes a shell script and the terminal
 * executes it in the same breath, with the user's full environment and their
 * repository as the working directory. Nobody reads it, because there is no
 * moment at which it exists and has not yet run.
 *
 * The model here is: generated shell is **untrusted code the user may choose to
 * approve**. Generate, show it in full, require an explicit approval that names
 * the exact bytes approved, then run. Editing it or regenerating it revokes the
 * approval, because otherwise "approved" would mean "approved something, once".
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getUpstartsDir } from "@/lib/content/dirs";
import { getReposDir } from "@/lib/desktop/runtime-paths";

export interface UpstartApproval {
  repo: string;
  /** SHA-256 of the exact script bytes the user approved. */
  scriptSha256: string;
  approvedAt: string;
}

export type UpstartState =
  | { status: "missing" }
  | { status: "needs-review"; script: string; sha256: string; previouslyApproved: boolean }
  | { status: "approved"; script: string; sha256: string; approvedAt: string };

/**
 * Resolve a repo name to a path, refusing anything that isn't a direct child
 * of the code folder.
 *
 * The repo name reaches this from the client, and it ends up as a working
 * directory for a shell. `..` traversal, an absolute path, or a nested path
 * would each turn "run my project" into "run a shell wherever you like".
 */
export function resolveRepoPath(repoName: string): string {
  const trimmed = repoName.trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed) || trimmed.includes("..")) {
    throw new Error("Invalid repository name");
  }
  const base = getReposDir();
  const resolved = path.resolve(path.join(base, trimmed));
  // Compare resolved parents rather than string prefixes: a symlink or a
  // cleverly composed name must not escape, and `/code-evil` starts with
  // `/code`.
  if (path.dirname(resolved) !== path.resolve(base)) {
    throw new Error("Repository must be a direct child of your code folder");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error("Repository does not exist");
  }
  return resolved;
}

export function upstartScriptPath(repoName: string): string {
  const trimmed = repoName.trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed) || trimmed.includes("..")) {
    throw new Error("Invalid repository name");
  }
  // Scripts live in DevHub's own store, never inside the target repository —
  // a generated control file appearing in someone's git status is a surprise
  // they did not ask for.
  return path.join(getUpstartsDir(), trimmed, "upstart.sh");
}

function approvalsFile(): string {
  return path.join(getUpstartsDir(), ".approvals.json");
}

export function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

function readApprovals(): UpstartApproval[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(approvalsFile(), "utf-8"));
    return Array.isArray(parsed) ? (parsed as UpstartApproval[]) : [];
  } catch {
    return [];
  }
}

function writeApprovals(list: UpstartApproval[]): void {
  fs.mkdirSync(path.dirname(approvalsFile()), { recursive: true, mode: 0o700 });
  fs.writeFileSync(approvalsFile(), `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
}

/**
 * What state is this repo's Upstart in?
 *
 * Approval is keyed on the script's hash, not on the repo name. That is the
 * whole mechanism: if the file changes by so much as a byte — the agent
 * regenerated it, the user edited it, something else wrote to it — the stored
 * hash no longer matches and it needs reviewing again. Approving a filename
 * once would approve every future version of it.
 */
export function upstartState(repoName: string): UpstartState {
  const scriptPath = upstartScriptPath(repoName);
  let script: string;
  try {
    script = fs.readFileSync(scriptPath, "utf-8");
  } catch {
    return { status: "missing" };
  }

  const hash = sha256(script);
  const approval = readApprovals().find((a) => a.repo === repoName);

  if (approval?.scriptSha256 === hash) {
    return { status: "approved", script, sha256: hash, approvedAt: approval.approvedAt };
  }
  return {
    status: "needs-review",
    script,
    sha256: hash,
    // Distinguishes "you have never seen this" from "this changed since you
    // approved it" — the second deserves a diff, not a fresh introduction.
    previouslyApproved: approval !== undefined,
  };
}

/**
 * Record approval of specific bytes.
 *
 * The caller passes the hash it displayed. If the file changed between being
 * rendered and being approved — an agent still writing, a concurrent edit —
 * the hashes disagree and approval is refused. Approving what was shown, not
 * what happens to be on disk now, is the point.
 */
export function approveUpstart(repoName: string, expectedSha256: string): UpstartState {
  const state = upstartState(repoName);
  if (state.status === "missing") {
    throw new Error("There is no Upstart script to approve");
  }
  if (state.sha256 !== expectedSha256) {
    throw new Error(
      "The script changed since it was shown to you. Review it again before approving.",
    );
  }

  const approvals = readApprovals().filter((a) => a.repo !== repoName);
  approvals.push({
    repo: repoName,
    scriptSha256: state.sha256,
    approvedAt: new Date().toISOString(),
  });
  writeApprovals(approvals);

  return { status: "approved", script: state.script, sha256: state.sha256, approvedAt: new Date().toISOString() };
}

/** Withdraw approval — used when a script is regenerated or edited. */
export function revokeApproval(repoName: string): void {
  writeApprovals(readApprovals().filter((a) => a.repo !== repoName));
}

/**
 * The command to run an approved Upstart.
 *
 * Throws unless the exact current bytes are approved. This is the enforcement
 * point: every path to execution goes through here, so there is no route that
 * runs an unreviewed script.
 */
export function upstartRunCommand(repoName: string): { command: string; cwd: string } {
  const state = upstartState(repoName);
  if (state.status !== "approved") {
    throw new Error("This Upstart has not been approved yet. Review it first.");
  }
  const cwd = resolveRepoPath(repoName);
  const scriptPath = upstartScriptPath(repoName);
  // Plain bash, no elevation, working directory is the repo the user picked.
  return { command: `bash ${shellQuote(scriptPath)}`, cwd };
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
