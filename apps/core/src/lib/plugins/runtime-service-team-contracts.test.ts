import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { execExternal } from "../exec-external";
import { createTask, findTask, writeItem } from "../../domains/tasks/store";
import { upsertTaskAgentRun } from "../../domains/tasks/task-agent-runs";
import { NotesStorage } from "../../domains/storage/notes";
import { blocksToText, textToBlocks } from "../../../../../packages/shared/markdown-convert/index.ts";
import { tryAcquireProcessDirectoryLock } from "../../../../../packages/shared/process/directory-lock.ts";
import { runtimeServiceTaskOperation } from "./runtime-service-tasks";
import { acknowledgeFailure } from "../storyboard/failure-acknowledgements";
import { emptyWorkflow } from "../workflows/store";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-team-contracts-")));
  roots.push(root);
  const tasks = path.join(root, "tasks");
  const work = path.join(tasks, "work");
  const personal = path.join(tasks, "personal");
  const notes = path.join(root, "notes");
  const config = path.join(root, "config");
  for (const dir of [work, personal, notes, config]) fs.mkdirSync(dir, { recursive: true });
  vi.stubEnv("TASKS_DIR", tasks);
  vi.stubEnv("NOTES_DIR", notes);
  vi.stubEnv("DEVHUB_CONFIG_DIR", config);
  vi.stubEnv("DEVHUB_APP_DATA", path.join(root, "app-data"));
  vi.stubEnv("DEVHUB_PROFILE", "work");
  const task = createTask(work, { id: "task-1", text: "Work task", createdAt: "2026-01-01T12:00:00.000Z" });
  createTask(personal, { id: "task-2", text: "Personal task", createdAt: "2026-01-01T12:00:00.000Z" });
  return { root, work, personal, notes, config, task };
}

it("exposes a confined read-only board only for a reviewed grant and known profile", async () => {
  const { personal, notes } = fixture();
  const request = { operation: "board-snapshot", profile: "personal" };
  await expect(runtimeServiceTaskOperation([], request)).rejects.toThrow(/not reviewed/);
  expect(await runtimeServiceTaskOperation(["board-snapshot"], request)).toMatchObject({ cards: [{ taskId: "task-2" }], errors: [] });
  await expect(runtimeServiceTaskOperation(["board-snapshot"], { ...request, profile: "unknown" })).rejects.toThrow(/profile/);
  await upsertTaskAgentRun({ taskId: "task-2", runId: "run-abcdef-12345678", status: "failed", notesDir: notes });
  await acknowledgeFailure("task-2", "previous failure identity", notes);
  expect(await runtimeServiceTaskOperation(["board-snapshot"], request)).toMatchObject({ errors: [expect.stringContaining("acknowledgement")] });
  if (process.platform !== "win32") {
    const file = path.join(personal, "items", "task-2.json");
    fs.renameSync(file, file + ".saved");
    fs.symlinkSync(file + ".saved", file);
    await expect(runtimeServiceTaskOperation(["board-snapshot"], request)).rejects.toThrow(/safe/);
  }
});

it("keeps valid workflows in the board when an unrelated workflow is malformed", async () => {
  const { notes, task } = fixture();
  const workflows = path.join(notes, ".config", "task-workflows");
  fs.mkdirSync(workflows, { recursive: true });
  fs.writeFileSync(path.join(workflows, `${task.id}.json`), JSON.stringify(emptyWorkflow(task.id)));
  fs.writeFileSync(path.join(workflows, "unrelated.json"), "{");

  const snapshot = await runtimeServiceTaskOperation(["board-snapshot"], { operation: "board-snapshot", profile: "work" });
  expect(snapshot).toMatchObject({
    cards: [expect.objectContaining({ taskId: task.id })],
    items: [expect.objectContaining({ workflow: expect.objectContaining({ taskId: task.id }) })],
    errors: [expect.stringContaining("task-workflows/unrelated.json")],
  });
});

it("returns bounded safe fields from enabled plugin needs only when reviewed", async () => {
  const { root, config } = fixture();
  const plugin = path.join(root, "fixture-plugin");
  const needs = path.join(config, "plugin-needs");
  fs.mkdirSync(plugin);
  fs.mkdirSync(needs);
  fs.writeFileSync(path.join(plugin, "devhub-plugin.json"), JSON.stringify({ name: "fixture", version: "1", devhubApi: "1", contributes: {} }));
  fs.writeFileSync(path.join(config, "plugins.json"), JSON.stringify({ plugins: [{ name: "fixture", path: plugin }] }));
  const file = path.join(needs, "fixture.json");
  fs.writeFileSync(file, JSON.stringify({ items: [{ id: "one", title: "  Needs  attention ", reason: "review", href: "//unsafe", private: "do not expose", severity: "urgent" }, { id: "two", severity: "invalid" }] }));
  const request = { operation: "plugin-needs", profile: "work" };
  await expect(runtimeServiceTaskOperation([], request)).rejects.toThrow(/not reviewed/);
  expect(await runtimeServiceTaskOperation(["plugin-needs"], request)).toEqual([{ plugin: "fixture", createdAt: expect.any(String), items: [{ id: "one", title: "Needs attention", reason: "review", severity: "urgent" }, { id: "two" }] }]);
  if (process.platform !== "win32") {
    fs.renameSync(file, file + ".saved");
    fs.symlinkSync(file + ".saved", file);
    expect(await runtimeServiceTaskOperation(["plugin-needs"], request)).toEqual([]);
    fs.unlinkSync(file);
    await execExternal("mkfifo", [file], { timeoutMs: 1000 });
    // A child deadline keeps a blocking open regression from hanging Vitest itself.
    const modulePath = fileURLToPath(new URL("./runtime-service-plugin-needs.ts", import.meta.url));
    const worker = `const { servicePluginNeeds } = require(${JSON.stringify(modulePath)});
      process.stdout.write(JSON.stringify(servicePluginNeeds(() => true)));`;
    const result = await execExternal(process.execPath, ["--import", "tsx", "--eval", worker], { timeoutMs: 5000 });
    expect(JSON.parse(result.stdout)).toEqual([]);
  }
}, 10_000);

it("reads current workflow state only with a reviewed grant", async () => {
  const { task } = fixture();
  const request = { operation: "workflow-state", profile: "work", taskId: task.id, createdAt: task.createdAt };
  await expect(runtimeServiceTaskOperation([], request)).rejects.toThrow(/not reviewed/);
  expect(await runtimeServiceTaskOperation(["workflow-state"], request)).toEqual({ kind: "idle" });
  await expect(runtimeServiceTaskOperation(["workflow-state"], { ...request, createdAt: "stale" })).rejects.toThrow(/no longer available/);
  await expect(runtimeServiceTaskOperation(["workflow-state"], { ...request, profile: "personal" })).rejects.toThrow(/profile|authorisation/);
});

it("appends a workflow note only with a reviewed grant", async () => {
  const { notes, task } = fixture();
  const request = { operation: "workflow-note", profile: "work", taskId: task.id, createdAt: task.createdAt, line: "Feedback from Slack" };
  await expect(runtimeServiceTaskOperation([], request)).rejects.toThrow(/not reviewed/);
  await expect(runtimeServiceTaskOperation(["workflow-note"], { ...request, createdAt: "stale" })).rejects.toThrow(/no longer available/);
  expect(await runtimeServiceTaskOperation(["workflow-note"], request)).toBeNull();
  expect(blocksToText(new NotesStorage(notes).read(`task-notes/${task.startDate}-${task.id}`)!.content as unknown[])).toContain(request.line);
  await expect(runtimeServiceTaskOperation(["workflow-note"], { ...request, line: "line one\nline two" })).rejects.toThrow();
});

it("does not answer a question if authorisation or task identity changes while waiting to write", async () => {
  const { work, notes, task } = fixture();
  const note = `task-notes/${task.startDate}-${task.id}`;
  const storage = new NotesStorage(notes);
  await storage.write(note, textToBlocks("# Fixture\n\n## Questions for you\n\n- [ ] Which colour?"), null);
  const questions = await runtimeServiceTaskOperation(["questions"], { operation: "questions", profile: "work", taskId: task.id }) as { questions: Array<{ id: string; text: string }> };
  const question = questions.questions[0];
  const request = { operation: "answer", profile: "work", taskId: task.id, createdAt: task.createdAt, answer: "Blue", expected: { id: question.id, text: question.text } };
  await expect(runtimeServiceTaskOperation(["answer"], { ...request, createdAt: "stale" })).rejects.toThrow(/task changed/);
  for (const change of ["authorisation", "task"] as const) {
    const unlock = tryAcquireProcessDirectoryLock(path.join(notes, ".content-write.lock"));
    if (!unlock) throw new Error("Could not lock fixture content");
    let authorised = true;
    const current = vi.fn(() => authorised);
    const pending = runtimeServiceTaskOperation(["answer"], request, current);
    const denied = expect(pending).rejects.toThrow(change === "task" ? /task changed/ : /authorised/);
    await vi.waitFor(() => expect(current.mock.calls.length).toBeGreaterThanOrEqual(3));
    if (change === "authorisation") authorised = false;
    else writeItem(work, { ...findTask(work, task.id)!, text: "Changed while waiting" });
    unlock();
    await denied;
  }
  expect(blocksToText(storage.read(note)!.content as unknown[])).not.toContain("Blue");
});

it("rejects a selected answer option that changed before the write", async () => {
  const { notes, task } = fixture();
  const note = `task-notes/${task.startDate}-${task.id}`;
  const storage = new NotesStorage(notes);
  await storage.write(note, textToBlocks("# Fixture\n\n## Questions for you\n\n- [ ] Which colour? Options: Blue | Red"), null);
  const questions = await runtimeServiceTaskOperation(["questions"], { operation: "questions", profile: "work", taskId: task.id }) as { questions: Array<{ id: string; text: string; options?: string[] }> };
  const question = questions.questions[0];
  expect(question.options).toEqual(["Blue", "Red"]);
  const request = { operation: "answer", profile: "work", taskId: task.id, createdAt: task.createdAt, answer: "Blue", expected: { id: question.id, text: question.text, option: "Blue" } };
  await expect(runtimeServiceTaskOperation(["answer"], { ...request, expected: { ...request.expected, option: "Purple" } })).rejects.toThrow(/question changed/);
  await expect(runtimeServiceTaskOperation(["answer"], { ...request, answer: "Red" })).rejects.toThrow(/question changed/);
  const unlock = tryAcquireProcessDirectoryLock(path.join(notes, ".content-write.lock"));
  if (!unlock) throw new Error("Could not lock fixture content");
  const authorised = vi.fn(() => true);
  const pending = runtimeServiceTaskOperation(["answer"], request, authorised);
  const denied = expect(pending).rejects.toThrow(/question changed/);
  await vi.waitFor(() => expect(authorised.mock.calls.length).toBeGreaterThanOrEqual(3));
  const file = path.join(notes, note + ".json");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("Blue", "Green"));
  unlock();
  await denied;
  expect(await runtimeServiceTaskOperation(["answer"], { ...request, answer: "Green", expected: { ...request.expected, option: "Green" } })).toMatchObject({ question: { id: question.id, text: question.text }, remaining: 0 });
});
