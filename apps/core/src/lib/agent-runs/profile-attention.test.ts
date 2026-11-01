import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as startManualRun } from "../../http/routes/agent/runs/route";
import * as dispatch from "./dispatch";
import { scopedTaskActivity, type AgentDispatchInput } from "./dispatch";
import { readProfileAgentAttention, type AgentRun } from "./store";
import { profileHeaders, taskLaunchProfile } from "../../../../../packages/shared/tasks/profile-scope";
import { taskScopeForDirectory, type AgentActivityContext } from "./run-files";
import { withTaskProfileRequest } from "../../domains/tasks/profile-request";
import { todayISO } from "../../../../../packages/shared/utils.ts";
import { closeSqliteDatabase, sqliteDatabasePath } from "../../domains/storage/sqlite";

let root: string;
let work: string;
let home: string;
let runs: string;
let createdAt: string;

function writeTask(directory: string, id: string, text: string, date = createdAt) {
  fs.mkdirSync(path.join(directory, "items"), { recursive: true });
  fs.writeFileSync(path.join(directory, "items", `${id}.json`), JSON.stringify({ id, text, createdAt: date, startDate: todayISO(), rank: "1", done: false }));
}

function readAttention() {
  return readProfileAgentAttention("work", work, [{ id: "same-id", createdAt }], { includeLatestFailure: true });
}

function writeRun(id: string, activity: AgentActivityContext | undefined, state = "needs-attention", cwd?: string) {
  const directory = path.join(runs, id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "spec.json"), JSON.stringify({ id, activity, cwd, title: "Private run title", prompt: "Private run prompt" }));
  fs.writeFileSync(path.join(directory, "status.json"), JSON.stringify({ state, resultText: "Private run result" }));
}

describe.each(["file", "sqlite"])("profile-owned agent attention (%s)", (backend) => {
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-profile-attention-"));
  const tasks = path.join(root, "tasks");
  work = path.join(tasks, "work");
  home = path.join(tasks, "home");
  runs = path.join(root, "agent-runs");
  createdAt = `${todayISO()}T09:00:00.000Z`;
  vi.stubEnv("REPO_ROOT", root);
  vi.stubEnv("TASKS_DIR", tasks);
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
  vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", runs);
  vi.stubEnv("DEVHUB_PROFILE", "work");
  vi.stubEnv("HOME", root);
  vi.stubEnv("XDG_STATE_HOME", path.join(root, "state"));
  vi.stubEnv("DEVHUB_DESKTOP", "");
  vi.stubEnv("DEVHUB_STATE_PROFILE", "");
  vi.stubEnv("DEVHUB_STORAGE_SQLITE", backend === "sqlite" ? "1" : "0");
  writeTask(work, "same-id", "Work task");
  writeTask(home, "same-id", "Private home task");
});

afterEach(() => {
  vi.restoreAllMocks();
  if (backend === "sqlite") closeSqliteDatabase(sqliteDatabasePath());
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

  it("only stamps a new run from an explicit, pinned task profile", () => {
    const input: AgentDispatchInput = {
      provider: "test", prompt: "Test", cwd: root, depth: 0,
      verifiedFreshTask: { id: "same-id", createdAt },
      activity: { source: "interactive", action: "plan", taskId: "same-id", taskScope: { profile: "forged", directoryIdentity: "forged", taskCreatedAt: createdAt } },
    };
    expect(scopedTaskActivity(input)?.taskScope).toBeUndefined();
    const scoped = withTaskProfileRequest("work", () => scopedTaskActivity(input));
    expect(scoped?.taskScope).toEqual(taskScopeForDirectory("work", work, "same-id", createdAt));
    expect(scoped?.taskScope?.profile).toBe("work");
    expect(withTaskProfileRequest("work", () => scopedTaskActivity({ ...input, verifiedFreshTask: undefined }))?.taskScope).toBeUndefined();
    expect(withTaskProfileRequest("work", () => scopedTaskActivity({ ...input, verifiedFreshTask: { id: "same-id", createdAt: "wrong" } }))?.taskScope).toBeUndefined();
    for (const change of [{ parentRunId: "old-run" }, { resumeSessionId: "old-session" }, { inherit: { baseSha: "abc" } }, { scheduledJobId: "job" }]) {
      expect(withTaskProfileRequest("work", () => scopedTaskActivity({ ...input, ...change }))?.taskScope).toBeUndefined();
    }
    expect(withTaskProfileRequest("work", () => scopedTaskActivity({ ...input, activity: { ...input.activity!, taskId: "missing" } }))?.taskScope).toBeUndefined();
    expect(input.activity?.taskScope?.profile).toBe("forged");
  });

  it("does not treat a recreated profile or a missing creation timestamp as the same owner", () => {
    const before = taskScopeForDirectory("work", work, "same-id", createdAt);
    expect(before).toBeDefined();
    fs.renameSync(work, path.join(root, "old-work"));
    writeTask(work, "same-id", "Work task");
    expect(taskScopeForDirectory("work", work, "same-id", createdAt)?.directoryIdentity).not.toBe(before?.directoryIdentity);
    fs.writeFileSync(path.join(work, "items", "same-id.json"), JSON.stringify({ id: "same-id", text: "Work task", startDate: todayISO() }));
    expect(taskScopeForDirectory("work", work, "same-id", createdAt)).toBeUndefined();
  });

  it("does not assign another profile through symlinked task directories", () => {
    fs.renameSync(path.join(work, "items"), path.join(root, "work-items"));
    fs.symlinkSync(path.join(home, "items"), path.join(work, "items"), "dir");
    expect(taskScopeForDirectory("work", work, "same-id", createdAt)).toBeUndefined();
    fs.rmSync(path.join(work, "items"));
    fs.renameSync(work, path.join(root, "old-work"));
    fs.symlinkSync(home, work, "dir");
    expect(taskScopeForDirectory("work", work, "same-id", createdAt)).toBeUndefined();
  });

  it("projects only verified waiting tasks without reading other profiles or changing data", async () => {
    const workScope = taskScopeForDirectory("work", work, "same-id", createdAt)!;
    const homeScope = taskScopeForDirectory("home", home, "same-id", createdAt)!;
    const activity = (taskScope?: AgentActivityContext["taskScope"]): AgentActivityContext => ({ source: "interactive", action: "plan", taskId: "same-id", taskScope });
    writeRun("run-abc123-00000001", activity(homeScope));
    writeRun("run-abc124-00000002", activity());
    writeRun("run-abc125-00000003", activity({ ...homeScope, profile: "work" }));
    writeRun("run-abc126-00000004", activity({ ...workScope, taskCreatedAt: "2000-01-01T00:00:00.000Z" }));
    writeRun("run-abc127-00000005", activity(workScope), "running");
    const reads = vi.spyOn(fs, "readFileSync");
    const directories = vi.spyOn(fs, "readdirSync");
    const writes = vi.spyOn(fs, "writeFileSync");
    const renames = vi.spyOn(fs, "renameSync");
    try {
      const firstBody = readAttention();
      expect(firstBody).toMatchObject({ taskIds: [], failedTaskIds: [], incomplete: false });
      expect(firstBody).not.toHaveProperty("unassignedItems");
      expect(JSON.stringify(firstBody)).not.toMatch(/Private home task|Private run|2000-01-01/);
      expect(reads.mock.calls.some(([file]) => String(file).startsWith(home))).toBe(false);
      expect(directories.mock.calls.some(([dir]) => String(dir).startsWith(home))).toBe(false);
      expect(writes).not.toHaveBeenCalled();
      expect(renames).not.toHaveBeenCalled();
    } finally {
      reads.mockRestore();
      directories.mockRestore();
      writes.mockRestore();
      renames.mockRestore();
    }
    writeRun("run-abc128-00000006", activity(workScope));
    writeRun("run-abc129-00000007", activity(workScope));
    const result = readAttention();
    expect(result).toMatchObject({ taskIds: ["same-id"], failedTaskIds: [], incomplete: false });
  });

  it("shows only the latest verified failure for this profile, not colliding or unscoped runs", async () => {
    const workScope = taskScopeForDirectory("work", work, "same-id", createdAt)!;
    const homeScope = taskScopeForDirectory("home", home, "same-id", createdAt)!;
    const activity = (taskScope?: AgentActivityContext["taskScope"]): AgentActivityContext => ({ source: "interactive", action: "implement", taskId: "same-id", taskScope });
    writeRun("run-abc120-00000001", activity(homeScope), "failed");
    writeRun("run-abc121-00000002", activity(), "failed");
    writeRun("run-abc122-00000003", activity(workScope), "failed");
    let result = readAttention();
    expect(result.failedTaskIds).toEqual(["same-id"]);
    expect(JSON.stringify(result)).not.toMatch(/Private home task|Private run/);

    writeRun("run-abc123-00000004", activity(workScope), "succeeded");
    result = readAttention();
    expect(result.failedTaskIds).toEqual([]);
    writeRun("run-abc124-00000005", activity(workScope), "failed");
    writeRun("run-abc125-00000006", activity(homeScope), "succeeded");
    result = readAttention();
    expect(result.failedTaskIds).toEqual(["same-id"]);
    writeRun("run-abc126-00000007", activity(workScope), "needs-attention");
    result = readAttention();
    expect(result.failedTaskIds).toEqual([]);
    expect(result.taskIds).toEqual(["same-id"]);
    writeRun("run-abc127-00000008", activity(workScope), "succeeded");
    writeRun("run-abc127-00000009", activity(workScope), "failed");
    result = readAttention();
    expect(result.failedTaskIds).toEqual([]);
    expect(result.incomplete).toBe(true);
  });

  it("changes a verified task attention key when a newer run needs attention", async () => {
    const scope = taskScopeForDirectory("work", work, "same-id", createdAt)!;
    const activity: AgentActivityContext = { source: "interactive", action: "implement", taskId: "same-id", taskScope: scope };
    writeRun("run-abc120-00000001", activity, "needs-attention");
    const first = readAttention();
    expect(first.attentionKeys?.["same-id"]).toBeTruthy();
    expect(first).not.toHaveProperty("unassignedItems");
    expect(first).not.toHaveProperty("unassignedLegacy");
    writeRun("run-abc120-00000001", activity, "needs-attention");
    const unchanged = readAttention();
    expect(unchanged.attentionKeys?.["same-id"]).toBe(first.attentionKeys?.["same-id"]);
    writeRun("run-abc121-00000002", activity, "needs-attention");
    const second = readAttention();
    expect(second.attentionKeys?.["same-id"]).not.toBe(first.attentionKeys?.["same-id"]);
  });

  it("projects the repository only from the verified profile run", async () => {
    const checkout = path.join(root, "checkout");
    fs.mkdirSync(path.join(checkout, ".git"), { recursive: true });
    fs.mkdirSync(path.join(checkout, "src"));
    fs.writeFileSync(path.join(checkout, ".git", "config"), "[remote \"origin\"]\nurl = https://github.com/owner/project.git\n");
    const workScope = taskScopeForDirectory("work", work, "same-id", createdAt)!;
    const homeScope = taskScopeForDirectory("home", home, "same-id", createdAt)!;
    writeRun("run-abc120-00000001", { source: "interactive", action: "implement", taskId: "same-id", taskScope: homeScope }, "needs-attention", checkout);
    let result = readAttention();
    expect(result.taskIds).toEqual([]);
    expect(result.repos?.["same-id"]).toBeUndefined();
    writeRun("run-abc121-00000002", { source: "interactive", action: "implement", taskId: "same-id", taskScope: workScope }, "needs-attention", path.join(checkout, "src"));
    result = readAttention();
    expect(result.repos?.["same-id"]).toBe("owner/project");
  });

  it("carries the displayed task profile into a fresh manual launch, but not another task or page", async () => {
    const params = new URLSearchParams("tab=tasks&task=same-id&taskProfile=work");
    expect(taskLaunchProfile("/work", params, "same-id")).toBe("work");
    expect(taskLaunchProfile("/work", params, "other-id")).toBeUndefined();
    expect(taskLaunchProfile("/agents", params, "same-id")).toBeUndefined();
    expect(taskLaunchProfile("/work", new URLSearchParams("task=same-id"), "same-id")).toBeUndefined();

    let runNumber = 0;
    const launch = vi.spyOn(dispatch, "dispatchAgentRun").mockImplementation(async (input): Promise<AgentRun> => {
      const id = `run-abc123-${String(++runNumber).padStart(8, "0")}`;
      return {
        spec: { id, provider: input.provider, providerLabel: input.provider, bin: "test", args: [], format: "text", cwd: input.cwd, title: input.title ?? "Test", prompt: input.prompt, depth: input.depth, createdAt: Date.now(), activity: scopedTaskActivity(input) },
        status: { state: "needs-attention", updatedAt: Date.now(), eventCount: 0 },
        dir: path.join(runs, id),
      };
    });
    const request = (profile?: string, extra: Record<string, unknown> = {}) => new Request("http://localhost/api/agent/runs", {
      method: "POST",
      headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", ...profileHeaders(profile) },
      body: JSON.stringify({ provider: "test", prompt: "Test", cwd: root, taskId: "same-id", taskDate: todayISO(), action: "plan", ...extra }),
    });

    const response = await startManualRun(request(taskLaunchProfile("/work", params, "same-id")));
    expect(response.status).toBe(201);
    const fresh = await response.json();
    expect(fresh.run.activity.taskScope).toEqual(taskScopeForDirectory("work", work, "same-id", createdAt));
    writeRun(fresh.run.id, fresh.run.activity);
    expect(readAttention().taskIds).toEqual(["same-id"]);

    expect((await startManualRun(request("home"))).status).toBe(409);
    expect(launch).toHaveBeenCalledTimes(1);
    const unscoped = await (await startManualRun(request(undefined, { verifiedFreshTask: { id: "same-id", createdAt } }))).json();
    expect(unscoped.run.activity.taskScope).toBeUndefined();
    const followUp = await (await startManualRun(request("work", { parentRunId: "old-run" }))).json();
    expect(followUp.run.activity.taskScope).toBeUndefined();
    const review = await (await startManualRun(request("work", { action: "review" }))).json();
    expect(review.run.activity.taskScope).toBeUndefined();

    const legacy = path.join(root, "legacy-tasks");
    vi.stubEnv("TASKS_DIR", legacy);
    writeTask(legacy, "same-id", "Legacy task");
    const legacyRun = await (await startManualRun(request("legacy"))).json();
    expect(legacyRun.run.activity.taskScope).toEqual(taskScopeForDirectory("legacy", legacy, "same-id", createdAt));
  });

  it("ignores stray files and old history beyond the newest runs", () => {
    fs.mkdirSync(runs, { recursive: true });
    fs.writeFileSync(path.join(runs, "run-abc000-00000000"), "stray");
    for (let index = 0; index < 201; index++) writeRun(`run-abc${100 + index}-${index.toString(16).padStart(8, "0")}`, undefined, "succeeded");
    expect(readAttention().incomplete).toBe(false);
  });

  it("marks unreadable run records incomplete instead of exposing their content", async () => {
    writeRun("run-abc123-00000001", undefined);
    fs.writeFileSync(path.join(runs, "run-abc123-00000001", "spec.json"), "not json");
    const result = readAttention();
    expect(result).toMatchObject({ taskIds: [], failedTaskIds: [], incomplete: true });
    expect(JSON.stringify(result)).not.toContain("Private run");
  });
});
