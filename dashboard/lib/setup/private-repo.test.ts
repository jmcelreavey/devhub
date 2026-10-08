import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyPrivateContent, describePrivateRepoTarget, githubRepoFromOrigin, setupPrivateRepo, assertPrivateRepo, suggestedPrivateRepoDirectory } from "./private-repo";
import { GhMissingError, GitMissingError } from "./git-check";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(), gh: vi.fn(), patch: vi.fn(),
  appData: "", checkout: null as string | null,
  hasGit: true, hasGh: true,
  /** Repos that already exist on GitHub, by full name. */
  remotes: {} as Record<string, { isPrivate: boolean; isEmpty: boolean }>,
  /** Whether the repo `gh repo create` makes comes out private. */
  createdIsPrivate: true,
  signedIn: true,
}));
vi.mock("./git-check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./git-check")>();
  return {
    ...actual,
    assertGitAvailable: () => {
      if (!mocks.hasGit) throw new actual.GitMissingError({ present: false, version: null, where: "Ubuntu (WSL terminal)", installCommand: "sudo apt-get update && sudo apt-get install -y git", installUrl: "https://git-scm.com/downloads" });
    },
    assertGhAvailable: () => { if (!mocks.hasGh) throw new actual.GhMissingError(); },
  };
});
vi.mock("@/lib/exec-external", () => ({ execExternal: (...args: unknown[]) => mocks.exec(...args) }));
vi.mock("@/lib/gh-exec", () => ({ execGh: (...args: unknown[]) => mocks.gh(...args), ghEnv: () => ({}) }));
vi.mock("@/lib/dashboard-env-local", () => ({
  patchDashboardEnvLocalFile: (...args: unknown[]) => mocks.patch(...args),
  patchEnvFileKeys: vi.fn(),
  readDashboardEnvLocalFile: () => ({ overrides: new Map() }),
  DASHBOARD_MANAGED_ENV_KEYS: [],
}));
vi.mock("@/lib/desktop/runtime-paths", () => ({
  isDesktopRuntime: () => true,
  getAppDataDir: () => mocks.appData,
  getCheckoutRoot: () => mocks.checkout,
}));
vi.mock("@/lib/content/dirs", () => ({
  getNotesDir: () => path.join(mocks.appData, "notes"),
  getTasksDir: () => path.join(mocks.appData, "tasks"),
  getCollectionsDir: () => path.join(mocks.appData, "collections"),
  getUpstartsDir: () => path.join(mocks.appData, "upstarts"),
  getRepsDir: () => path.join(mocks.appData, "reps"),
}));

let tmp: string;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.hasGit = true;
  mocks.hasGh = true;
  mocks.remotes = {};
  mocks.createdIsPrivate = true;
  mocks.signedIn = true;
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-private-setup-"));
  mocks.appData = path.join(tmp, "app-data");
  mocks.checkout = null;
  await fs.mkdir(path.join(mocks.appData, "notes"), { recursive: true });
  await fs.writeFile(path.join(mocks.appData, "notes", "personal.md"), "private note");
  mocks.exec.mockImplementation(async (_file: string, args: string[], opts?: { cwd?: string }) => {
    if (args[0] === "rev-parse") return { stdout: opts?.cwd, stderr: "" };
    if (args[0] === "clone") {
      await fs.mkdir(args.at(-1)!, { recursive: true });
      await fs.writeFile(path.join(args.at(-1)!, "package.json"), JSON.stringify({ name: "devhub" }));
    }
    if (args[0] === "remote" && args[1] === "get-url") return { stdout: "https://github.com/test-user/devhub-private.git", stderr: "" };
    return { stdout: args[0] === "diff" ? "notes/personal.md" : "", stderr: "" };
  });
  mocks.gh.mockImplementation(async (args: string[]) => {
    if (args[0] === "api") {
      if (!mocks.signedIn) throw new Error("gh: To get started with GitHub CLI, please run: gh auth login");
      return { stdout: JSON.stringify({ login: "test-user", id: 123, name: "Test User" }), stderr: "" };
    }
    if (args[0] === "repo" && args[1] === "create") {
      mocks.remotes[args[2]] = { isPrivate: mocks.createdIsPrivate, isEmpty: true };
      return { stdout: "", stderr: "" };
    }
    if (args[0] === "repo" && args[1] === "view") {
      const found = mocks.remotes[args[2]];
      if (!found) throw new Error(`GraphQL: Could not resolve to a Repository with the name '${args[2]}'. (repository)`);
      return { stdout: JSON.stringify({ ...found, url: `https://github.com/${args[2]}` }), stderr: "" };
    }
    return { stdout: "", stderr: "" };
  });
});
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

describe("private repo validation", () => {
  it("accepts GitHub remotes and rejects lookalike or credential-bearing hosts", () => {
    expect(githubRepoFromOrigin("git@github.com:person/devhub-private.git")).toBe("person/devhub-private");
    expect(githubRepoFromOrigin("https://github.com/person/devhub-private.git")).toBe("person/devhub-private");
    for (const url of ["https://evilgithub.com/person/repo.git", "https://github.com.evil/person/repo", "https://token@github.com/person/repo", "file:///repo"]) {
      expect(() => githubRepoFromOrigin(url)).toThrow();
    }
  });
  it("refuses a public repository", async () => {
    mocks.gh.mockResolvedValue({ stdout: JSON.stringify({ isPrivate: false, url: "https://github.com/test-user/repo" }) });
    await expect(assertPrivateRepo(tmp)).rejects.toThrow("public");
  });
  it("refuses extra push destinations", async () => {
    mocks.remotes["test-user/devhub-private"] = { isPrivate: true, isEmpty: false };
    mocks.exec.mockImplementation(async (_file: string, args: string[]) => ({
      stdout: args.includes("--all")
        ? "https://github.com/test-user/devhub-private.git\nhttps://github.com/test-user/public.git"
        : "https://github.com/test-user/devhub-private.git",
    }));
    await expect(assertPrivateRepo(tmp)).rejects.toThrow("multiple push");
  });
});

describe("copying personal content", () => {
  it("keeps originals and refuses to overwrite different destination content", async () => {
    const from = path.join(mocks.appData, "notes");
    const to = path.join(tmp, "copy");
    await copyPrivateContent(from, to);
    await copyPrivateContent(from, to);
    await fs.writeFile(path.join(to, "personal.md"), "different");
    await expect(copyPrivateContent(from, to)).rejects.toThrow("Nothing was overwritten");
    expect(await fs.readFile(path.join(from, "personal.md"), "utf8")).toBe("private note");
    expect(await fs.readFile(path.join(to, "personal.md"), "utf8")).toBe("different");
  });
  it("does not follow source or destination symlinks", async () => {
    await fs.symlink(path.join(mocks.appData, "notes"), path.join(tmp, "destination"));
    await expect(copyPrivateContent(path.join(mocks.appData, "notes"), path.join(tmp, "destination"))).rejects.toThrow("not a real directory");
    await fs.symlink(path.join(tmp, "outside"), path.join(mocks.appData, "notes", "link"));
    await expect(copyPrivateContent(path.join(mocks.appData, "notes"), path.join(tmp, "copy"))).rejects.toThrow("symbolic link");
  });
});

describe("creating a private mirror", () => {
  it("clones an existing private repo without creating a new remote or pushing local data", async () => {
    const directory = path.join(tmp, "existing-private-copy");
    mocks.remotes["test-user/devhub-private"] = { isPrivate: true, isEmpty: false };
    await setupPrivateRepo({ action: "clone", repository: "test-user/devhub-private", directory });
    expect(mocks.exec).toHaveBeenCalledWith("git", ["clone", "--", "https://github.com/test-user/devhub-private.git", directory], expect.anything());
    expect(mocks.exec).toHaveBeenCalledWith("git", ["remote", "add", "upstream", "https://github.com/jmcelreavey/devhub.git"], expect.anything());
    expect(mocks.exec.mock.calls.some(([, args]) => args[0] === "push")).toBe(false);
    expect(mocks.gh.mock.calls.some(([args]) => args[0] === "repo" && args[1] === "create")).toBe(false);
    await expect(fs.access(path.join(directory, "notes", "personal.md"))).rejects.toThrow();
    expect(await fs.readFile(path.join(mocks.appData, "notes", "personal.md"), "utf8")).toBe("private note");
  });
  it("verifies privacy before copying and pushing, then links the new content root", async () => {
    const directory = path.join(tmp, "checkout");
    const overrides = new Map<string, string>();
    mocks.patch.mockImplementation((mutate: (values: Map<string, string>) => void) => mutate(overrides));
    await fs.mkdir(path.join(mocks.appData, "config"));
    await fs.writeFile(path.join(mocks.appData, "config", ".env.local"), "credentials stay local");
    const result = await setupPrivateRepo({ action: "create", name: "devhub-private", directory });
    expect(result.directory).toBe(directory);
    expect(mocks.gh).toHaveBeenCalledWith(["repo", "create", "test-user/devhub-private", "--private", "--source", directory, "--remote", "origin"], expect.anything());
    // Once to check the name is free, then before copying and before pushing.
    expect(mocks.gh.mock.calls.filter(([args]) => args[0] === "repo" && args[1] === "view")).toHaveLength(3);
    expect(mocks.exec).toHaveBeenCalledWith("git", ["push", "-u", "origin", "HEAD"], expect.anything());
    expect(overrides.get("DEVHUB_CONTENT_ROOT")).toBe(directory);
    expect(await fs.readFile(path.join(mocks.appData, "content-repo-path.txt"), "utf8")).toBe(directory);
    await expect(fs.access(path.join(mocks.appData, "repo-path.txt"))).rejects.toThrow();
    expect(overrides.get("NOTES_DIR")).toBe(path.join(directory, "notes"));
    expect(await fs.readFile(path.join(mocks.appData, "notes", "personal.md"), "utf8")).toBe("private note");
    expect(await fs.readFile(path.join(directory, "notes", "personal.md"), "utf8")).toBe("private note");
    await expect(fs.access(path.join(directory, "config", ".env.local"))).rejects.toThrow();
  });
  it("never copies personal data or pushes when the destination is public", async () => {
    const directory = path.join(tmp, "checkout");
    mocks.createdIsPrivate = false;
    await expect(setupPrivateRepo({ action: "create", name: "devhub-private", directory })).rejects.toThrow("public");
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.exec.mock.calls.some(([, args]) => args[0] === "push")).toBe(false);
    await expect(fs.access(path.join(directory, "notes", "personal.md"))).rejects.toThrow();
  });
  it("rejects a clone destination inside the content it would copy", async () => {
    await expect(setupPrivateRepo({
      action: "create", name: "devhub-private",
      directory: path.join(mocks.appData, "notes", "nested-checkout"),
    })).rejects.toThrow("outside your current personal content");
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it("rejects a symlinked parent that would put the clone inside its own source content", async () => {
    const alias = path.join(tmp, "shortcut");
    await fs.symlink(path.join(mocks.appData, "notes"), alias);
    await expect(setupPrivateRepo({
      action: "create", name: "devhub-private", directory: path.join(alias, "new-copy"),
    })).rejects.toThrow("outside your current personal content");
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it("does not reuse an existing directory or create alongside an already linked checkout", async () => {
    await expect(setupPrivateRepo({ action: "create", name: "devhub-private", directory: tmp })).rejects.toThrow("already exists");
    mocks.checkout = "/already-linked";
    await expect(setupPrivateRepo({ action: "create", name: "devhub-private", directory: path.join(tmp, "new") })).rejects.toThrow("already linked");
    expect(mocks.gh).not.toHaveBeenCalled();
  });
});

describe("a name or folder that is already taken", () => {
  const cloneCalls = () => mocks.exec.mock.calls.filter(([, args]) => args[0] === "clone");

  it("stops before cloning anything when the repo already exists on GitHub, and suggests a free name", async () => {
    mocks.remotes["test-user/devhub-private"] = { isPrivate: true, isEmpty: false };
    const directory = path.join(tmp, "dev", "devhub-private");
    await expect(setupPrivateRepo({ action: "create", name: "devhub-private", directory })).rejects.toThrow(
      /test-user\/devhub-private already exists on GitHub[\s\S]*Clone my private repo[\s\S]*devhub-private-2/,
    );
    expect(cloneCalls()).toHaveLength(0);
    expect(mocks.gh.mock.calls.some(([args]) => args[0] === "repo" && args[1] === "create")).toBe(false);
    await expect(fs.access(directory)).rejects.toThrow();
    await expect(fs.access(path.dirname(directory))).rejects.toThrow();
  });
  it("does not tell the user to clone a public repo, and never uses it", async () => {
    mocks.remotes["test-user/devhub-private"] = { isPrivate: false, isEmpty: false };
    const directory = path.join(tmp, "dev", "devhub-private");
    const failure = setupPrivateRepo({ action: "create", name: "devhub-private", directory });
    await expect(failure).rejects.toThrow(/already exists on GitHub and is public[\s\S]*devhub-private-2/);
    await expect(failure).rejects.not.toThrow(/Clone my private repo/);
    expect(cloneCalls()).toHaveLength(0);
    expect(mocks.exec.mock.calls.some(([, args]) => args[0] === "push")).toBe(false);
  });
  it("skips names taken on GitHub or on disk when suggesting one", async () => {
    mocks.remotes["test-user/devhub-private"] = { isPrivate: true, isEmpty: false };
    mocks.remotes["test-user/devhub-private-2"] = { isPrivate: true, isEmpty: false };
    await fs.mkdir(path.join(tmp, "dev", "devhub-private-3"), { recursive: true });
    const target = await describePrivateRepoTarget(path.join(tmp, "dev", "devhub-private"));
    expect(target.remote).toEqual({ repository: "test-user/devhub-private", exists: true, isPrivate: true, empty: false });
    expect(target.suggestion).toEqual({ name: "devhub-private-4", directory: path.join(tmp, "dev", "devhub-private-4") });
  });
  it("reports a local folder before anything is cloned and keeps it untouched", async () => {
    const directory = path.join(tmp, "dev", "devhub-private");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "mine.txt"), "keep");
    const target = await describePrivateRepoTarget(directory);
    expect(target).toMatchObject({ folderExists: true, existing: false, remote: { exists: false } });
    expect(target.suggestion?.name).toBe("devhub-private-2");
    await expect(setupPrivateRepo({ action: "create", name: "devhub-private", directory })).rejects.toThrow("already exists");
    expect(await fs.readFile(path.join(directory, "mine.txt"), "utf8")).toBe("keep");
    expect(cloneCalls()).toHaveLength(0);
  });
  it("says an existing checkout is a checkout, and offers no suggestion when everything is free", async () => {
    const directory = path.join(tmp, "dev", "devhub-private");
    await fs.mkdir(path.join(directory, ".git"), { recursive: true });
    expect(await describePrivateRepoTarget(directory)).toMatchObject({ existing: true, folderExists: true });
    const free = await describePrivateRepoTarget(path.join(tmp, "elsewhere", "devhub-private"));
    expect(free).toMatchObject({ existing: false, folderExists: false, remote: { exists: false } });
    expect(free.suggestion).toBeUndefined();
  });
  it("still returns the folder state when GitHub cannot be asked", async () => {
    mocks.signedIn = false;
    const target = await describePrivateRepoTarget(path.join(tmp, "dev", "devhub-private"));
    expect(target).toEqual({ directory: path.join(tmp, "dev", "devhub-private"), existing: false, folderExists: false });
  });
  it("reuses an empty private repo left by an interrupted attempt instead of failing on the name", async () => {
    mocks.remotes["test-user/devhub-private"] = { isPrivate: true, isEmpty: true };
    const directory = path.join(tmp, "checkout");
    await setupPrivateRepo({ action: "create", name: "devhub-private", directory });
    expect(mocks.gh.mock.calls.some(([args]) => args[0] === "repo" && args[1] === "create")).toBe(false);
    expect(mocks.exec).toHaveBeenCalledWith("git", ["remote", "add", "origin", "https://github.com/test-user/devhub-private.git"], expect.anything());
    expect(mocks.exec).toHaveBeenCalledWith("git", ["push", "-u", "origin", "HEAD"], expect.anything());
  });
  it("never puts content into an empty repo that is public", async () => {
    mocks.remotes["test-user/devhub-private"] = { isPrivate: false, isEmpty: true };
    await expect(setupPrivateRepo({ action: "create", name: "devhub-private", directory: path.join(tmp, "checkout") })).rejects.toThrow(/public/);
    expect(cloneCalls()).toHaveLength(0);
  });
});

describe("a failure partway through", () => {
  const failOn = (command: string) => {
    const base = mocks.exec.getMockImplementation()!;
    mocks.exec.mockImplementation(async (file: string, args: string[], opts?: { cwd?: string }) => {
      if (args[0] === command) throw new Error(`git ${command} failed`);
      return base(file, args, opts);
    });
  };
  it("removes the folder it created, so a retry can work, and says so", async () => {
    failOn("push");
    const directory = path.join(tmp, "dev", "devhub-private");
    await expect(setupPrivateRepo({ action: "create", name: "devhub-private", directory })).rejects.toThrow(/git push failed[\s\S]*removed, so you can try again[\s\S]*still empty and will be reused/);
    await expect(fs.access(directory)).rejects.toThrow();
    expect(mocks.patch).not.toHaveBeenCalled();
    // The retry the message promises: the empty repo is reused and the folder is free again.
    mocks.exec.mockReset();
    mocks.exec.mockImplementation(async (_file: string, args: string[], opts?: { cwd?: string }) => {
      if (args[0] === "rev-parse") return { stdout: opts?.cwd, stderr: "" };
      if (args[0] === "clone") {
        await fs.mkdir(args.at(-1)!, { recursive: true });
        await fs.writeFile(path.join(args.at(-1)!, "package.json"), JSON.stringify({ name: "devhub" }));
      }
      if (args[0] === "remote" && args[1] === "get-url") return { stdout: "https://github.com/test-user/devhub-private.git", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    await expect(setupPrivateRepo({ action: "create", name: "devhub-private", directory })).resolves.toMatchObject({ directory });
  });
  it("also removes a clone of the user's own repo that fails its checks", async () => {
    mocks.remotes["test-user/devhub-private"] = { isPrivate: true, isEmpty: false };
    mocks.exec.mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === "clone") await fs.mkdir(args.at(-1)!, { recursive: true });
      return { stdout: "", stderr: "" };
    });
    const directory = path.join(tmp, "dev", "devhub-private");
    await expect(setupPrivateRepo({ action: "clone", repository: "test-user/devhub-private", directory })).rejects.toThrow();
    await expect(fs.access(directory)).rejects.toThrow();
  });
  it("never removes a folder that was already there", async () => {
    failOn("clone");
    const directory = path.join(tmp, "already-there");
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, "mine.txt"), "keep");
    await expect(setupPrivateRepo({ action: "create", name: "devhub-private", directory })).rejects.toThrow("already exists");
    expect(await fs.readFile(path.join(directory, "mine.txt"), "utf8")).toBe("keep");
  });
  it("keeps the folder once the content is on GitHub", async () => {
    mocks.patch.mockImplementation(() => { throw new Error("cannot write the env file"); });
    const directory = path.join(tmp, "checkout");
    await expect(setupPrivateRepo({ action: "create", name: "devhub-private", directory })).rejects.toThrow(/cannot write the env file[\s\S]*link that private checkout/);
    expect(await fs.readFile(path.join(directory, "notes", "personal.md"), "utf8")).toBe("private note");
  });
});

describe("tools missing before setup starts", () => {
  const create = { action: "create", name: "devhub-private", directory: "" } as const;
  it("explains how to install git, and touches nothing", async () => {
    mocks.hasGit = false;
    await expect(setupPrivateRepo({ ...create, directory: path.join(tmp, "repo") })).rejects.toThrow(GitMissingError);
    await expect(setupPrivateRepo({ ...create, directory: path.join(tmp, "repo") })).rejects.toThrow(/sudo apt-get update && sudo apt-get install -y git/);
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.gh).not.toHaveBeenCalled();
    await expect(fs.access(path.join(tmp, "repo"))).rejects.toThrow();
  });
  it("says the GitHub CLI is missing rather than failing on the first gh call", async () => {
    mocks.hasGh = false;
    await expect(setupPrivateRepo({ ...create, directory: path.join(tmp, "repo") })).rejects.toThrow(GhMissingError);
    expect(mocks.exec).not.toHaveBeenCalled();
  });
});

describe("suggestedPrivateRepoDirectory", () => {
  it("uses ~/dev on Linux and WSL, where the launcher looks, and ~/Developer on macOS", () => {
    expect(suggestedPrivateRepoDirectory("/home/me", "linux")).toBe("/home/me/dev/devhub-private");
    expect(suggestedPrivateRepoDirectory("/Users/me", "darwin")).toBe("/Users/me/Developer/devhub-private");
  });
});
