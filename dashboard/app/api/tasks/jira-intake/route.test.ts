import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addTask, getTasks, setTaskCompletion } from "@/lib/tasks/storage";
import { todayISO } from "@/lib/utils";
import { GET, POST } from "./route";
import type { CaptureInput } from "@/lib/tasks/capture";
import { patchTask } from "@shared/tasks/store.ts";
import { buildTaskNoteMarkdown, taskNotePath } from "@/lib/task-note";
import { textToBlocks } from "@/lib/markdown-convert";

const mocks = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/tasks/capture", () => ({ captureDraftTask: mocks.capture }));

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "jira-intake-"));
  vi.stubEnv("REPO_ROOT", root);
  vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
  vi.stubEnv("DEVHUB_PROFILE", "work");
  fs.mkdirSync(path.join(root, "tasks", "work"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks", "home"), { recursive: true });
  mocks.capture.mockImplementation(async (input: CaptureInput) => ({ task: await addTask(input.text, undefined, undefined, input.links, "draft"), date: todayISO() }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

const ticket = { key: "TEST-1", summary: "Fix the empty state", url: "https://example.atlassian.net/browse/TEST-1" };
function request(method: "GET" | "POST", body?: unknown) {
  return new NextRequest("http://localhost:1337/api/tasks/jira-intake", { method, headers: { origin: "http://localhost:1337", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

describe("profile-scoped Jira intake", () => {
  it("captures exactly one draft under concurrent submissions and never dispatches work", async () => {
    const responses = await Promise.all([POST(request("POST", ticket)), POST(request("POST", ticket))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const results = await Promise.all(responses.map((response) => response.json()));
    expect(results[0].task.id).toBe(results[1].task.id);
    expect(results[0].task.stage).toBe("draft");
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(getTasks()).toHaveLength(1);
  });

  it("normalises Jira keys using the existing underscore-compatible format", async () => {
    const response = await POST(request("POST", { ...ticket, key: " team_ops-2 " }));
    expect(response.status).toBe(201);
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: `TEAM_OPS-2 ${ticket.summary}`, links: [{ kind: "jira", id: "TEAM_OPS-2", label: "TEAM_OPS-2", href: ticket.url }] }));
  });

  it("finds explicit Jira links and historical completed tasks rather than creating duplicates", async () => {
    const existing = await addTask("Already handled", "2026-10-01", undefined, [{ kind: "jira", id: "TEST-1", label: "Ticket", href: ticket.url }]);
    await setTaskCompletion(existing.id, true, "2026-10-01");
    const response = await POST(request("POST", ticket));
    expect(await response.json()).toMatchObject({ created: false, task: { id: existing.id } });
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(await (await GET(request("GET"))).json()).toMatchObject({ linked: { "TEST-1": { taskId: existing.id } } });
  });

  it("doesn't treat a pending child's parent context as its own Jira ticket", async () => {
    const child = await addTask("Android login", undefined, undefined, [{ kind: "jira", id: "PTF-4891", label: "Parent PTF-4891" }], undefined, "PTF-4891");
    expect(child.jiraKey).toBeUndefined();
    expect(await (await GET(request("GET"))).json()).toEqual({ profile: "work", linked: {} });
    patchTask(path.join(root, "tasks", "work"), child.id, { text: "PTF-5271: Android login", jiraKey: "PTF-5271" });
    expect(await (await GET(request("GET"))).json()).toEqual({ profile: "work", linked: { "PTF-5271": { taskId: child.id, date: child.startDate } } });
  });

  it("never opens or reuses a ticket's task from another profile", async () => {
    vi.stubEnv("DEVHUB_PROFILE", "home");
    const foreign = await addTask("TEST-1 Home task");
    vi.stubEnv("DEVHUB_PROFILE", "work");
    expect(await (await GET(request("GET"))).json()).toEqual({ profile: "work", linked: {} });
    const result = await (await POST(request("POST", ticket))).json();
    expect(result.created).toBe(true);
    expect(result.task.id).not.toBe(foreign.id);
  });

  it("recognises a Jira integration ref without a legacy key or link", async () => {
    const existing = await addTask("Already linked");
    patchTask(path.join(root, "tasks", "work"), existing.id, { integrationRefs: [{ provider: "jira", account: "default", kind: "issue", id: ticket.key }] });
    const response = await POST(request("POST", ticket));
    expect(await response.json()).toMatchObject({ created: false, task: { id: existing.id } });
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("recognises Jira links kept only in the task note", async () => {
    const existing = await addTask("Plan in its note");
    const source = { ...existing, date: existing.startDate, related: [{ kind: "jira" as const, id: ticket.key, label: ticket.key, href: ticket.url }] };
    const file = path.join(root, "notes", `${taskNotePath(source)}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(textToBlocks(buildTaskNoteMarkdown(source))));
    expect(await (await GET(request("GET"))).json()).toMatchObject({ linked: { "TEST-1": { taskId: existing.id } } });
    expect(await (await POST(request("POST", ticket))).json()).toMatchObject({ created: false, task: { id: existing.id } });
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("doesn't create a possible duplicate when a linked task note can't be checked", async () => {
    const existing = await addTask("Unreadable note");
    const file = path.join(root, "notes", `${taskNotePath({ ...existing, date: existing.startDate })}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not json");
    expect((await POST(request("POST", ticket))).status).toBe(500);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it.each([{ ...ticket, key: "../escape" }, { ...ticket, url: "javascript:alert(1)" }, { ...ticket, summary: "" }])("validates the intake payload before writing", async (body) => {
    expect((await POST(request("POST", body))).status).toBe(400);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("keeps the existing dashboard auth boundary", async () => {
    expect((await POST(new NextRequest("http://localhost:1337/api/tasks/jira-intake", { method: "POST", body: JSON.stringify(ticket) }))).status).toBeGreaterThanOrEqual(401);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("refuses a stale-profile Add instead of writing into a new profile", async () => {
    const response = await POST(request("POST", { ...ticket, profile: "home" }));
    expect(response.status).toBe(409);
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
