import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createTask, findTask, withTaskLock, writeItem } from "../../domains/tasks/store";
import { textToBlocks } from "../../../../../packages/shared/markdown-convert/index.ts";
import { NotesStorage } from "../../domains/storage/notes";
import { patchTaskAgentRun, upsertTaskAgentRun } from "../../domains/tasks/task-agent-runs";
import { runtimeSchema, runtimeInventory } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { runtimeServiceTaskOperation, startRuntimeServiceTasks } from "./runtime-service-tasks";

const roots: string[] = [];
const servers: Awaited<ReturnType<typeof startRuntimeServiceTasks>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-service-tasks-")));
  roots.push(root);
  const tasks = path.join(root, "tasks");
  const work = path.join(tasks, "work");
  const notes = path.join(root, "notes");
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(notes, { recursive: true });
  vi.stubEnv("TASKS_DIR", tasks);
  vi.stubEnv("NOTES_DIR", notes);
  vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
  vi.stubEnv("DEVHUB_PROFILE", "work");
  const task = createTask(work, { id: "task-1", text: "Fixture task", createdAt: "2026-01-01T12:00:00.000Z" });
  return { root, tasks, work, notes, task };
}

async function writeTaskNote(notes: string, task: { id: string; startDate: string }) {
  const note = "task-notes/" + task.startDate + "-" + task.id;
  await new NotesStorage(notes).write(note, textToBlocks("# Fixture\n\n## Questions for you\n\n- [ ] Which repo?\n\n## Plan\n\nUse the fixture."), new NotesStorage(notes).read(note)?.revision ?? null);
  return path.join(notes, note + ".json");
}

async function send(endpoint: { port: number; token: string }, input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint.port, "127.0.0.1");
    let text = "";
    socket.once("connect", () => socket.write(JSON.stringify(input) + "\n"));
    socket.on("data", (chunk: Buffer) => { text += chunk.toString("utf8"); });
    socket.once("end", () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
    socket.once("error", reject);
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error("Fixture request timed out")); });
  });
}

it("reads only reviewed task profiles and compares ownership before each write", async () => {
  const { work, task } = fixture();
  const grants = ["profile", "read", "handoff"] as const;
  const ownership = { handoffId: "handoff-1", toUserId: "U123", toName: "Fixture", status: "pending" as const, expiresAt: 1000 };
  const update = { operation: "handoff", profile: "work", taskId: task.id, handoff: ownership, expected: { handoffId: null, createdAt: task.createdAt, text: task.text } };
  expect(await runtimeServiceTaskOperation(grants, { operation: "profile" })).toEqual({ activeProfile: "work", profiles: ["work"] });
  await expect(runtimeServiceTaskOperation(grants, { operation: "profile" }, () => false)).rejects.toThrow(/authorised/);
  expect(await runtimeServiceTaskOperation(grants, { operation: "read", profile: "work", taskId: task.id })).toMatchObject({ id: task.id, text: task.text });
  expect(await runtimeServiceTaskOperation(grants, { ...update, expected: { handoffId: null, createdAt: "stale" } })).toBe(false);
  expect(await runtimeServiceTaskOperation(grants, update)).toBe(true);
  expect(await runtimeServiceTaskOperation(grants, update)).toBe(false);
  expect(await runtimeServiceTaskOperation(grants, { ...update, handoff: { ...ownership, handoffId: "other" }, expected: { handoffId: ownership.handoffId, createdAt: task.createdAt } })).toBe(false);
  expect(await runtimeServiceTaskOperation(grants, { ...update, handoff: { ...ownership, toUserId: "U456", status: "accepted" }, expected: { handoffId: ownership.handoffId, createdAt: task.createdAt } })).toBe(false);
  expect(await runtimeServiceTaskOperation(grants, { ...update, handoff: ownership, expected: { handoffId: ownership.handoffId, createdAt: task.createdAt } })).toBe(false);
  expect(await runtimeServiceTaskOperation(grants, { ...update, handoff: { ...ownership, status: "accepted" }, expected: { handoffId: ownership.handoffId, createdAt: task.createdAt } })).toBe(true);
  expect(await runtimeServiceTaskOperation(grants, { ...update, handoff: null, expected: { handoffId: ownership.handoffId, createdAt: task.createdAt } })).toBe(false);
  writeItem(work, { ...findTask(work, task.id)!, handoff: ownership });
  expect(await runtimeServiceTaskOperation(grants, { ...update, handoff: null, expected: { handoffId: ownership.handoffId, createdAt: task.createdAt } })).toBe(true);
  const current = findTask(work, task.id)!;
  writeItem(work, { ...current, done: true });
  expect(await runtimeServiceTaskOperation(grants, update)).toBe(false);
  await expect(runtimeServiceTaskOperation(["profile"], { operation: "read", profile: "work", taskId: task.id })).rejects.toThrow(/not reviewed/);
  await expect(runtimeServiceTaskOperation(grants, { operation: "read", profile: "other", taskId: task.id })).rejects.toThrow(/profile/);
  await expect(runtimeServiceTaskOperation(grants, { operation: "read", profile: "../work", taskId: task.id })).rejects.toThrow();
});

it("denies symlinked task files and profile directories", async () => {
  if (process.platform === "win32") return;
  const { root, tasks, work, task } = fixture();
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  fs.renameSync(path.join(work, "items", task.id + ".json"), path.join(outside, "item.json"));
  fs.symlinkSync(path.join(outside, "item.json"), path.join(work, "items", task.id + ".json"));
  await expect(runtimeServiceTaskOperation(["read"], { operation: "read", profile: "work", taskId: task.id })).rejects.toThrow(/safe/);
  await expect(runtimeServiceTaskOperation(["read"], { operation: "read", profile: "work", taskId: "another-id" })).rejects.toThrow(/safe/);
  fs.symlinkSync(outside, path.join(tasks, "other"));
  await expect(runtimeServiceTaskOperation(["read"], { operation: "read", profile: "other", taskId: task.id })).rejects.toThrow(/profile/);
});

it("accepts an explicitly configured symlink to the task root", async () => {
  if (process.platform === "win32") return;
  const { root, tasks, task } = fixture();
  const configured = path.join(root, "configured-tasks");
  fs.symlinkSync(tasks, configured);
  vi.stubEnv("TASKS_DIR", configured);
  expect(await runtimeServiceTaskOperation(["read"], { operation: "read", profile: "work", taskId: task.id })).toMatchObject({ id: task.id });
});

it("reads only the requested open task's reviewed context", async () => {
  const { work, notes, task } = fixture();
  await writeTaskNote(notes, task);
  await upsertTaskAgentRun({ taskId: task.id, runId: "run-abcdef-12345678", status: "paused", handoff: "Fixture handoff", notesDir: notes });
  await patchTaskAgentRun(task.id, "run-abcdef-12345678", { cwd: "/fixture/repo" }, notes);
  const request = { operation: "context", profile: "work", taskId: task.id };
  const context = await runtimeServiceTaskOperation(["context"], request);
  expect(context).toMatchObject({ task: { id: task.id }, profile: "work", question: { text: "Which repo?" }, handoff: "Fixture handoff", cwd: "/fixture/repo" });
  expect(context).toHaveProperty("markdown", expect.stringContaining("Use the fixture."));
  await expect(runtimeServiceTaskOperation(["read"], request)).rejects.toThrow(/not reviewed/);
  writeItem(work, { ...task, handoff: { handoffId: "handoff-1", toUserId: "U123", toName: "Fixture", status: "pending", expiresAt: 1000 } });
  await expect(runtimeServiceTaskOperation(["context"], request)).rejects.toThrow(/no longer available/);
});

it("rejects handoff when the reviewed task note changed", async () => {
  const { notes, task } = fixture();
  await writeTaskNote(notes, task);
  const request = { operation: "context", profile: "work", taskId: task.id };
  const before = await runtimeServiceTaskOperation(["context"], request) as { review: string };
  const handoff = { handoffId: "handoff-1", toUserId: "U123", toName: "Fixture", status: "pending", expiresAt: 1000 };
  const update = { operation: "handoff", profile: "work", taskId: task.id, handoff, expected: { handoffId: null, createdAt: task.createdAt, text: task.text, review: before.review } };
  await new NotesStorage(notes).write("task-notes/" + task.startDate + "-" + task.id, textToBlocks("# Fixture\n\n## Questions for you\n\n- [ ] A different question?"), new NotesStorage(notes).read("task-notes/" + task.startDate + "-" + task.id)?.revision ?? null);
  expect(await runtimeServiceTaskOperation(["context", "handoff"], update)).toBe(false);
  const current = await runtimeServiceTaskOperation(["context"], request) as { review: string };
  expect(await runtimeServiceTaskOperation(["context", "handoff"], { ...update, expected: { ...update.expected, review: current.review } })).toBe(true);
});

it("rejects task-context note and run-sidecar symlinks", async () => {
  if (process.platform === "win32") return;
  const { root, notes, task } = fixture();
  const note = await writeTaskNote(notes, task);
  const outside = path.join(root, "outside.json");
  fs.writeFileSync(outside, "[]");
  fs.rmSync(note);
  fs.symlinkSync(outside, note);
  const request = { operation: "context", profile: "work", taskId: task.id };
  await expect(runtimeServiceTaskOperation(["context"], request)).rejects.toThrow(/safe/);
  fs.rmSync(note);
  await writeTaskNote(notes, task);
  const runDir = path.join(notes, ".config", "task-agent-runs");
  fs.mkdirSync(runDir, { recursive: true });
  fs.symlinkSync(outside, path.join(runDir, task.id + ".json"));
  await expect(runtimeServiceTaskOperation(["context"], request)).rejects.toThrow(/safe/);
  fs.rmSync(path.join(runDir, task.id + ".json"));
  fs.writeFileSync(path.join(runDir, task.id + ".json"), "{invalid");
  await expect(runtimeServiceTaskOperation(["context"], request)).rejects.toThrow();
  expect(fs.readdirSync(runDir)).toEqual([task.id + ".json"]);
});

it("rechecks authorization after waiting for the host task write lock", async () => {
  const { work, task } = fixture();
  const defaultUnlock = () => {};
  let unlock = defaultUnlock;
  const holding = withTaskLock(work, () => new Promise<void>((resolve) => { unlock = resolve; }));
  await vi.waitFor(() => expect(unlock).not.toBe(defaultUnlock));
  let authorised = true;
  const update = runtimeServiceTaskOperation(["handoff"], {
    operation: "handoff", profile: "work", taskId: task.id,
    handoff: { handoffId: "handoff-1", toUserId: "U123", toName: "Fixture", status: "pending", expiresAt: 1000 },
    expected: { handoffId: null, createdAt: task.createdAt, text: task.text },
  }, () => authorised);
  const denied = expect(update).rejects.toThrow(/authorised/);
  authorised = false;
  unlock();
  await holding;
  await denied;
  expect(findTask(work, task.id)?.handoff).toBeUndefined();
});

it("does not transfer a task edited while another host write holds the lock", async () => {
  const { work, task } = fixture();
  const defaultUnlock = () => {};
  let unlock = defaultUnlock;
  const holding = withTaskLock(work, async () => {
    await new Promise<void>((resolve) => { unlock = resolve; });
    writeItem(work, { ...task, text: "Changed by the host" });
  });
  await vi.waitFor(() => expect(unlock).not.toBe(defaultUnlock));
  const update = runtimeServiceTaskOperation(["handoff"], {
    operation: "handoff", profile: "work", taskId: task.id,
    handoff: { handoffId: "handoff-1", toUserId: "U123", toName: "Fixture", status: "pending", expiresAt: 1000 },
    expected: { handoffId: null, createdAt: task.createdAt, text: task.text },
  });
  unlock();
  await holding;
  expect(await update).toBe(false);
  expect(findTask(work, task.id)).toMatchObject({ text: "Changed by the host" });
  expect(findTask(work, task.id)?.handoff).toBeUndefined();
});

it("binds task requests to the current service token and closes on shutdown", async () => {
  const { task } = fixture();
  let current = true;
  const server = await startRuntimeServiceTasks(["read"], () => current);
  servers.push(server);
  const endpoint = JSON.parse(server.environment) as { port: number; token: string };
  const request = { operation: "read", profile: "work", taskId: task.id };
  expect(await send(endpoint, { token: endpoint.token, request })).toMatchObject({ ok: true, result: { id: task.id } });
  expect(await send(endpoint, { token: "0".repeat(64), request })).toEqual({ ok: false });
  expect(await send(endpoint, { token: endpoint.token, request: { operation: "profile" } })).toEqual({ ok: false });
  expect(await send(endpoint, { token: endpoint.token, request, extra: true })).toEqual({ ok: false });
  current = false;
  expect(await send(endpoint, { token: endpoint.token, request })).toEqual({ ok: false });
  await server.close();
  servers.splice(servers.indexOf(server), 1);
  await expect(send(endpoint, { token: endpoint.token, request })).rejects.toThrow();
});

it("requires explicit loopback access and displays the reviewed service task grants", () => {
  const runtime = {
    api: "1", transport: "request-worker", entry: "entry.mjs", sha256: "0".repeat(64),
    lockfile: { path: "package-lock.json", sha256: "0".repeat(64) }, pages: [], routes: [], mcp: [],
    capabilities: { service: { id: "service", label: "Fixture", maxRunSeconds: 30, tasks: ["read", "handoff"] } },
    permissions: { env: [], network: [], exec: false },
  };
  expect(runtimeSchema.safeParse(runtime).success).toBe(false);
  const reviewed = runtimeSchema.parse({ ...runtime, permissions: { ...runtime.permissions, network: ["127.0.0.1"] } });
  expect(runtimeInventory(reviewed).find((item) => item.kind === "Background service")?.entries[0]).toContain("read tasks in those profiles, change task handoff ownership");
  expect(runtimeSchema.safeParse({ ...reviewed, capabilities: { service: { ...reviewed.capabilities!.service!, tasks: ["read", "read"] } } }).success).toBe(false);
});
