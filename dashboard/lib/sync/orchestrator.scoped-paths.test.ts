import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitAndPushDirty, commitAndPushPaths, dryRunScopedSync, existingScopedPaths } from "./orchestrator";

const mocks = vi.hoisted(() => ({ git: vi.fn(), tracked: new Set<string>() }));
vi.mock("@/lib/git/repo-local", () => ({ runGitRepo: mocks.git }));
vi.mock("@/lib/setup/private-repo", () => ({ assertPrivateRepo: vi.fn() }));
vi.mock("@/lib/desktop/runtime-paths", () => ({ isDesktopRuntime: () => false }));

const CONTENT = ["notes", "collections", "tasks", "docs", "diagrams", "upstarts"];
let repo: string;
let emitted: string[];
const emit = (line: string) => { emitted.push(line); };
const gitCalls = (verb: string) => mocks.git.mock.calls.filter(([, args]) => args[0] === verb).map(([, args]) => args as string[]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tracked = new Set();
  emitted = [];
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-scoped-"));
  mocks.git.mockImplementation((_cwd: string, args: string[]) => {
    if (args[0] === "branch") return { status: 0, stdout: "main\n", stderr: "" };
    if (args[0] === "ls-files") return { status: 0, stdout: mocks.tracked.has(args.at(-1)!) ? `${args.at(-1)}/x.md\n` : "", stderr: "" };
    if (args[0] === "status") return { status: 0, stdout: " M notes/a.md\n", stderr: "" };
    if (args[0] === "diff") return { status: 0, stdout: "notes/a.md\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  });
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));
const mkdirs = (...names: string[]) => names.forEach((n) => fs.mkdirSync(path.join(repo, n), { recursive: true }));

describe("content sync with folders that don't exist yet", () => {
  it("adds only the folders that exist, so a missing diagrams/ no longer fails git add", async () => {
    mkdirs("notes", "tasks");
    expect(await commitAndPushPaths({ repoRoot: repo, emit, paths: CONTENT, commitMessage: "chore: sync" })).toBe(0);
    const add = gitCalls("add");
    expect(add).toHaveLength(1);
    expect(add[0]).toEqual(["add", "-A", "--", "notes", "tasks"]);
    expect(gitCalls("status")[0].slice(-2)).toEqual(["notes", "tasks"]);
    expect(emitted.join("\n")).toContain("Skipping folders that don't exist yet: collections, docs, diagrams, upstarts");
  });
  it("still stages a folder that was deleted from disk but is tracked, so the deletion syncs", async () => {
    mkdirs("notes");
    mocks.tracked.add("diagrams");
    await commitAndPushPaths({ repoRoot: repo, emit, paths: CONTENT, commitMessage: "chore: sync" });
    expect(gitCalls("add")[0]).toEqual(["add", "-A", "--", "notes", "diagrams"]);
  });
  it("is a clean no-op when none of the folders exist: no git add, commit or push", async () => {
    expect(await commitAndPushPaths({ repoRoot: repo, emit, paths: CONTENT, commitMessage: "chore: sync" })).toBe(0);
    for (const verb of ["add", "commit", "push", "status"]) expect(gitCalls(verb)).toHaveLength(0);
    expect(emitted.join("\n")).toContain("Nothing to sync yet");
  });
  it("keeps adding every folder when all exist", async () => {
    mkdirs(...CONTENT);
    await commitAndPushPaths({ repoRoot: repo, emit, paths: CONTENT, commitMessage: "chore: sync" });
    expect(gitCalls("add")[0]).toEqual(["add", "-A", "--", ...CONTENT]);
    expect(emitted.join("\n")).not.toContain("Skipping");
  });
  it("applies to the dry run too", async () => {
    mkdirs("notes");
    await dryRunScopedSync({ repoRoot: repo, emit, paths: CONTENT, commitMessage: "chore: sync" });
    expect(emitted.join("\n")).toContain("Would run: git add -A -- notes");
    expect(emitted.join("\n")).not.toContain("diagrams");
  });
  it("existingScopedPaths ignores git failures for the tracked check", () => {
    mocks.git.mockReturnValue({ status: 128, stdout: "", stderr: "not a git repo" });
    expect(existingScopedPaths(repo, ["notes"])).toEqual([]);
  });
});

describe("pre-push content switch", () => {
  const pushOpts = () => mocks.git.mock.calls.filter(([, args]) => args[0] === "push").map(([, , opts]) => opts);
  it("is set on the content sync's push, so the hook can skip verify for content-only commits", async () => {
    mkdirs("notes");
    await commitAndPushPaths({ repoRoot: repo, emit, paths: CONTENT, commitMessage: "chore: sync" });
    expect(pushOpts()).toEqual([{ env: { DEVHUB_PREPUSH: "content" } }]);
  });
  it("is not set on a commit-everything push, which can carry code", async () => {
    mocks.git.mockImplementation((_cwd: string, args: string[]) => {
      if (args[0] === "branch") return { status: 0, stdout: "main\n", stderr: "" };
      if (args[0] === "status") return { status: 0, stdout: " M dashboard/x.ts\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });
    await commitAndPushDirty({ repoRoot: repo, emit });
    expect(pushOpts()).toEqual([undefined]);
  });
});
