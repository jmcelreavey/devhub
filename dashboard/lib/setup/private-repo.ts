import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { execExternal } from "@/lib/exec-external";
import { execGh, ghEnv } from "@/lib/gh-exec";
import { getAppDataDir, getCheckoutRoot, isDesktopRuntime } from "@/lib/desktop/runtime-paths";
import { patchDashboardEnvLocalFile, patchEnvFileKeys, readDashboardEnvLocalFile, DASHBOARD_MANAGED_ENV_KEYS } from "@/lib/dashboard-env-local";
import { assertGhAvailable, assertGitAvailable } from "@/lib/setup/git-check";
import { getNotesDir, getTasksDir, getCollectionsDir, getUpstartsDir, getRepsDir } from "@/lib/content/dirs";

const PUBLIC_REPO = "https://github.com/jmcelreavey/devhub.git";
const repoInfoSchema = z.object({ isPrivate: z.boolean(), url: z.string().url() });
const userSchema = z.object({ login: z.string().regex(/^[a-zA-Z0-9-]+$/), id: z.number().int(), name: z.string().nullable() });

export const PrivateRepoSetupSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/), directory: z.string().trim().min(1).max(4096) }),
  z.object({ action: z.literal("clone"), repository: z.string().regex(/^[a-zA-Z0-9-]+\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/), directory: z.string().trim().min(1).max(4096) }),
  z.object({ action: z.literal("link"), directory: z.string().trim().min(1).max(4096) }),
]);

async function git(directory: string, args: string[]): Promise<string> {
  const result = await execExternal("git", args, {
    cwd: directory, env: { ...ghEnv(), GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: 120_000, label: "setup:private-repo",
  });
  return result.stdout.trim();
}

/** Reject lookalike hosts, credentials in URLs, and non-GitHub origins. */
export function githubRepoFromOrigin(origin: string): string {
  const match = origin.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+?)(?:\.git)?$/);
  if (!match) throw new Error("Origin must be a GitHub repository URL.");
  return match[1];
}

async function privateRepoUrl(name: string): Promise<string> {
  const { stdout } = await execGh(["repo", "view", name, "--json", "isPrivate,url"]);
  const info = repoInfoSchema.parse(JSON.parse(stdout));
  if (!info.isPrivate) throw new Error("This repository is public. Choose a private DevHub copy before linking personal content.");
  if (githubRepoFromOrigin(info.url).toLowerCase() !== name.toLowerCase()) throw new Error("GitHub returned a different repository.");
  return info.url;
}

export async function assertPrivateRepo(directory: string): Promise<string> {
  const origin = await git(directory, ["remote", "get-url", "--push", "origin"]);
  const name = githubRepoFromOrigin(origin);
  if (githubRepoFromOrigin(await git(directory, ["remote", "get-url", "origin"])) !== name) {
    throw new Error("Origin must fetch and push the same private repository.");
  }
  const url = await privateRepoUrl(name);
  // An additional push URL could send a second copy somewhere else.
  const pushUrls = await git(directory, ["remote", "get-url", "--push", "--all", "origin"]);
  if (pushUrls.split("\n").length !== 1) throw new Error("Origin has multiple push URLs. Use one private remote.");
  return url;
}

/** Copy a new user's content without overwriting files or following symlinks. */
export async function copyPrivateContent(source: string, destination: string): Promise<void> {
  if (path.resolve(source) === path.resolve(destination)) return;
  let entries;
  try { entries = await fs.readdir(source, { withFileTypes: true }); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  try {
    const existing = await fs.lstat(destination);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error(`Destination is not a real directory: ${destination}`);
    }
  } catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
  await fs.mkdir(destination, { recursive: true });
  for (const entry of entries) {
    if (entry.name === ".gitkeep" || entry.name === ".DS_Store") continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Cannot copy symbolic link: ${from}. Your original content is unchanged.`);
    if (entry.isDirectory()) await copyPrivateContent(from, to);
    else if (entry.isFile()) {
      try { await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          if ((await fs.readFile(from)).equals(await fs.readFile(to))) continue;
          throw new Error(`Existing content at ${to} differs. Nothing was overwritten; your original content is unchanged.`);
        }
        throw err;
      }
    }
  }
}

async function assertDevHubCheckout(directory: string): Promise<void> {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8"));
  if (manifest.name !== "devhub") throw new Error("Choose a DevHub checkout, not another project's repository.");
  const top = await git(directory, ["rev-parse", "--show-toplevel"]);
  if (await fs.realpath(top) !== await fs.realpath(directory)) throw new Error("Choose the root of the DevHub checkout.");
}

async function linkContent(directory: string): Promise<void> {
  // Bundled code and credentials stay in their existing locations.
  patchDashboardEnvLocalFile((overrides) => {
    overrides.set("REPO_ROOT", directory);
    overrides.set("DEVHUB_CONTENT_ROOT", directory);
    overrides.set("NOTES_DIR", path.join(directory, "notes"));
    overrides.set("TASKS_DIR", path.join(directory, "tasks"));
    overrides.set("COLLECTIONS_DIR", path.join(directory, "collections"));
    overrides.set("UPSTARTS_DIR", path.join(directory, "upstarts"));
    overrides.set("REPS_DIR", path.join(directory, "reps"));
    // DOCS_DIR remains the packaged documentation tree.
  });
  const { overrides } = readDashboardEnvLocalFile();
  patchEnvFileKeys(path.join(getAppDataDir(), "config", ".env.local"), overrides, DASHBOARD_MANAGED_ENV_KEYS);
  // Separate from development attachment: WSL must keep using app config,
  // rather than switching to this clone's unconfigured dashboard/.env.local.
  await fs.writeFile(path.join(getAppDataDir(), "content-repo-path.txt"), directory, { mode: 0o600 });
}

async function configureGitIdentity(directory: string, user: z.infer<typeof userSchema>): Promise<void> {
  await git(directory, ["config", "user.name", user.name || user.login]);
  await git(directory, ["config", "user.email", `${user.id}+${user.login}@users.noreply.github.com`]);
}

/** Resolve symlinked parents even when the selected new folder does not exist. */
async function canonicalFuturePath(directory: string): Promise<string> {
  try { return await fs.realpath(directory); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const parent = path.dirname(directory);
    if (parent === directory) throw err;
    return path.join(await canonicalFuturePath(parent), path.basename(directory));
  }
}

/**
 * Where a new private checkout goes by default. `~/Developer` is a macOS
 * habit; the WSL launcher looks for a checkout under `~/dev`.
 */
export function suggestedPrivateRepoDirectory(home: string, platform: NodeJS.Platform = process.platform): string {
  return path.join(home, platform === "darwin" ? "Developer" : "dev", "devhub-private");
}

export const DEFAULT_PRIVATE_REPO_NAME = "devhub-private";
const remoteInfoSchema = z.object({ isPrivate: z.boolean(), isEmpty: z.boolean().optional(), url: z.string().url() });

export interface RemoteRepoState { exists: boolean; isPrivate: boolean; empty: boolean; url?: string }

/** Does `<login>/<name>` exist on GitHub? "Not found" is an answer; any other failure is not. */
export async function remoteRepoState(repository: string): Promise<RemoteRepoState> {
  try {
    const { stdout } = await execGh(["repo", "view", repository, "--json", "isPrivate,isEmpty,url"]);
    const info = remoteInfoSchema.parse(JSON.parse(stdout));
    return { exists: true, isPrivate: info.isPrivate, empty: info.isEmpty ?? false, url: info.url };
  } catch (err) {
    const text = `${err instanceof Error ? err.message : ""} ${(err as { stderr?: unknown }).stderr ?? ""}`;
    if (/could not resolve to a repository|http 404|not found/i.test(text)) return { exists: false, isPrivate: false, empty: false };
    throw err;
  }
}

/**
 * A repo that is already there and holds content cannot be created again; an
 * empty private one is what an earlier, interrupted attempt left behind, so a
 * retry reuses it.
 */
function remoteBlocksCreate(remote: RemoteRepoState): boolean {
  return remote.exists && !(remote.empty && remote.isPrivate);
}

async function pathExists(target: string): Promise<boolean> {
  try { await fs.access(target); return true; }
  catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return false; throw err; }
}

/** `devhub-private-2`, `-3`…: free both on GitHub and as a sibling folder. */
export async function suggestFreeRepoName(login: string, directory: string, base = DEFAULT_PRIVATE_REPO_NAME): Promise<{ name: string; directory: string } | undefined> {
  const parent = path.dirname(directory);
  for (let n = 2; n <= 9; n++) {
    const name = `${base}-${n}`;
    const candidate = path.join(parent, name);
    if (await pathExists(candidate)) continue;
    if ((await remoteRepoState(`${login}/${name}`)).exists) continue;
    return { name, directory: candidate };
  }
  return undefined;
}

export interface PrivateRepoTarget {
  directory: string;
  /** A git checkout is already there: link it. */
  existing: boolean;
  /** Something is at the folder (a checkout or not); the one-click create cannot use it. */
  folderExists: boolean;
  /** The default-named repo in the signed-in account, when GitHub could be asked. */
  remote?: { repository: string; exists: boolean; isPrivate: boolean; empty: boolean };
  /** A free name and folder when the defaults are taken. */
  suggestion?: { name: string; directory: string };
}

/** What the one-click defaults would hit, found out before anything is cloned. */
export async function describePrivateRepoTarget(directory: string, name = DEFAULT_PRIVATE_REPO_NAME): Promise<PrivateRepoTarget> {
  const target: PrivateRepoTarget = {
    directory,
    existing: await pathExists(path.join(directory, ".git")),
    folderExists: await pathExists(directory),
  };
  try {
    const user = userSchema.parse(JSON.parse((await execGh(["api", "user"])).stdout));
    const repository = `${user.login}/${name}`;
    const state = await remoteRepoState(repository);
    target.remote = { repository, exists: state.exists, isPrivate: state.isPrivate, empty: state.empty };
    if (target.folderExists || remoteBlocksCreate(state)) target.suggestion = await suggestFreeRepoName(user.login, directory, name);
  } catch {
    // Signed out, offline or no gh: the create attempt reports it; the form still works.
  }
  return target;
}

let setupRunning = false;

/** Never the filesystem root or the home folder, whatever the caller thinks it created. */
async function removeCreatedFolder(directory: string): Promise<boolean> {
  if (directory === path.parse(directory).root || directory === path.resolve(process.env.HOME ?? "/")) return false;
  try { await fs.rm(directory, { recursive: true, force: true }); return true; }
  catch { return false; }
}

export async function setupPrivateRepo(input: z.infer<typeof PrivateRepoSetupSchema>): Promise<{ directory: string; url: string }> {
  if (!isDesktopRuntime()) throw new Error("Private-repo onboarding is for the installed desktop app.");
  // Before anything is created: a missing tool should say so, not fail halfway as `spawn git ENOENT`.
  assertGitAvailable();
  assertGhAvailable();
  if (setupRunning) throw new Error("Private repository setup is already running.");
  setupRunning = true;
  const directory = path.resolve(input.directory.replace(/^~(?=\/|$)/, process.env.HOME ?? ""));
  // The folder this run created, until its content is safely on GitHub. Only that
  // one is ever removed on failure: a folder that was there before is the user's.
  let createdFolder = false;
  let contentPublished = false;
  let reusedRemote = false;
  let remoteCreated = false;
  try {
    if (input.action === "link") {
      await assertDevHubCheckout(directory);
      const url = await assertPrivateRepo(directory);
      await linkContent(directory);
      return { directory, url };
    }
    if (getCheckoutRoot()) throw new Error("A DevHub checkout is already linked. Use Link existing instead.");
    try { await fs.access(directory); throw new Error("That folder already exists. Choose a new folder or Link existing."); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
    const canonicalDirectory = await canonicalFuturePath(directory);
    for (const source of [getNotesDir(), getTasksDir(), getCollectionsDir(), getUpstartsDir(), getRepsDir(), path.join(getAppDataDir(), "diagrams")]) {
      const relative = path.relative(await canonicalFuturePath(path.resolve(source)), canonicalDirectory);
      if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
        throw new Error("Choose a folder outside your current personal content directories.");
      }
    }
    if (input.action === "clone") {
      const url = await privateRepoUrl(input.repository);
      await execGh(["auth", "setup-git", "--hostname", "github.com"]);
      await fs.mkdir(path.dirname(directory), { recursive: true });
      createdFolder = true;
      await execExternal("git", ["clone", "--", `${url}.git`, directory], {
        env: { ...ghEnv(), GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 180_000, label: "setup:clone-private",
      });
      await assertDevHubCheckout(directory);
      await assertPrivateRepo(directory);
      await git(directory, ["remote", "add", "upstream", PUBLIC_REPO]);
      const user = userSchema.parse(JSON.parse((await execGh(["api", "user"])).stdout));
      await configureGitIdentity(directory, user);
      await linkContent(directory);
      return { directory, url };
    }
    const { stdout } = await execGh(["api", "user"]);
    const user = userSchema.parse(JSON.parse(stdout));
    // Ask GitHub before cloning anything, so a taken name costs nothing.
    const repository = `${user.login}/${input.name}`;
    const remote = await remoteRepoState(repository);
    if (remoteBlocksCreate(remote)) {
      const free = await suggestFreeRepoName(user.login, directory);
      const elsewhere = free ? `create a new one named ${free.name}` : "choose another name";
      // A public repo is never a place for personal content, so it is never offered as a clone target.
      throw new Error(remote.isPrivate
        ? `${repository} already exists on GitHub. Clone it with "Clone my private repo", link a checkout you already have, or ${elsewhere}.`
        : `${repository} already exists on GitHub and is public, so DevHub will not put your content in it. Rename or delete it on GitHub, or ${elsewhere}.`);
    }
    reusedRemote = remote.exists;
    await execGh(["auth", "setup-git", "--hostname", "github.com"]);
    await fs.mkdir(path.dirname(directory), { recursive: true });
    createdFolder = true;
    await execExternal("git", ["clone", "--", PUBLIC_REPO, directory], {
      env: { ...ghEnv(), GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 180_000, label: "setup:clone-public-core",
    });
    await git(directory, ["remote", "rename", "origin", "upstream"]);
    if (reusedRemote) {
      // An empty private repo from an interrupted attempt: point origin at it.
      await git(directory, ["remote", "add", "origin", `${remote.url}.git`]);
    } else {
      // --private creates an independent copy; GitHub public forks stay public.
      await execGh(["repo", "create", repository, "--private", "--source", directory, "--remote", "origin"], { timeoutMs: 60_000 });
      remoteCreated = true;
    }
    const url = await assertPrivateRepo(directory);
    const sources = [
      ["notes", getNotesDir()], ["tasks", getTasksDir()],
      ["collections", getCollectionsDir()], ["upstarts", getUpstartsDir()],
      ["reps", getRepsDir()], ["diagrams", path.join(getAppDataDir(), "diagrams")],
    ] as const;
    for (const [folder, source] of sources) {
      await copyPrivateContent(source, path.join(directory, folder));
      await fs.mkdir(path.join(directory, folder), { recursive: true });
    }
    await configureGitIdentity(directory, user);
    await git(directory, ["add", "--", ...sources.map(([folder]) => folder)]);
    if (await git(directory, ["diff", "--cached", "--name-only"])) {
      await git(directory, ["commit", "-m", "chore: keep personal content in a private DevHub copy"]);
    }
    // Recheck immediately before publishing any personal content.
    await assertPrivateRepo(directory);
    await git(directory, ["push", "-u", "origin", "HEAD"]);
    contentPublished = true;
    await linkContent(directory);
    return { directory, url };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // A refusal before anything was created (the name is taken, the folder is
    // not a checkout) should say that and nothing about a half-finished setup.
    if (!createdFolder && !remoteCreated) {
      throw err instanceof Error ? err : new Error(detail);
    }
    // Before the first push the folder holds only public code (or a clone of the
    // user's own repo), and leaving it makes every retry fail with "already exists".
    if (createdFolder && !contentPublished && await removeCreatedFolder(directory)) {
      throw new Error(`${detail}\nThe new local folder was removed, so you can try again.${remoteCreated ? " The private repo on GitHub is still empty and will be reused." : ""}`);
    }
    throw new Error(`${detail}\nSetup leaves existing content and any created repo in place. If creation partly finished, link that private checkout to continue.`);
  } finally { setupRunning = false; }
}
