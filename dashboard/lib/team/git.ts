import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execExternal } from "@/lib/exec-external";
import { agentWorktreeDirName, agentWorktreeRoot } from "@/lib/agent-runs/git";
import { worktreePathError } from "@/lib/repos/worktree-parsers";

async function git(cwd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  const result = await execExternal("git", args, { cwd, timeoutMs, label: "git:team-handoff", maxBuffer: 4 * 1024 * 1024 });
  return result.stdout;
}
export function normaliseGitOrigin(origin: string): string {
  const value = origin.trim().replace(/^git@([^:]+):/, "ssh://git@$1/");
  try {
    const url = new URL(value);
    if (!["https:", "ssh:", "http:"].includes(url.protocol) || url.password || (url.username && url.username !== "git") || url.search || url.hash) throw new Error("Use a repository origin without credentials.");
    return (url.hostname.toLowerCase() + url.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "")).toLowerCase();
  } catch (error) {
    if (path.isAbsolute(value)) return path.resolve(value).replace(/\.git$/, "");
    throw error;
  }
}
export async function validateHandoffBranch(cwd: string, branch: string): Promise<void> {
  if (!branch || branch.length > 255 || branch.startsWith("-") || branch === "HEAD" || /[\s\x00-\x1f~^:?*\[\\]/.test(branch) || branch.includes("..") || branch.includes("@{")) throw new Error("Choose a valid task branch.");
  await git(cwd, ["check-ref-format", "--branch", branch]);
}
const SECRET_PATH = /(^|\/)(\.env(\.[^/]*)?|\.devhub(\/.*)?|\.npmrc|id_(rsa|ed25519|ecdsa)|[^/]*\.(pem|key|p12|pfx))$/i;
export function looksSecret(file: string): boolean { return SECRET_PATH.test(file.replace(/\/$/, "")); }
export interface HandoffGitState { cwd: string; branch: string; repo: string; files: string[]; fingerprint: string }
export async function inspectHandoffGit(cwd: string, expectedBranch?: string): Promise<HandoffGitState> {
  const branch = (await git(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
  await validateHandoffBranch(cwd, branch);
  if (expectedBranch && expectedBranch !== branch) throw new Error("The checkout is not on this task's branch. Nothing was pushed.");
  const repo = normaliseGitOrigin(await git(cwd, ["remote", "get-url", "origin"]));
  const status = await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const entries = status.split("\0").filter(Boolean);
  const files: string[] = [];
  const hash = createHash("sha256").update(branch).update(repo).update(status).update(await git(cwd, ["rev-parse", "HEAD"]));
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const name = entry.slice(3);
    files.push(name);
    if (entry.startsWith("??")) {
      const full = path.resolve(cwd, name);
      if (!full.startsWith(path.resolve(cwd) + path.sep)) throw new Error("Invalid untracked path.");
      const stat = await fs.lstat(full);
      hash.update(stat.isSymbolicLink() ? await fs.readlink(full) : await fs.readFile(full));
    }
    if (/^[RC]|^.[RC]/.test(entry)) index++;
  }
  hash.update(await git(cwd, ["diff", "--binary", "HEAD", "--"]));
  return { cwd, branch, repo, files, fingerprint: hash.digest("hex") };
}
export async function pushHandoffBranch(state: HandoffGitState, name: string, commitWip: boolean): Promise<void> {
  const fresh = await inspectHandoffGit(state.cwd, state.branch);
  if (fresh.fingerprint !== state.fingerprint) throw new Error("The checkout changed. Review a new handoff confirmation.");
  if (fresh.files.length) {
    if (!commitWip) throw new Error("Review and confirm Commit WIP and push first.");
    if (!/^[a-zA-Z0-9_. -]{1,200}$/.test(name)) throw new Error("Invalid teammate name.");
    const secret = fresh.files.find(looksSecret);
    if (secret) throw new Error(secret + " looks private, so Commit WIP stopped. Commit or remove it yourself, then hand off again.");
    await git(state.cwd, ["add", "--all", "--"]);
    await git(state.cwd, ["commit", "-m", "WIP: handoff to @" + name], 120_000);
  }
  const beforePush = await inspectHandoffGit(state.cwd, state.branch);
  if (beforePush.files.length) throw new Error("Files changed while committing. Review a new handoff confirmation.");
  await git(state.cwd, ["push", "--no-follow-tags", "-u", "origin", "refs/heads/" + state.branch + ":refs/heads/" + state.branch], 120_000);
  const after = await inspectHandoffGit(state.cwd, state.branch);
  if (after.fingerprint !== beforePush.fingerprint) throw new Error("The checkout changed while pushing. Review a new handoff confirmation.");
}
export async function fetchHandoffWorktree(cwd: string, branch: string, handoffId: string): Promise<{ cwd: string; branch: string }> {
  await validateHandoffBranch(cwd, branch);
  if (!/^[a-f0-9-]{36}$/.test(handoffId)) throw new Error("Invalid handoff id.");
  const remoteRef = "refs/remotes/origin/" + branch;
  await git(cwd, ["fetch", "--no-tags", "origin", "+refs/heads/" + branch + ":" + remoteRef], 120_000);
  const commit = (await git(cwd, ["rev-parse", "--verify", remoteRef + "^{commit}"])).trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Invalid fetched commit.");
  const repoRoot = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  const leaf = agentWorktreeDirName("handoff-" + handoffId, repoRoot);
  const destination = path.join(agentWorktreeRoot(repoRoot), leaf);
  const error = worktreePathError(repoRoot, destination);
  if (error) throw new Error(error);
  try {
    await fs.access(destination);
    const current = (await git(destination, ["symbolic-ref", "--short", "HEAD"])).trim();
    if (current !== branch) throw new Error("The pickup worktree already exists with different work. Check it before retrying.");
    return { cwd: destination, branch };
  } catch (accessError) {
    if (!(accessError instanceof Error) || !("code" in accessError) || accessError.code !== "ENOENT") throw accessError;
  }
  // Work continues on the owner's branch name so pushes update the same remote branch and PR.
  const local = await git(cwd, ["rev-parse", "--verify", "--quiet", "refs/heads/" + branch + "^{commit}"]).then((out) => out.trim(), () => "");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (!local) {
    await git(repoRoot, ["worktree", "add", "--track", "-b", branch, destination, remoteRef]);
  } else {
    if (local !== commit) {
      const ancestor = await git(cwd, ["merge-base", "--is-ancestor", local, commit]).then(() => true, () => false);
      if (!ancestor) throw new Error("You already have " + branch + " with different commits. Sort that branch out, then click Pick up again.");
    }
    await git(repoRoot, ["worktree", "add", destination, branch]);
    if (local !== commit) await git(destination, ["merge", "--ff-only", remoteRef]);
    await git(destination, ["branch", "--set-upstream-to=origin/" + branch]);
  }
  return { cwd: destination, branch };
}
export async function gitOrigin(cwd: string): Promise<string> {
  return normaliseGitOrigin(await git(cwd, ["remote", "get-url", "origin"]));
}

