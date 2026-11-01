import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Task } from "../../../../../packages/shared/tasks/types.ts";
import { isTaskOpen, isTaskOwnershipBlocked } from "../../../../../packages/shared/tasks/types.ts";
import type { ServiceGitRequest, ServiceGitReview, ServicePickupCheckout } from "../../../../../packages/shared/plugin-runtime";
import { agentWorktreeDirName, agentWorktreeRoot } from "../agent-runs/git";
import { execExternal } from "../exec-external";
import { gitEnv } from "../git/repo-local";
import { withRepoGitMutation } from "../git/mutation-queue";
import { getReposScanDir, listRepos } from "../repos/index";
import { parseWorktreeList, worktreePathError } from "../../../../../packages/shared/ui-lib/repos/worktree-parsers";
import { runtimeServiceTaskContext } from "./runtime-service-task-context";
import { assertSafePath } from "./filesystem";

const secretPath = /(^|\/)(\.env(\.[^/]*)?|\.devhub(\/.*)?|\.npmrc|id_(rsa|ed25519|ecdsa)|[^/]*\.(pem|key|p12|pfx))$/i;

async function git(cwd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  const result = await execExternal("git", args, { cwd, env: gitEnv(), timeoutMs, maxBuffer: 8 * 1024 * 1024, label: "git:plugin-service" });
  return result.stdout;
}

function originId(raw: string): string {
  const value = raw.trim().replace(/^git@([^:]+):/, "ssh://git@$1/");
  if (path.isAbsolute(value)) return path.resolve(value).replace(/\.git\/?$/, "");
  const url = new URL(value);
  if (!["https:", "http:", "ssh:"].includes(url.protocol) || url.password || (url.username && url.username !== "git") || url.search || url.hash) throw new Error("Unsupported repository origin");
  return (url.host + url.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "")).toLowerCase();
}

async function repos() {
  const found = await Promise.allSettled((await listRepos()).filter((repo) => !repo.worktreeOf).map(async (repo) => ({ path: repo.path, name: repo.name, origin: originId(await git(repo.path, ["remote", "get-url", "origin"])) })));
  return found.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

async function repoFor(origin: string) {
  const matches = (await repos()).filter((repo) => repo.origin === origin);
  if (matches.length !== 1) throw new Error("The repository is missing or ambiguous");
  return matches[0];
}

async function validateBranch(cwd: string, branch: string) {
  // eslint-disable-next-line no-control-regex -- Git branch names cannot contain control characters.
  if (!branch || branch.length > 255 || branch.startsWith("-") || branch === "HEAD" || /[\s\x00-\x1f~^:?*[\\]/.test(branch) || branch.includes("..") || branch.includes("@{")) throw new Error("Invalid branch");
  await git(cwd, ["check-ref-format", "--branch", branch]);
}

function pickupPath(repoPath: string, handoffId: string) {
  return path.join(agentWorktreeRoot(repoPath), agentWorktreeDirName("handoff-" + handoffId, repoPath));
}

export async function assertPickupCheckout(checkout: ServicePickupCheckout, handoffId: string, origin: string): Promise<string> {
  const repo = await repoFor(origin);
  const root = (await git(repo.path, ["rev-parse", "--show-toplevel"])).trim();
  if (path.resolve(checkout.cwd) !== path.resolve(pickupPath(root, handoffId))) throw new Error("The pickup checkout is not managed by DevHub");
  assertSafePath(getReposScanDir(), checkout.cwd);
  await validateBranch(root, checkout.branch);
  const trees = parseWorktreeList(await git(root, ["worktree", "list", "--porcelain"]));
  if (!trees.some((tree) => path.resolve(tree.path) === path.resolve(checkout.cwd) && tree.branch === checkout.branch && !tree.prunable)) throw new Error("The pickup worktree changed");
  if ((await git(checkout.cwd, ["symbolic-ref", "--short", "HEAD"])).trim() !== checkout.branch) throw new Error("The pickup branch changed");
  const rootCommon = (await git(root, ["rev-parse", "--git-common-dir"])).trim();
  const pickupCommon = (await git(checkout.cwd, ["rev-parse", "--git-common-dir"])).trim();
  if (await fs.realpath(path.resolve(root, rootCommon)) !== await fs.realpath(path.resolve(checkout.cwd, pickupCommon))) throw new Error("The pickup belongs to another repository");
  return repo.name;
}

interface Snapshot { cwd: string; branch: string; repo: string; files: string[]; fingerprint: string; contentFingerprint: string }
async function snapshot(cwd: string, branch: string): Promise<Snapshot> {
  if ((await git(cwd, ["symbolic-ref", "--short", "HEAD"])).trim() !== branch) throw new Error("The checkout branch changed");
  await validateBranch(cwd, branch);
  const repo = originId(await git(cwd, ["remote", "get-url", "origin"]));
  const status = await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const entries = status.split("\0").filter(Boolean);
  const files: string[] = [];
  const head = await git(cwd, ["rev-parse", "HEAD"]);
  const hash = crypto.createHash("sha256").update(branch).update(repo).update(status).update(head);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const name = entry.slice(3);
    files.push(name);
    if (/^[RC]|^.[RC]/.test(entry)) {
      const original = entries[++index];
      if (!original) throw new Error("Incomplete Git status");
      files.push(original);
    }
    if (entry.startsWith("??")) {
      const full = path.resolve(cwd, name);
      if (!full.startsWith(path.resolve(cwd) + path.sep)) throw new Error("Invalid untracked path");
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) hash.update(await fs.readlink(full));
      else if (stat.isFile() && stat.size <= 16 * 1024 * 1024) hash.update(await fs.readFile(full));
      else throw new Error("An untracked file is too large or unsupported");
    }
  }
  const gitlinks = (await git(cwd, ["ls-files", "--stage"])).split("\n").filter((line) => line.startsWith("160000 ")).map((line) => line.slice(line.indexOf("\t") + 1));
  if (files.some((file) => gitlinks.includes(file))) throw new Error("Review submodule changes separately");
  hash.update(await git(cwd, ["diff", "--binary", "HEAD", "--"]));
  const content = crypto.createHash("sha256").update(branch).update(repo).update(head);
  for (const name of [...new Set(files)].sort()) {
    const full = path.resolve(cwd, name);
    if (!full.startsWith(path.resolve(cwd) + path.sep)) throw new Error("Invalid changed path");
    content.update(name).update("\0");
    try {
      const stat = await fs.lstat(full);
      content.update(String(stat.mode)).update("\0");
      if (stat.isSymbolicLink()) content.update(await fs.readlink(full));
      else if (stat.isFile() && stat.size <= 16 * 1024 * 1024) content.update(await fs.readFile(full));
      else throw new Error("A changed file is too large or unsupported");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      content.update("deleted");
    }
    content.update("\0");
  }
  return { cwd, branch, repo, files, fingerprint: hash.digest("hex"), contentFingerprint: content.digest("hex") };
}

function taskFingerprint(task: Task): string {
  return crypto.createHash("sha256").update(JSON.stringify({ ...task, handoff: undefined })).digest("hex");
}

interface Review { taskId: string; createdAt: string; profile: string; taskFingerprint: string; snapshot: Snapshot; expires: number }
export class RuntimeServiceGit {
  private reviews = new Map<string, Review>();

  async operation(request: ServiceGitRequest, task: Task | null, directory: string, authorised: () => boolean): Promise<unknown> {
    const check = () => { if (!authorised()) throw new Error("Service authorisation changed"); };
    check();
    if (request.operation === "git-repos") { const found = await repos(); check(); return found; }
    if (request.operation === "git-pickup") {
      const repo = await repoFor(request.repo);
      await validateBranch(repo.path, request.branch);
      check();
      return withRepoGitMutation(repo.path, async () => {
        check();
        const root = (await git(repo.path, ["rev-parse", "--show-toplevel"])).trim();
        const destination = pickupPath(root, request.handoffId);
        assertSafePath(getReposScanDir(), destination);
        const error = worktreePathError(root, destination);
        if (error) throw new Error(error);
        const remote = "refs/remotes/origin/" + request.branch;
        await git(root, ["fetch", "--no-tags", "origin", "+refs/heads/" + request.branch + ":" + remote], 120_000);
        check();
        const commit = (await git(root, ["rev-parse", "--verify", remote + "^{commit}"])).trim();
        if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Invalid fetched commit");
        const trees = parseWorktreeList(await git(root, ["worktree", "list", "--porcelain"]));
        const existing = trees.find((tree) => path.resolve(tree.path) === path.resolve(destination));
        if (existing) {
          if (existing.branch !== request.branch || existing.prunable) throw new Error("The pickup worktree contains different work");
          await assertPickupCheckout({ cwd: destination, branch: request.branch }, request.handoffId, request.repo);
          check();
          return { cwd: destination, branch: request.branch };
        }
        const local = await git(root, ["rev-parse", "--verify", "--quiet", "refs/heads/" + request.branch + "^{commit}"]).then((value) => value.trim(), () => "");
        if (local && local !== commit) {
          const ancestor = await git(root, ["merge-base", "--is-ancestor", local, commit]).then(() => true, () => false);
          if (!ancestor) throw new Error("The local branch contains different commits");
        }
        check();
        await fs.mkdir(path.dirname(destination), { recursive: true });
        if (!local) await git(root, ["worktree", "add", "--track", "-b", request.branch, destination, remote]);
        else {
          await git(root, ["worktree", "add", destination, request.branch]);
          check();
          if (local !== commit) await git(destination, ["merge", "--ff-only", remote]);
          check();
          await git(destination, ["branch", "--set-upstream-to=origin/" + request.branch]);
        }
        check();
        return { cwd: destination, branch: request.branch };
      });
    }
    if (!task || task.id !== request.taskId || task.createdAt !== request.createdAt || !isTaskOpen(task)) throw new Error("The task changed");
    if (request.operation === "git-inspect") {
      if (isTaskOwnershipBlocked(task)) throw new Error("The task is read-only");
      const context = await runtimeServiceTaskContext(task, directory, request.profile);
      if (!context.cwd || path.resolve(context.cwd) !== path.resolve(request.cwd)) throw new Error("The checkout is not linked to the task");
      const state = await snapshot(request.cwd, request.branch);
      check();
      for (const [key, review] of this.reviews) if (review.expires < Date.now()) this.reviews.delete(key);
      if (this.reviews.size >= 100) throw new Error("Too many pending Git reviews");
      const review = crypto.randomBytes(32).toString("hex");
      this.reviews.set(review, { taskId: task.id, createdAt: task.createdAt, profile: request.profile, taskFingerprint: taskFingerprint(task), snapshot: state, expires: Date.now() + 15 * 60_000 });
      return { cwd: state.cwd, branch: state.branch, repo: state.repo, files: state.files, fingerprint: state.fingerprint, review } satisfies ServiceGitReview;
    }
    const review = this.reviews.get(request.review);
    if (!review || review.expires < Date.now() || review.taskId !== task.id || review.createdAt !== task.createdAt || review.profile !== request.profile || review.taskFingerprint !== taskFingerprint(task) || task.handoff?.handoffId !== request.handoffId || task.handoff.status !== "pending") throw new Error("The handoff review changed or expired");
    return withRepoGitMutation(review.snapshot.cwd, async () => {
      check();
      const before = await snapshot(review.snapshot.cwd, review.snapshot.branch);
      if (before.fingerprint !== review.snapshot.fingerprint) throw new Error("The checkout changed after review");
      if (before.files.length && !request.commitWip) throw new Error("Uncommitted changes need a reviewed WIP commit");
      const secret = before.files.find((file) => secretPath.test(file));
      if (secret) throw new Error("A changed file looks private");
      check();
      if (before.files.length) {
        await git(before.cwd, ["add", "--all", "--"]);
        check();
        const staged = await snapshot(before.cwd, before.branch);
        if (staged.contentFingerprint !== before.contentFingerprint || staged.files.some((file) => secretPath.test(file))) throw new Error("The checkout changed while staging");
        await git(before.cwd, ["commit", "-m", "WIP: handoff to @" + request.recipient], 120_000);
      }
      check();
      const ready = await snapshot(before.cwd, before.branch);
      if (ready.files.length || ready.repo !== before.repo) throw new Error("The checkout changed while committing");
      review.snapshot = ready;
      check();
      await git(before.cwd, ["push", "--no-follow-tags", "-u", "origin", "refs/heads/" + before.branch + ":refs/heads/" + before.branch], 120_000);
      const after = await snapshot(before.cwd, before.branch);
      if (after.fingerprint !== ready.fingerprint) throw new Error("The checkout changed while pushing");
      check();
      this.reviews.delete(request.review);
      return { branch: before.branch, repo: before.repo };
    });
  }
}
