import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRunSnapshotMarkdown, collectRunSnapshot, recordRunSnapshot } from "@/lib/tasks/run-snapshot";
import { getTaskAgentRuns, listTaskAgentRuns, upsertTaskAgentRun } from "@/lib/tasks/task-agent-runs";

const TASK_ID = "fe2f9c59-9533-40ba-a556-0965f5441bc8";
const RUN_ID = "run-m1abc2-deadbeef";

describe("buildRunSnapshotMarkdown", () => {
  it("names the run, branch, changes, and the session to continue", () => {
    const md = buildRunSnapshotMarkdown(
      { branch: "feat/x", headCommit: "abc1234 Add x", base: "origin/main", committedChanges: "2 files changed", uncommittedFiles: 1 },
      { runId: RUN_ID, state: "failed", provider: "claude", exitCode: 1, sessionId: "s-1", at: new Date("2026-09-17T10:00:00Z") },
    );
    expect(md).toBe(
      [
        `### Run ${RUN_ID} — failed (exit 1) · 2026-09-17 10:00 UTC`,
        "- CLI: claude",
        "- Branch: `feat/x` at abc1234 Add x",
        "- Changes vs origin/main: 2 files changed",
        "- Uncommitted: 1 file(s) — inspect before continuing",
        "- Continue with CLI session `s-1`",
      ].join("\n"),
    );
  });
});

describe("recordRunSnapshot", () => {
  let notesDir: string;
  let repo: string;
  let prevNotes: string | undefined;

  beforeEach(() => {
    notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-snap-notes-"));
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-snap-repo-"));
    prevNotes = process.env.NOTES_DIR;
    process.env.NOTES_DIR = notesDir;
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    git("init", "-q", "-b", "feat/snap");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "Start");
    fs.writeFileSync(path.join(repo, "dirty.txt"), "x");
  });

  afterEach(() => {
    if (prevNotes === undefined) delete process.env.NOTES_DIR;
    else process.env.NOTES_DIR = prevNotes;
    fs.rmSync(notesDir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("reads the checkout", async () => {
    const snap = await collectRunSnapshot(repo);
    expect(snap.branch).toBe("feat/snap");
    expect(snap.headCommit).toMatch(/ Start$/);
    expect(snap.uncommittedFiles).toBe(1);
  });

  it("appends once per run and remembers branch + checkout for the PR watcher", async () => {
    await upsertTaskAgentRun({ taskId: TASK_ID, runId: RUN_ID, status: "running", handoff: "## Agent notes\nDid A" });
    expect(await recordRunSnapshot(repo, { runId: RUN_ID, state: "succeeded", exitCode: 0 })).toBe(true);
    expect(await recordRunSnapshot(repo, { runId: RUN_ID, state: "succeeded", exitCode: 0 })).toBe(false);
    const { handoff } = getTaskAgentRuns(TASK_ID);
    expect(handoff.startsWith("## Agent notes\nDid A\n\n### Run ")).toBe(true);
    expect(handoff.match(/### Run /g)).toHaveLength(1);
    expect(listTaskAgentRuns(TASK_ID)[0]).toMatchObject({ branch: "feat/snap", cwd: repo });
  });

  it("writes to the vault it started in, even if NOTES_DIR changes mid-flight", async () => {
    await upsertTaskAgentRun({ taskId: TASK_ID, runId: RUN_ID, status: "running" });
    const pending = recordRunSnapshot(repo, { runId: RUN_ID, state: "failed" });
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-snap-other-"));
    process.env.NOTES_DIR = other;
    try {
      expect(await pending).toBe(true);
      expect(fs.readdirSync(other)).toEqual([]);
      process.env.NOTES_DIR = notesDir;
      expect(getTaskAgentRuns(TASK_ID).handoff).toContain(`### Run ${RUN_ID} — failed`);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it("ignores runs that aren't linked to a task", async () => {
    expect(await recordRunSnapshot(repo, { runId: "run-m1abc3-cafebabe", state: "failed" })).toBe(false);
  });
});
