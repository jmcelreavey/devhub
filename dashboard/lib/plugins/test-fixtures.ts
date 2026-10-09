/**
 * Test helpers for the plugin suites: scratch directories, a Git repository
 * built from plumbing (so symlinks, submodule entries and colliding names can
 * be committed on any filesystem), and a command runner that sends the real
 * `git` to that repository while recording what DevHub asked for.
 *
 * Only tests import this.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { realCommandRunner, type CommandOptions, type CommandResult, type CommandRunner } from "./source";

export const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const scratch: string[] = [];

export function scratchDir(prefix = "devhub-plugin-test-"): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  scratch.push(dir);
  return dir;
}

export function cleanScratch(): void {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** An environment that sees none of the machine's own Git configuration. */
export function isolatedGitEnv(home: string, extra: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
    ...extra,
    NODE_ENV: extra.NODE_ENV ?? "test",
  };
}

export interface FixtureEntry {
  path: string;
  /** 100644 file, 100755 executable, 120000 symlink (content is the target), 160000 submodule (content is a commit id). */
  mode?: "100644" | "100755" | "120000" | "160000";
  content?: string | Buffer;
}

function run(cwd: string, env: NodeJS.ProcessEnv, args: string[], input?: string | Buffer): string {
  return execFileSync("git", args, { cwd, env, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

/** Commits exactly these entries to branch `main` of a new repository and returns its path. */
export function commitEntries(entries: FixtureEntry[], home = scratchDir("devhub-fixture-home-")): { repo: string; sha: string } {
  const repo = scratchDir("devhub-fixture-repo-");
  const env = isolatedGitEnv(home);
  run(repo, env, ["init", "--quiet", "--initial-branch=main"]);
  for (const entry of entries) {
    const mode = entry.mode ?? "100644";
    const id = mode === "160000"
      ? String(entry.content ?? "0123456789012345678901234567890123456789")
      : run(repo, env, ["hash-object", "-w", "--stdin"], entry.content ?? "");
    run(repo, env, ["update-index", "--add", "--cacheinfo", `${mode},${id},${entry.path}`]);
  }
  const tree = run(repo, env, ["write-tree"]);
  const sha = run(repo, env, ["commit-tree", tree, "-m", "fixture"]);
  run(repo, env, ["update-ref", "refs/heads/main", sha]);
  return { repo, sha };
}

export const VALID_PLUGIN: FixtureEntry[] = [
  { path: "devhub-plugin.json", content: JSON.stringify({ name: "team-tools", version: "0.1.0", devhubApi: "1", contributes: { skills: "skills/", agents: "agents/" } }) },
  { path: "skills/team-review/SKILL.md", content: "---\nname: team-review\ndescription: Review changes using team conventions\n---\n\n# Team review\n" },
  { path: "skills/team-review/check.sh", mode: "100755", content: "#!/bin/sh\necho checked\n" },
  { path: "agents/team-reviewer.md", content: "---\nname: team-reviewer\ndescription: Review a small change\nmode: subagent\nreadonly: true\n---\n\nReview the change.\n" },
];

export interface RecordedCall {
  file: string;
  args: string[];
  /** The environment as DevHub supplied it, before the fixture adjusted it. */
  env: NodeJS.ProcessEnv;
}

export interface FixtureRunnerOptions {
  /** Repository to answer `https://github.com/<owner>/<repo>` clones with. */
  repo?: string;
  /** What `gh` should say, keyed by its first two arguments, e.g. "auth status". */
  gh?: Record<string, Partial<CommandResult>>;
  home: string;
  /** Replace the answer to any git call; return undefined to fall through to the real git. */
  intercept?: (file: string, args: readonly string[], opts: CommandOptions) => Promise<CommandResult | undefined> | CommandResult | undefined;
}

export class FixtureRunner implements CommandRunner {
  readonly calls: RecordedCall[] = [];
  private readonly real = realCommandRunner();

  constructor(private readonly options: FixtureRunnerOptions) {}

  async run(file: string, args: readonly string[], opts: CommandOptions): Promise<CommandResult> {
    this.calls.push({ file, args: [...args], env: opts.env ? { ...opts.env } : { NODE_ENV: "test" } });
    const intercepted = await this.options.intercept?.(file, args, opts);
    if (intercepted) return intercepted;
    if (file === "gh") {
      const key = args.slice(0, 2).join(" ");
      return { code: 0, stdout: "", stderr: "", timedOut: false, ...(this.options.gh?.[key] ?? { code: 1, notFound: true }) };
    }
    if (file !== "git") return this.real.run(file, args, opts);
    const repo = this.options.repo;
    if (!repo) return { code: 128, stdout: "", stderr: "fatal: repository not found", timedOut: false };
    const flat = args.join(" ");
    if (flat.includes("ls-remote --get-url")) return { code: 0, stdout: `${args[args.length - 1]}\n`, stderr: "", timedOut: false };
    if (flat.endsWith("remote get-url origin")) return { code: 0, stdout: "https://github.com/acme/team-tools.git\n", stderr: "", timedOut: false };
    const rewritten = args.map((arg) => (arg.startsWith("https://github.com/") ? `file://${repo}` : arg === "protocol.allow=never" ? "protocol.allow=always" : arg));
    const env = isolatedGitEnv(this.options.home, { GIT_ALLOW_PROTOCOL: "file:https", GIT_TERMINAL_PROMPT: "0" });
    return this.real.run(file, rewritten, { ...opts, env });
  }

  /** Every git invocation's subcommand, in order (the word after the -c flags). */
  subcommands(): string[] {
    return this.calls.filter((call) => call.file === "git").map((call) => {
      const rest = call.args.filter((_, i, all) => all[i - 1] !== "-c" && all[i] !== "-c" && all[i - 1] !== "-C");
      return rest.find((arg) => !arg.startsWith("-")) ?? "";
    });
  }
}
