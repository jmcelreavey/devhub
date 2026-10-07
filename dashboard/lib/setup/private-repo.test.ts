import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyPrivateContent, githubRepoFromOrigin, setupPrivateRepo, assertPrivateRepo } from "./private-repo";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(), gh: vi.fn(), patch: vi.fn(),
  appData: "", checkout: null as string | null,
}));
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
  mocks.gh.mockImplementation(async (args: string[]) => ({
    stdout: JSON.stringify(args[0] === "api"
      ? { login: "test-user", id: 123, name: "Test User" }
      : { isPrivate: true, url: "https://github.com/test-user/devhub-private" }),
    stderr: "",
  }));
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
    expect(mocks.gh.mock.calls.filter(([args]) => args[0] === "repo" && args[1] === "view")).toHaveLength(2);
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
    mocks.gh.mockImplementation(async (args: string[]) => ({
      stdout: JSON.stringify(args[0] === "api" ? { login: "test-user", id: 123, name: null } : { isPrivate: false, url: "https://github.com/test-user/repo" }),
    }));
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
