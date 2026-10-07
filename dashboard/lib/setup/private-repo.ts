import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { execExternal } from "@/lib/exec-external";
import { execGh, ghEnv } from "@/lib/gh-exec";
import { getAppDataDir, getCheckoutRoot, isDesktopRuntime } from "@/lib/desktop/runtime-paths";
import { patchDashboardEnvLocalFile, patchEnvFileKeys, readDashboardEnvLocalFile, DASHBOARD_MANAGED_ENV_KEYS } from "@/lib/dashboard-env-local";
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

let setupRunning = false;

export async function setupPrivateRepo(input: z.infer<typeof PrivateRepoSetupSchema>): Promise<{ directory: string; url: string }> {
  if (!isDesktopRuntime()) throw new Error("Private-repo onboarding is for the installed desktop app.");
  if (setupRunning) throw new Error("Private repository setup is already running.");
  setupRunning = true;
  try {
    const directory = path.resolve(input.directory.replace(/^~(?=\/|$)/, process.env.HOME ?? ""));
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
    await execGh(["auth", "setup-git", "--hostname", "github.com"]);
    await fs.mkdir(path.dirname(directory), { recursive: true });
    await execExternal("git", ["clone", "--", PUBLIC_REPO, directory], {
      env: { ...ghEnv(), GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 180_000, label: "setup:clone-public-core",
    });
    await git(directory, ["remote", "rename", "origin", "upstream"]);
    // --private creates an independent copy; GitHub public forks stay public.
    await execGh(["repo", "create", `${user.login}/${input.name}`, "--private", "--source", directory, "--remote", "origin"], { timeoutMs: 60_000 });
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
    await linkContent(directory);
    return { directory, url };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${detail}\nSetup leaves existing content and any created repo in place. If creation partly finished, link that private checkout to continue.`);
  } finally { setupRunning = false; }
}
