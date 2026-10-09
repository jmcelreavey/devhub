/**
 * Hardened download of a GitHub repository for review.
 *
 * Clone arguments are a fixed argv. User text never becomes a shell string.
 * Blobs are read with Git plumbing, so smudge filters, hooks and checkout-time
 * behaviour never run, and the candidate tree is written by this code only
 * after every path has been checked.
 */
import fs from "node:fs";
import path from "node:path";
import { execExternal, isExecAbort, isExecTimeout } from "@/lib/exec-external";
import { parseGitHubRepoUrl, type ParsedGitHubRepo, type UrlParseResult } from "./github-url";
import { shellQuote, whichOnPath } from "./runtime";

export { parseGitHubRepoUrl };
export type { ParsedGitHubRepo, UrlParseResult };

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted?: boolean;
  /** The program itself was not found (ENOENT), as opposed to exiting non-zero. */
  notFound?: boolean;
  stdoutBuffer?: Buffer;
}

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  label: string;
  input?: string;
  binary?: boolean;
  maxBuffer?: number;
  signal?: AbortSignal;
}

export interface CommandRunner {
  run(file: string, args: readonly string[], opts: CommandOptions): Promise<CommandResult>;
}

export const PLUGIN_LIMITS = {
  maxFiles: 10_000,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxCloneBytes: 200 * 1024 * 1024,
} as const;

const CLONE_TIMEOUT_MS = 120_000;
const WATCHDOG_MS = 500;
/** One `cat-file --batch` call reads at most this many bytes of blobs. */
const BATCH_BYTES = 16 * 1024 * 1024;
const BATCH_FILES = 400;
const MANIFEST = "devhub-plugin.json";

export function emptyGitTemplate(parent: string): string {
  const dir = path.join(parent, "git-template");
  fs.mkdirSync(path.join(dir, "hooks"), { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Fixed -c flags. hooksPath is a directory we created, not user input.
 * Anything not HTTPS is refused: the allow-list is the default policy and only
 * https is opened back up, so a protocol Git learns later stays closed.
 */
export function gitHardeningConfig(hooksPath: string): string[] {
  const flags = [
    "protocol.allow=never",
    "protocol.https.allow=always",
    "http.followRedirects=false",
    "core.fsmonitor=false",
    "core.protectNTFS=true",
    "core.protectHFS=true",
    "transfer.fsckObjects=true",
    "filter.lfs.required=false",
    "filter.lfs.smudge=",
    "filter.lfs.clean=",
    "filter.lfs.process=",
    "core.askPass=",
    "credential.interactive=false",
    "trace2.normalTarget=0",
    "trace2.eventTarget=0",
    "trace2.perfTarget=0",
    `core.hooksPath=${hooksPath}`,
  ];
  return flags.flatMap((value) => ["-c", value]);
}

export function cloneArgv(cloneUrl: string, dest: string, template: string, prefix: readonly string[]): string[] {
  return [
    ...prefix,
    "clone",
    "--depth=1",
    "--single-branch",
    "--no-checkout",
    "--no-recurse-submodules",
    "--no-tags",
    `--template=${template}`,
    cloneUrl,
    dest,
  ];
}

export function gitChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_ALLOW_PROTOCOL: "https",
    GIT_LFS_SKIP_SMUDGE: "1",
    GH_PROMPT_DISABLED: "1",
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_TRACE") || key === "GIT_CURL_VERBOSE" || key === "GH_DEBUG"
      || ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_ASKPASS", "SSH_ASKPASS"].includes(key)) delete env[key];
  }
  return env;
}

export function realCommandRunner(): CommandRunner {
  return {
    async run(file, args, opts) {
      try {
        const result = await execExternal(file, args, {
          cwd: opts.cwd,
          env: opts.env,
          timeoutMs: opts.timeoutMs,
          label: opts.label,
          input: opts.input,
          binary: opts.binary,
          signal: opts.signal,
          maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
        });
        return { code: 0, stdout: result.stdout, stderr: result.stderr, timedOut: false, stdoutBuffer: result.stdoutBuffer };
      } catch (err) {
        const error = err as { code?: number | string; stdout?: string; stderr?: string };
        const aborted = isExecAbort(err);
        return {
          code: typeof error.code === "number" ? error.code : 1,
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? "",
          timedOut: isExecTimeout(err) && !aborted,
          aborted,
          notFound: error.code === "ENOENT",
        };
      }
    },
  };
}

function ghCredentialArgs(hooksPath: string): string[] {
  return [
    ...gitHardeningConfig(hooksPath),
    "-c",
    "credential.helper=",
    "-c",
    "credential.helper=!gh auth git-credential",
  ];
}

export interface AccessCheck {
  ok: boolean;
  timedOut: boolean;
  aborted: boolean;
  /** A Git configuration rewrote the address to somewhere other than github.com. */
  rewritten: boolean;
  exitCode: number | null;
  authMethod: "configured-helper" | "gh" | null;
  gitAvailable: boolean;
}

/**
 * The address Git would really contact. `url.<base>.insteadOf` in the user's
 * own configuration can point github.com somewhere else; that is theirs to
 * decide for their own repositories, not for a plugin source we vouch for.
 */
type EffectiveUrl = "match" | "rewritten" | "missing" | "unavailable" | "aborted" | "timeout";

async function effectiveUrlMatches(
  runner: CommandRunner,
  repo: ParsedGitHubRepo,
  hooksPath: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<EffectiveUrl> {
  const result = await runner.run("git", [...gitHardeningConfig(hooksPath), "ls-remote", "--get-url", repo.cloneUrl], {
    cwd: hooksPath,
    env: gitChildEnv(env),
    timeoutMs: 10_000,
    label: "git:get-url",
    signal,
  });
  if (result.notFound) return "missing";
  if (result.aborted) return "aborted";
  if (result.timedOut) return "timeout";
  if (result.code !== 0) return "unavailable";
  const effective = result.stdout.trim();
  return effective === repo.cloneUrl || effective === repo.url ? "match" : "rewritten";
}

export async function checkRepositoryAccess(
  runner: CommandRunner,
  repo: ParsedGitHubRepo,
  hooksPath: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<AccessCheck> {
  const base: AccessCheck = {
    ok: false,
    timedOut: false,
    aborted: false,
    rewritten: false,
    exitCode: null,
    authMethod: null,
    gitAvailable: true,
  };
  const effective = await effectiveUrlMatches(runner, repo, hooksPath, env, signal);
  if (effective === "missing") return { ...base, gitAvailable: false };
  if (effective === "aborted") return { ...base, aborted: true };
  if (effective === "timeout") return { ...base, timedOut: true };
  if (effective === "rewritten") return { ...base, rewritten: true };
  if (effective !== "match") return base;

  const probe = (args: string[]) => runner.run("git", [...args, "ls-remote", repo.cloneUrl, "HEAD"], {
    cwd: hooksPath,
    env: gitChildEnv(env),
    timeoutMs: 20_000,
    label: "git:ls-remote",
    signal,
  });
  const first = await probe(gitHardeningConfig(hooksPath));
  if (first.aborted) return { ...base, aborted: true };
  if (first.timedOut) return { ...base, timedOut: true, exitCode: first.code };
  if (first.notFound) return { ...base, gitAvailable: false, exitCode: first.code };
  if (first.code === 0 && first.stdout.trim()) {
    return { ...base, ok: true, exitCode: 0, authMethod: "configured-helper" };
  }
  const second = await probe(ghCredentialArgs(hooksPath));
  if (second.aborted) return { ...base, aborted: true };
  if (second.code === 0 && second.stdout.trim()) {
    return { ...base, ok: true, exitCode: 0, authMethod: "gh" };
  }
  return { ...base, timedOut: second.timedOut, exitCode: second.code };
}

export interface GhStatus {
  available: boolean;
  login: string | null;
  label: string;
}

export async function readGhStatus(runner: CommandRunner, env: NodeJS.ProcessEnv): Promise<GhStatus> {
  const result = await runner.run("gh", ["auth", "status", "--hostname", "github.com"], {
    env: gitChildEnv(env),
    timeoutMs: 15_000,
    label: "gh:auth-status",
  });
  if (result.notFound) return { available: false, login: null, label: "Not available" };
  if (result.timedOut) return { available: true, login: null, label: "Couldn’t check" };
  const combined = `${result.stdout}\n${result.stderr}`;
  const login = combined.match(/Logged in to github\.com account ([A-Za-z0-9-]+)/)?.[1]
    ?? combined.match(/account ([A-Za-z0-9-]+)/)?.[1]
    ?? null;
  if (login && result.code === 0) return { available: true, login, label: `Signed in as ${login}` };
  if (/not logged/i.test(combined)) return { available: true, login: null, label: "Not signed in" };
  return { available: true, login: null, label: result.code === 0 ? "Available" : "Couldn’t check" };
}

export async function readVisibility(
  runner: CommandRunner,
  repo: ParsedGitHubRepo,
  env: NodeJS.ProcessEnv,
): Promise<"public" | "private" | null> {
  const result = await runner.run(
    "gh",
    ["repo", "view", `${repo.owner}/${repo.repo}`, "--json", "visibility", "--jq", ".visibility"],
    { env: gitChildEnv(env), timeoutMs: 15_000, label: "gh:repo-view" },
  );
  const value = result.stdout.trim().toLowerCase();
  if (value === "public") return "public";
  if (value === "private" || value === "internal") return "private";
  return null;
}

interface TreeEntry {
  mode: string;
  type: string;
  sha: string;
  size: number;
  filePath: string;
}

/** `git ls-tree -r -z -l`: `<mode> <type> <sha> <size>\t<path>` records. */
function parseLsTree(stdout: string): TreeEntry[] | null {
  const entries: TreeEntry[] = [];
  for (const record of stdout.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) return null;
    const meta = record.slice(0, tab).trim().split(/\s+/);
    const filePath = record.slice(tab + 1);
    if (meta.length < 4 || !filePath) return null;
    const size = meta[3] === "-" ? 0 : Number(meta[3]);
    if (!Number.isFinite(size) || size < 0) return null;
    entries.push({ mode: meta[0], type: meta[1], sha: meta[2], size, filePath });
  }
  return entries;
}

export function assertRepoRelative(filePath: string): boolean {
  if (!filePath || /[\u0000-\u001f\u007f\\:]/.test(filePath)) return false;
  if (path.isAbsolute(filePath) || /^[A-Za-z]:/.test(filePath) || filePath.startsWith("//")) return false;
  for (const part of filePath.split("/")) {
    if (!part || part === "." || part === "..") return false;
    if (part.toLowerCase() === ".git" || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) return false;
  }
  return true;
}

function directoryBytes(root: string, ceiling: number): number {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          // skip files that disappear while Git is still writing
        }
      }
      if (total > ceiling) return total;
    }
  }
  return total;
}

export interface DownloadResult {
  ok: true;
  workTree: string;
  sha: string;
  /** Default branch the clone followed, e.g. "main". Null when Git did not name one. */
  branch: string | null;
  /** No devhub-plugin.json at the root: nothing was extracted. */
  missingManifest: boolean;
}

export type DownloadFailureCode = "LIMIT" | "UNSAFE" | "GIT" | "TIMEOUT" | "ACCESS" | "ABORTED";
export type DownloadFailure = { ok: false; code: DownloadFailureCode; timedOut: boolean; exitCode: number | null };

function failure(code: DownloadFailureCode, exitCode: number | null = null, timedOut = false): DownloadFailure {
  return { ok: false, code, timedOut, exitCode };
}

/** Reads `git cat-file --batch` output for exactly the blobs requested, in order. */
function parseBatch(buffer: Buffer, expected: TreeEntry[]): Buffer[] | null {
  const blobs: Buffer[] = [];
  let offset = 0;
  for (const entry of expected) {
    const eol = buffer.indexOf(0x0a, offset);
    if (eol < 0) return null;
    const header = buffer.subarray(offset, eol).toString("utf8").split(" ");
    if (header.length !== 3 || header[0] !== entry.sha || header[1] !== "blob") return null;
    const size = Number(header[2]);
    if (!Number.isInteger(size) || size !== entry.size) return null;
    const start = eol + 1;
    if (start + size > buffer.length) return null;
    blobs.push(buffer.subarray(start, start + size));
    offset = start + size + 1;
  }
  return blobs;
}

export async function downloadRepository(
  runner: CommandRunner,
  repo: ParsedGitHubRepo,
  stagingDir: string,
  env: NodeJS.ProcessEnv,
  authMethod: AccessCheck["authMethod"],
  opts: { signal?: AbortSignal; limits?: Partial<Record<keyof typeof PLUGIN_LIMITS, number>> } = {},
): Promise<DownloadResult | DownloadFailure> {
  const limits = { ...PLUGIN_LIMITS, ...opts.limits };
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
  const template = emptyGitTemplate(stagingDir);
  const hooks = path.join(template, "hooks");
  const dest = path.join(stagingDir, "repo");
  const prefix = authMethod === "gh" ? ghCredentialArgs(hooks) : gitHardeningConfig(hooks);
  const git = (args: string[], label: string, extra: Partial<CommandOptions> = {}) =>
    runner.run("git", [...gitHardeningConfig(hooks), "-C", dest, ...args], {
      env: gitChildEnv(env),
      timeoutMs: 20_000,
      label,
      signal: opts.signal,
      ...extra,
    });

  // Git configuration can change while an access check is in flight.
  const effective = await effectiveUrlMatches(runner, repo, hooks, env, opts.signal);
  if (effective !== "match") return failure(effective === "aborted" ? "ABORTED" : effective === "timeout" ? "TIMEOUT" : "UNSAFE", null, effective === "timeout");

  // The pack arrives before we can inspect it, so size is watched while Git
  // runs and the process is stopped the moment it passes the ceiling.
  const stopper = new AbortController();
  const relay = () => stopper.abort();
  opts.signal?.addEventListener("abort", relay, { once: true });
  if (opts.signal?.aborted) stopper.abort();
  let oversize = false;
  const watchdog = setInterval(() => {
    if (directoryBytes(dest, limits.maxCloneBytes) > limits.maxCloneBytes) {
      oversize = true;
      stopper.abort();
    }
  }, WATCHDOG_MS);
  let cloned: CommandResult;
  try {
    cloned = await runner.run("git", cloneArgv(repo.cloneUrl, dest, template, prefix), {
      cwd: hooks,
      env: gitChildEnv(env),
      timeoutMs: CLONE_TIMEOUT_MS,
      label: "git:clone",
      signal: stopper.signal,
    });
  } finally {
    clearInterval(watchdog);
    opts.signal?.removeEventListener("abort", relay);
  }
  if (oversize) return failure("LIMIT");
  if (cloned.aborted) return failure("ABORTED");
  if (cloned.timedOut) return failure("TIMEOUT", cloned.code, true);
  if (cloned.code !== 0) {
    const denied = /authentication|could not read Username|403|401|terminal prompts disabled|Permission denied|not found/i.test(cloned.stderr);
    return failure(denied ? "ACCESS" : "GIT", cloned.code);
  }
  if (directoryBytes(dest, limits.maxCloneBytes) > limits.maxCloneBytes) return failure("LIMIT");

  const remote = await git(["remote", "get-url", "origin"], "git:remote", { timeoutMs: 10_000 });
  if (remote.code !== 0 || remote.stdout.trim().replace(/\.git$/, "") !== repo.url) {
    return failure("UNSAFE", remote.code);
  }

  const head = await git(["rev-parse", "HEAD"], "git:rev-parse", { timeoutMs: 10_000 });
  const sha = head.stdout.trim();
  if (head.code !== 0 || !/^[0-9a-f]{40}$/i.test(sha)) return failure("GIT", head.code);

  const named = await git(["symbolic-ref", "--short", "HEAD"], "git:branch", { timeoutMs: 10_000 });
  const branchName = named.stdout.trim();
  const branch = named.code === 0 && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branchName) ? branchName : null;

  const listed = await git(["ls-tree", "-r", "-z", "-l", "HEAD"], "git:ls-tree");
  if (listed.aborted) return failure("ABORTED");
  if (listed.code !== 0) return failure("GIT", listed.code, listed.timedOut);
  const entries = parseLsTree(listed.stdout);
  if (!entries) return failure("UNSAFE");

  const workTree = path.join(stagingDir, "tree");
  fs.mkdirSync(workTree, { recursive: true, mode: 0o700 });
  // A repository without a manifest is answered from the listing alone: there
  // is nothing to extract and no reason to judge the rest of its files.
  if (!entries.some((entry) => entry.filePath === MANIFEST && entry.type === "blob")) {
    fs.rmSync(dest, { recursive: true, force: true });
    return { ok: true, workTree, sha, branch, missingManifest: true };
  }
  if (entries.length > limits.maxFiles) return failure("LIMIT");

  const seen = new Set<string>();
  const spelling = new Map<string, string>();
  let total = 0;
  for (const entry of entries) {
    // symlink, gitlink (submodule) and anything that is not a plain file
    if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) return failure("UNSAFE");
    if (!assertRepoRelative(entry.filePath)) return failure("UNSAFE");
    if (entry.filePath === ".gitmodules" || entry.filePath.endsWith("/.gitmodules")) return failure("UNSAFE");
    const key = entry.filePath.normalize("NFC").toLowerCase();
    if (seen.has(key)) return failure("UNSAFE");
    seen.add(key);
    const parts = entry.filePath.split("/");
    for (let length = 1; length <= parts.length; length += 1) {
      const prefix = parts.slice(0, length).join("/");
      const canonical = prefix.normalize("NFC").toLowerCase();
      const previous = spelling.get(canonical);
      if (previous && previous !== prefix) return failure("UNSAFE");
      if (length < parts.length && seen.has(canonical)) return failure("UNSAFE");
      spelling.set(canonical, prefix);
    }
    if (entry.size > limits.maxFileBytes) return failure("LIMIT");
    total += entry.size;
    if (total > limits.maxTotalBytes) return failure("LIMIT");
  }

  const rootReal = fs.realpathSync(workTree);
  for (let from = 0; from < entries.length;) {
    let bytes = 0;
    let to = from;
    while (to < entries.length && to - from < BATCH_FILES && (to === from || bytes + entries[to].size <= BATCH_BYTES)) {
      bytes += entries[to].size;
      to += 1;
    }
    const batch = entries.slice(from, to);
    from = to;
    const read = await git(["cat-file", "--batch"], "git:cat-file", {
      binary: true,
      input: `${batch.map((entry) => entry.sha).join("\n")}\n`,
      maxBuffer: bytes + batch.length * 256 + 1024 * 1024,
    });
    if (read.aborted) return failure("ABORTED");
    if (read.code !== 0 || !read.stdoutBuffer) return failure("GIT", read.code, read.timedOut);
    const blobs = parseBatch(read.stdoutBuffer, batch);
    if (!blobs) return failure("GIT");
    for (const [index, entry] of batch.entries()) {
      const destination = path.join(workTree, entry.filePath);
      const parent = path.dirname(destination);
      fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      const resolvedParent = fs.realpathSync(parent);
      if (resolvedParent !== rootReal && !resolvedParent.startsWith(rootReal + path.sep)) return failure("UNSAFE");
      try {
        fs.writeFileSync(destination, blobs[index], { flag: "wx" });
      } catch {
        // an existing file means two entries landed on one name
        return failure("UNSAFE");
      }
      fs.chmodSync(destination, entry.mode === "100755" ? 0o755 : 0o644);
    }
  }

  // The clone is only needed to read objects; the reviewed tree is what stays.
  fs.rmSync(dest, { recursive: true, force: true });
  return { ok: true, workTree, sha, branch, missingManifest: false };
}

export interface AccessCommandSet {
  gh: string[];
  git: string[];
}

/** Commands the person runs themselves. DevHub never runs these. */
export function accessCommands(
  repo: ParsedGitHubRepo,
  runtimeKind: "macos" | "linux" | "wsl",
  env: NodeJS.ProcessEnv = process.env,
): AccessCommandSet {
  let gh = "gh";
  if (runtimeKind === "wsl") {
    // A bundled gh may not be on an ordinary WSL terminal's PATH; name it exactly.
    const found = whichOnPath("gh", env);
    const ordinary = ["/usr/bin", "/usr/local/bin", "/bin", "/snap/bin"];
    if (found && !ordinary.includes(path.dirname(found))) gh = `'${found.replace(/'/g, "'\\''")}'`;
  }
  const login = [
    `${gh} auth login --hostname github.com --git-protocol https --web`,
    `${gh} auth setup-git --hostname github.com`,
  ];
  const check = `git ls-remote ${shellQuote(repo.cloneUrl)} HEAD`;
  if (runtimeKind === "wsl") {
    return {
      gh: login,
      git: [
        "git config --global credential.helper \"/mnt/c/Program\\ Files/Git/mingw64/bin/git-credential-manager.exe\"",
        check,
      ],
    };
  }
  return { gh: login, git: [check] };
}
