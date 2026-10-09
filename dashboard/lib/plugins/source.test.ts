import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseGitHubRepoUrl } from "./github-url";
import {
  accessCommands,
  checkRepositoryAccess,
  cloneArgv,
  downloadRepository,
  gitChildEnv,
  gitHardeningConfig,
  readGhStatus,
  readVisibility,
  type CommandResult,
  type CommandRunner,
} from "./source";
import {
  FixtureRunner,
  VALID_PLUGIN,
  cleanScratch,
  commitEntries,
  hasGit,
  isolatedGitEnv,
  scratchDir,
  type FixtureEntry,
} from "./test-fixtures";

afterEach(cleanScratch);

const repo = (() => {
  const parsed = parseGitHubRepoUrl("https://github.com/acme/team-tools");
  if (!parsed.ok) throw new Error("fixture url");
  return parsed.repo;
})();

const ok = (stdout = "", stderr = ""): CommandResult => ({ code: 0, stdout, stderr, timedOut: false });
const failed = (stderr = "", code = 128): CommandResult => ({ code, stdout: "", stderr, timedOut: false });

/** ProcessEnv requires NODE_ENV; tests only care about the keys they set. */
function testEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...extra, NODE_ENV: "test" };
}

/** A runner that answers from a script instead of running anything. */
function scripted(handler: (file: string, args: readonly string[]) => CommandResult | Promise<CommandResult>) {
  const calls: Array<{ file: string; args: string[]; env: NodeJS.ProcessEnv | undefined }> = [];
  const runner: CommandRunner = {
    async run(file, args, opts) {
      calls.push({ file, args: [...args], env: opts.env });
      return handler(file, args);
    },
  };
  return { runner, calls };
}

describe("hardening flags", () => {
  it("allow-lists https and turns off everything that could run code", () => {
    const flags = gitHardeningConfig("/tmp/hooks");
    const values = flags.filter((_, i) => flags[i - 1] === "-c");
    expect(values).toEqual(expect.arrayContaining([
      "protocol.allow=never",
      "protocol.https.allow=always",
      "http.followRedirects=false",
      "core.fsmonitor=false",
      "core.hooksPath=/tmp/hooks",
      "transfer.fsckObjects=true",
    ]));
    // `-c` always precedes its value; nothing is glued into one shell string.
    expect(flags.every((value, i) => (i % 2 === 0 ? value === "-c" : value !== "-c"))).toBe(true);
  });

  it("clones one commit, without a checkout, submodules, tags or templates", () => {
    const argv = cloneArgv(repo.cloneUrl, "/tmp/dest", "/tmp/template", ["-c", "protocol.allow=never"]);
    for (const flag of ["--depth=1", "--single-branch", "--no-checkout", "--no-recurse-submodules", "--no-tags", "--template=/tmp/template"]) {
      expect(argv).toContain(flag);
    }
    expect(argv.slice(-2)).toEqual([repo.cloneUrl, "/tmp/dest"]);
    expect(argv.some((arg) => /\s/.test(arg) && arg.startsWith("https://"))).toBe(false);
  });

  it("never lets Git prompt, and drops trace output that could print credentials", () => {
    const env = gitChildEnv(testEnv({ PATH: "/bin", GIT_TRACE: "1", GIT_CURL_VERBOSE: "1", GIT_TRACE_PACKET: "1" }));
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GCM_INTERACTIVE).toBe("never");
    expect(env.GIT_ALLOW_PROTOCOL).toBe("https");
    expect(env.GIT_TRACE).toBeUndefined();
    expect(env.GIT_CURL_VERBOSE).toBeUndefined();
    expect(env.GIT_TRACE_PACKET).toBeUndefined();
  });
});

describe("checkRepositoryAccess", () => {
  it("confirms access with the Git credentials already configured", async () => {
    const { runner, calls } = scripted((_, args) => (args.includes("--get-url") ? ok(`${repo.cloneUrl}\n`) : ok("abc\tHEAD\n")));
    const access = await checkRepositoryAccess(runner, repo, "/tmp/hooks", testEnv());
    expect(access).toMatchObject({ ok: true, authMethod: "configured-helper", gitAvailable: true });
    expect(calls.filter((call) => call.args.includes("ls-remote") && !call.args.includes("--get-url"))).toHaveLength(1);
  });

  it("falls back to the gh credential helper for this one call, and nothing else", async () => {
    let probes = 0;
    const { runner, calls } = scripted((_, args) => {
      if (args.includes("--get-url")) return ok(`${repo.cloneUrl}\n`);
      probes += 1;
      return probes === 1 ? failed("fatal: could not read Username") : ok("abc\tHEAD\n");
    });
    const access = await checkRepositoryAccess(runner, repo, "/tmp/hooks", testEnv());
    expect(access).toMatchObject({ ok: true, authMethod: "gh" });
    const fallback = calls[calls.length - 1].args.join(" ");
    expect(fallback).toContain("credential.helper=!gh auth git-credential");
    // The reset comes first, so a configured helper cannot also answer.
    expect(fallback.indexOf("credential.helper= ")).toBeLessThan(fallback.indexOf("credential.helper=!gh"));
  });

  it("never asks for a token or runs the credential protocol itself", async () => {
    const { runner, calls } = scripted((_, args) => (args.includes("--get-url") ? ok(`${repo.cloneUrl}\n`) : failed("fatal: Authentication failed")));
    await checkRepositoryAccess(runner, repo, "/tmp/hooks", testEnv());
    const flat = calls.map((call) => `${call.file} ${call.args.join(" ")}`).join("\n");
    expect(flat).not.toMatch(/auth token|credential fill|credential approve|store|--with-token/);
  });

  it("reports both attempts failing without carrying Git's own words", async () => {
    const { runner } = scripted((_, args) => (args.includes("--get-url") ? ok(`${repo.cloneUrl}\n`) : failed("remote: Invalid username or token ghp_SECRETSECRET")));
    const access = await checkRepositoryAccess(runner, repo, "/tmp/hooks", testEnv());
    expect(access.ok).toBe(false);
    expect(JSON.stringify(access)).not.toContain("ghp_");
  });

  it("does not treat a failed address check as a rewrite, and does not contact the remote", async () => {
    const { runner, calls } = scripted(() => failed("fatal: unable to read config file"));
    const access = await checkRepositoryAccess(runner, repo, "/tmp/hooks", testEnv());
    expect(access).toMatchObject({ ok: false, rewritten: false, gitAvailable: true });
    expect(calls.some((call) => call.args.includes("ls-remote") && !call.args.includes("--get-url"))).toBe(false);
  });

  it("refuses to contact a different host when Git config rewrites github.com", async () => {
    const { runner, calls } = scripted((_, args) => (args.includes("--get-url") ? ok("https://mirror.internal.example/acme/team-tools.git\n") : ok("abc\tHEAD\n")));
    const access = await checkRepositoryAccess(runner, repo, "/tmp/hooks", testEnv());
    expect(access).toMatchObject({ ok: false, rewritten: true });
    expect(calls.some((call) => call.args.includes("ls-remote") && !call.args.includes("--get-url"))).toBe(false);
  });

  it("says Git is missing when it cannot be started", async () => {
    const { runner } = scripted(() => ({ code: 1, stdout: "", stderr: "", timedOut: false, notFound: true }));
    expect(await checkRepositoryAccess(runner, repo, "/tmp/hooks", testEnv())).toMatchObject({ ok: false, gitAvailable: false });
  });

  it("stops at once when cancelled", async () => {
    const { runner } = scripted((_, args) => (args.includes("--get-url") ? ok(`${repo.cloneUrl}\n`) : { code: 1, stdout: "", stderr: "", timedOut: false, aborted: true }));
    expect(await checkRepositoryAccess(runner, repo, "/tmp/hooks", testEnv())).toMatchObject({ ok: false, aborted: true });
  });

  it("reports a timeout as one", async () => {
    const { runner } = scripted((_, args) => (args.includes("--get-url") ? ok(`${repo.cloneUrl}\n`) : { code: 1, stdout: "", stderr: "", timedOut: true }));
    expect(await checkRepositoryAccess(runner, repo, "/tmp/hooks", testEnv())).toMatchObject({ ok: false, timedOut: true });
  });
});

describe("GitHub CLI status", () => {
  it.each([
    [ok("", "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n"), { available: true, login: "octocat", label: "Signed in as octocat" }],
    [failed("You are not logged into any GitHub hosts. To log in, run: gh auth login", 1), { available: true, login: null, label: "Not signed in" }],
    [{ code: 1, stdout: "", stderr: "", timedOut: false, notFound: true }, { available: false, login: null, label: "Not available" }],
    [{ code: 1, stdout: "", stderr: "", timedOut: true }, { available: true, login: null, label: "Couldn’t check" }],
    [failed("something unexpected", 4), { available: true, login: null, label: "Couldn’t check" }],
  ] as const)("maps %#", async (result, expected) => {
    const { runner } = scripted(() => result);
    expect(await readGhStatus(runner, testEnv())).toEqual(expected);
  });

  it("reads repository visibility and leaves it unknown when it cannot be", async () => {
    expect(await readVisibility(scripted(() => ok("PUBLIC\n")).runner, repo, testEnv())).toBe("public");
    expect(await readVisibility(scripted(() => ok("PRIVATE\n")).runner, repo, testEnv())).toBe("private");
    expect(await readVisibility(scripted(() => ok("INTERNAL\n")).runner, repo, testEnv())).toBe("private");
    expect(await readVisibility(scripted(() => failed("auth", 1)).runner, repo, testEnv())).toBeNull();
  });
});

describe("accessCommands", () => {
  it("quotes the repository and offers only the documented sign-in commands", () => {
    const commands = accessCommands(repo, "macos", testEnv({ PATH: "/usr/bin" }));
    expect(commands.gh).toEqual([
      "gh auth login --hostname github.com --git-protocol https --web",
      "gh auth setup-git --hostname github.com",
    ]);
    expect(commands.git).toEqual(["git ls-remote 'https://github.com/acme/team-tools.git' HEAD"]);
  });

  it("names a bundled gh on WSL when an ordinary terminal would not find it", () => {
    const dir = scratchDir();
    const bin = path.join(dir, "bundled", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "gh"), "#!/bin/sh\n", { mode: 0o755 });
    const commands = accessCommands(repo, "wsl", testEnv({ PATH: bin }));
    expect(commands.gh[0]).toBe(`'${path.join(bin, "gh")}' auth login --hostname github.com --git-protocol https --web`);
    expect(commands.git[0]).toContain("git-credential-manager.exe");
    expect(commands.git[1]).toContain("git ls-remote");
  });

  it("uses plain gh on WSL when it is somewhere ordinary", () => {
    expect(accessCommands(repo, "wsl", testEnv({ PATH: "/usr/bin" })).gh[0].startsWith("gh auth login")).toBe(true);
  });
});

describe("downloadRepository with scripted Git", () => {
  const staging = () => path.join(scratchDir(), "stage");

  it("classifies denied access, timeouts and cancellation without keeping Git's text", async () => {
    const denied = scripted(() => failed("remote: Repository not found.\nfatal: Authentication failed for 'https://github.com/acme/team-tools.git/' ghp_SECRET"));
    const result = await downloadRepository(denied.runner, repo, staging(), testEnv(), "configured-helper");
    expect(result).toMatchObject({ ok: false, code: "ACCESS" });
    expect(JSON.stringify(result)).not.toContain("ghp_SECRET");

    const slow = scripted(() => ({ code: 1, stdout: "", stderr: "", timedOut: true }));
    expect(await downloadRepository(slow.runner, repo, staging(), testEnv(), null)).toMatchObject({ ok: false, code: "TIMEOUT", timedOut: true });

    const other = scripted(() => failed("fatal: unable to access: Could not resolve host"));
    expect(await downloadRepository(other.runner, repo, staging(), testEnv(), null)).toMatchObject({ ok: false, code: "GIT" });
  });

  it("stops the clone when the person cancels", async () => {
    const controller = new AbortController();
    const runner: CommandRunner = {
      run: (_file, args, opts) => new Promise((resolve) => {
        if (!args.includes("clone")) return resolve(ok());
        opts.signal?.addEventListener("abort", () => resolve({ code: 1, stdout: "", stderr: "", timedOut: false, aborted: true }));
      }),
    };
    const pending = downloadRepository(runner, repo, staging(), testEnv(), null, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    expect(await pending).toMatchObject({ ok: false, code: "ABORTED" });
  });

  it("stops a clone that grows past the size limit", async () => {
    const dir = staging();
    const runner: CommandRunner = {
      run: (_file, args, opts) => new Promise((resolve) => {
        if (!args.includes("clone")) return resolve(ok());
        const dest = args[args.length - 1];
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "pack"), Buffer.alloc(4096));
        opts.signal?.addEventListener("abort", () => resolve({ code: 1, stdout: "", stderr: "", timedOut: false, aborted: true }));
      }),
    };
    const result = await downloadRepository(runner, repo, dir, testEnv(), null, { limits: { maxCloneBytes: 1024 } });
    expect(result).toMatchObject({ ok: false, code: "LIMIT" });
  });

  const lsTree = (...records: string[]) => `${records.join("\0")}\0`;
  const blob = (mode: string, size: number, name: string) => `${mode} blob ${"a".repeat(40)} ${String(size).padStart(7)}\t${name}`;

  function listing(output: string) {
    return scripted((_file, args) => {
      const flat = args.join(" ");
      if (flat.includes("ls-tree")) return ok(output);
      if (flat.includes("rev-parse")) return ok(`${"b".repeat(40)}\n`);
      if (flat.includes("symbolic-ref")) return ok("main\n");
      if (flat.includes("remote get-url")) return ok(`${repo.cloneUrl}\n`);
      if (flat.includes("cat-file")) return failed("cat-file must not be reached", 1);
      return ok();
    });
  }

  it.each([
    ["a symlink", lsTree(blob("100644", 10, "devhub-plugin.json"), `120000 blob ${"a".repeat(40)}      12\tskills/link`)],
    ["a submodule", lsTree(blob("100644", 10, "devhub-plugin.json"), `160000 commit ${"a".repeat(40)}       -\tvendor/sub`)],
    ["a parent-directory path", lsTree(blob("100644", 10, "devhub-plugin.json"), blob("100644", 3, "skills/../../etc/passwd"))],
    ["an absolute path", lsTree(blob("100644", 10, "devhub-plugin.json"), blob("100644", 3, "/etc/passwd"))],
    ["a Windows drive path", lsTree(blob("100644", 10, "devhub-plugin.json"), blob("100644", 3, "C:/Windows/x"))],
    ["a backslash path", lsTree(blob("100644", 10, "devhub-plugin.json"), blob("100644", 3, "skills\\evil"))],
    ["a .git path", lsTree(blob("100644", 10, "devhub-plugin.json"), blob("100644", 3, "skills/.git/config"))],
    ["a .GIT path in another case", lsTree(blob("100644", 10, "devhub-plugin.json"), blob("100644", 3, ".GIT/hooks/post-checkout"))],
    ["a .gitmodules file", lsTree(blob("100644", 10, "devhub-plugin.json"), blob("100644", 30, ".gitmodules"))],
    ["names that differ only by case", lsTree(blob("100644", 10, "devhub-plugin.json"), blob("100644", 3, "Skills/a.md"), blob("100644", 3, "skills/a.md"))],
    ["names that differ only by Unicode form", lsTree(blob("100644", 10, "devhub-plugin.json"), blob("100644", 3, "caf\u00e9.md"), blob("100644", 3, "cafe\u0301.md"))],
    ["an executable that is not a regular mode", lsTree(blob("100644", 10, "devhub-plugin.json"), blob("100664", 3, "x"))],
    ["a record without a path", `100644 blob ${"a".repeat(40)}       3\t\0`],
  ])("refuses %s before reading any file", async (_label, output) => {
    const { runner, calls } = listing(output);
    const result = await downloadRepository(runner, repo, staging(), testEnv(), null);
    expect(result).toMatchObject({ ok: false, code: "UNSAFE" });
    expect(calls.some((call) => call.args.includes("cat-file"))).toBe(false);
  });

  it("refuses too many files, or a file or total that is too large, from the listing alone", async () => {
    const many = lsTree(blob("100644", 10, "devhub-plugin.json"), ...Array.from({ length: 12 }, (_, i) => blob("100644", 1, `f${i}.md`)));
    expect(await downloadRepository(listing(many).runner, repo, staging(), testEnv(), null, { limits: { maxFiles: 10 } })).toMatchObject({ ok: false, code: "LIMIT" });

    const bigFile = lsTree(blob("100644", 10, "devhub-plugin.json"), blob("100644", 5_000, "big.bin"));
    expect(await downloadRepository(listing(bigFile).runner, repo, staging(), testEnv(), null, { limits: { maxFileBytes: 1_000 } })).toMatchObject({ ok: false, code: "LIMIT" });

    const total = lsTree(blob("100644", 600, "devhub-plugin.json"), blob("100644", 600, "b.md"));
    expect(await downloadRepository(listing(total).runner, repo, staging(), testEnv(), null, { limits: { maxTotalBytes: 1_000 } })).toMatchObject({ ok: false, code: "LIMIT" });
  });

  it("answers a repository with no manifest from the listing and extracts nothing", async () => {
    const { runner, calls } = listing(lsTree(blob("120000", 3, "README.md"), blob("100644", 3, "src/main.ts")));
    const result = await downloadRepository(runner, repo, staging(), testEnv(), null);
    expect(result).toMatchObject({ ok: true, missingManifest: true, branch: "main" });
    if (result.ok) expect(fs.readdirSync(result.workTree)).toEqual([]);
    expect(calls.some((call) => call.args.includes("cat-file"))).toBe(false);
  });

  it("rejects a clone whose origin is not the validated address", async () => {
    const runner = scripted((_file, args) => (args.join(" ").includes("remote get-url") ? ok("https://elsewhere.example/acme/team-tools.git\n") : ok())).runner;
    expect(await downloadRepository(runner, repo, staging(), testEnv(), null)).toMatchObject({ ok: false, code: "UNSAFE" });
  });
});

describe.skipIf(!hasGit)("downloadRepository with real Git", () => {
  const home = () => scratchDir("devhub-git-home-");

  async function download(entries: FixtureEntry[], extra: Partial<ConstructorParameters<typeof FixtureRunner>[0]> = {}) {
    const dir = home();
    const { repo: fixture, sha } = commitEntries(entries, dir);
    const runner = new FixtureRunner({ repo: fixture, home: dir, ...extra });
    const stagingDir = path.join(scratchDir(), "stage");
    const result = await downloadRepository(runner, repo, stagingDir, isolatedGitEnv(dir), "configured-helper");
    return { result, runner, sha, stagingDir, home: dir };
  }

  it("extracts the committed files with their modes and names the commit and branch", async () => {
    const { result, sha, runner, stagingDir } = await download(VALID_PLUGIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sha).toBe(sha);
    expect(result.branch).toBe("main");
    expect(result.missingManifest).toBe(false);
    expect(fs.readFileSync(path.join(result.workTree, "skills/team-review/SKILL.md"), "utf8")).toContain("Team review");
    expect(fs.statSync(path.join(result.workTree, "skills/team-review/check.sh")).mode & 0o111).not.toBe(0);
    expect(fs.statSync(path.join(result.workTree, "devhub-plugin.json")).mode & 0o111).toBe(0);
    // The object store is only needed to read from; it does not stay behind.
    expect(fs.existsSync(path.join(stagingDir, "repo"))).toBe(false);
    expect(fs.existsSync(path.join(result.workTree, ".git"))).toBe(false);
    // What DevHub asked for never includes a worktree command.
    const subcommands = runner.subcommands();
    expect(subcommands).toContain("clone");
    for (const forbidden of ["checkout", "pull", "fetch", "submodule", "reset", "merge", "switch", "restore"]) {
      expect(subcommands).not.toContain(forbidden);
    }
  });

  it("asks Git non-interactively, over https only, with hooks pointed at an empty folder", async () => {
    const { runner } = await download(VALID_PLUGIN);
    const clone = runner.calls.find((call) => call.args.includes("clone"));
    expect(clone).toBeDefined();
    expect(clone?.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(clone?.env.GIT_ALLOW_PROTOCOL).toBe("https");
    const args = clone?.args ?? [];
    expect(args).toContain("protocol.allow=never");
    expect(args.find((arg) => arg.startsWith("core.hooksPath="))).toMatch(/git-template\/hooks$/);
    expect(args).toContain("--no-checkout");
    expect(args).toContain("--no-recurse-submodules");
  });

  it("runs no hook, template or filter from the machine's Git configuration", async () => {
    const dir = home();
    // Commit with plumbing before the hostile config exists. update-ref would
    // otherwise run reference-transaction and the marker would not be about the download.
    const entries: FixtureEntry[] = [...VALID_PLUGIN, { path: ".gitattributes", content: "* filter=evil\n" }];
    const { repo: fixture } = commitEntries(entries, dir);
    const marker = path.join(scratchDir(), "ran");
    const hooks = path.join(dir, "hooks");
    const template = path.join(dir, "template");
    fs.mkdirSync(hooks, { recursive: true });
    fs.mkdirSync(path.join(template, "hooks"), { recursive: true });
    for (const where of [hooks, path.join(template, "hooks")]) {
      for (const name of ["reference-transaction", "post-checkout", "post-merge", "post-commit", "pre-auto-gc", "pre-push"]) {
        fs.writeFileSync(path.join(where, name), `#!/bin/sh\necho ${name} >> '${marker}'\n`, { mode: 0o755 });
      }
    }
    fs.writeFileSync(path.join(dir, ".gitconfig"), [
      "[core]", `  hooksPath = ${hooks}`, `  fsmonitor = ${path.join(dir, "fsmonitor")}`,
      "[init]", `  templateDir = ${template}`,
      "[filter \"evil\"]", `  smudge = sh -c 'echo smudge >> ${marker}; cat'`, `  clean = sh -c 'echo clean >> ${marker}; cat'`, "  required = true",
    ].join("\n"));
    fs.writeFileSync(path.join(dir, "fsmonitor"), `#!/bin/sh\necho fsmonitor >> '${marker}'\n`, { mode: 0o755 });
    const runner = new FixtureRunner({ repo: fixture, home: dir });
    const result = await downloadRepository(runner, repo, path.join(scratchDir(), "stage"), isolatedGitEnv(dir), null);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);
    if (result.ok) {
      // The filter was never applied: the file is exactly what was committed.
      expect(fs.readFileSync(path.join(result.workTree, ".gitattributes"), "utf8")).toBe("* filter=evil\n");
    }
  });

  it.each([
    ["a symlink", [{ path: "skills/link", mode: "120000", content: "/etc/passwd" }] as FixtureEntry[]],
    ["a submodule", [{ path: "vendor/sub", mode: "160000" }] as FixtureEntry[]],
    ["a .gitmodules file", [{ path: ".gitmodules", content: "[submodule \"x\"]\n\tpath = x\n\turl = https://example.com/x\n" }] as FixtureEntry[]],
    ["names that differ only by case", [{ path: "Skills/a.md", content: "a" }, { path: "skills/a.md", content: "b" }] as FixtureEntry[]],
  ])("refuses a repository containing %s and writes nothing", async (_label, extra) => {
    const { result, stagingDir } = await download([...VALID_PLUGIN, ...extra]);
    expect(result).toMatchObject({ ok: false, code: "UNSAFE" });
    const tree = path.join(stagingDir, "tree");
    expect(fs.existsSync(tree) ? fs.readdirSync(tree) : []).toEqual([]);
  });

  it("treats a repository without devhub-plugin.json as 'not a plugin', not as an error", async () => {
    const { result, runner } = await download([{ path: "README.md", content: "hello" }, { path: "src/main.rs", content: "fn main() {}" }]);
    expect(result).toMatchObject({ ok: true, missingManifest: true });
    expect(runner.calls.some((call) => call.args.includes("cat-file"))).toBe(false);
  });

  it("refuses a file larger than the limit before reading it", async () => {
    const { result, runner } = await download([...VALID_PLUGIN, { path: "big.bin", content: Buffer.alloc(300_000) }], {});
    // The default limit is 20 MB, so this passes; shrink it to prove the check is on the listing.
    expect(result.ok).toBe(true);
    const dir = home();
    const { repo: fixture } = commitEntries([...VALID_PLUGIN, { path: "big.bin", content: Buffer.alloc(300_000) }], dir);
    const small = new FixtureRunner({ repo: fixture, home: dir });
    const limited = await downloadRepository(small, repo, path.join(scratchDir(), "stage"), isolatedGitEnv(dir), null, { limits: { maxFileBytes: 100_000 } });
    expect(limited).toMatchObject({ ok: false, code: "LIMIT" });
    expect(small.calls.some((call) => call.args.includes("cat-file"))).toBe(false);
    expect(runner.calls.length).toBeGreaterThan(0);
  });

  it("reads many files in few Git calls", async () => {
    const files = Array.from({ length: 60 }, (_, i) => ({ path: `skills/team-review/refs/f${i}.md`, content: `file ${i}` }));
    const { result, runner } = await download([...VALID_PLUGIN, ...files]);
    expect(result.ok).toBe(true);
    expect(runner.calls.filter((call) => call.args.includes("cat-file"))).toHaveLength(1);
    if (result.ok) expect(fs.readFileSync(path.join(result.workTree, "skills/team-review/refs/f59.md"), "utf8")).toBe("file 59");
  });

  it("keeps empty files and binary content byte for byte", async () => {
    const bytes = Buffer.from([0, 1, 2, 255, 254, 10, 13, 0]);
    const { result } = await download([...VALID_PLUGIN, { path: "assets/blob.bin", content: bytes }, { path: "assets/empty.txt", content: "" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fs.readFileSync(path.join(result.workTree, "assets/blob.bin")).equals(bytes)).toBe(true);
    expect(fs.readFileSync(path.join(result.workTree, "assets/empty.txt"))).toHaveLength(0);
  });
});
