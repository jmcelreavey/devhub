import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runs: vi.fn(() => [] as unknown[]) }));
vi.mock("@/lib/agent-runs/store", () => ({ listAgentRuns: mocks.runs }));

import { removeWorktrees, worktreeRemovalBlocker } from "./worktree-cleanup";

// A throwaway repo with real worktrees: nothing of John's is touched.
let root = "";
let repo = "";
const wt = (name: string) => path.join(root, name);
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wt-cleanup-")));
  repo = path.join(root, "app");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  for (const name of ["clean", "dirty", "busy", "also-clean"]) git(repo, "worktree", "add", "-q", "-b", name, wt(name));
  fs.writeFileSync(path.join(wt("dirty"), "notes.txt"), "unsaved work");
  mocks.runs.mockReturnValue([{ spec: { id: "run-1", worktree: { path: wt("busy") } }, status: { state: "running" } }]);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const items = () => ["clean", "dirty", "busy", "also-clean"].map((name) => ({ repo: "app", path: wt(name) }));
const resolve = (name: string) => (name === "app" ? repo : null);

describe("worktree removal safety", () => {
  it("names a running agent or uncommitted changes as the reason not to remove", async () => {
    expect(await worktreeRemovalBlocker(wt("busy"))).toEqual({ code: "run_active", reason: "an agent run is still going" });
    expect(await worktreeRemovalBlocker(wt("dirty"))).toEqual({ code: "worktree_dirty", reason: "it has uncommitted changes" });
    expect(await worktreeRemovalBlocker(wt("clean"))).toBeNull();
  });

  it("dry run splits removable from skipped without touching anything", async () => {
    const result = await removeWorktrees(items(), resolve, { dryRun: true });
    expect(result.removed).toEqual([wt("clean"), wt("also-clean")]);
    expect(result.skipped).toEqual([
      { repo: "app", path: wt("dirty"), reason: "it has uncommitted changes" },
      { repo: "app", path: wt("busy"), reason: "an agent run is still going" },
    ]);
    expect(fs.existsSync(wt("clean"))).toBe(true);
  });

  it("bulk delete removes the safe ones, never forces, and skips the rest with a reason", async () => {
    const result = await removeWorktrees([...items(), { repo: "gone", path: "/nowhere" }, { repo: "app", path: repo }], resolve);
    expect(result.removed).toEqual([wt("clean"), wt("also-clean")]);
    expect(result.skipped.map((s) => [path.basename(s.path), s.reason])).toEqual([
      ["dirty", "it has uncommitted changes"],
      ["busy", "an agent run is still going"],
      ["nowhere", "its repo was not found"],
      ["app", "That is the repository's own working tree and cannot be removed."],
    ]);
    expect(fs.existsSync(wt("clean"))).toBe(false);
    expect(fs.readFileSync(path.join(wt("dirty"), "notes.txt"), "utf8")).toBe("unsaved work");
    expect(fs.existsSync(wt("busy"))).toBe(true);
    // Branches and commits stay.
    expect(git(repo, "branch", "--list", "clean")).toContain("clean");
  });
});
