import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, findTask, patchTask } from "@shared/tasks/store.ts";
import type { IntegrationProvider } from "./types";
import { WriteInputSchema, type WriteResult } from "./write-types";
import { captureTaskJiraKey, linkCreatedJiraTask } from "./jira-task-link";
import { writeNow } from "./write-store";

vi.mock("./registry", () => ({ providerFor: vi.fn() }));
vi.mock("@/lib/tasks/storage", () => ({ ensureTasksMigrated: async () => undefined }));

let root: string;
let work: string;
let home: string;
const signal = new AbortController().signal;
const now = Date.parse("2026-10-18T12:00:00Z");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fx1-jira-task-"));
  work = path.join(root, "tasks", "work");
  home = path.join(root, "tasks", "home");
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
  vi.stubEnv("DEVHUB_PROFILE", "work");
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

function proposal(taskId: string, taskJiraKey: string | null = null): WriteResult {
  return {
    id: "c2bf5680-9be3-421c-ad48-e428e536a6dc", profile: "work", source: "MCP", createdAt: new Date(now).toISOString(), state: "succeeded", taskJiraKey,
    input: WriteInputSchema.parse({ action: "issue.create", provider: "jira", account: "default", projectKey: "PTF", parentKey: "PTF-4891", taskId, title: "Android login", body: "Fix the login screen." }),
    receipt: { detail: "Created PTF-5271", item: { ref: { provider: "jira", account: "default", kind: "issue", id: "PTF-5271" }, title: "Android login", url: "https://jira.example.test/browse/PTF-5271" } },
  };
}

describe("created Jira ticket write-back", () => {
  it("stores the child key and keeps the parent as context, idempotently", async () => {
    const task = createTask(work, { text: "PTF-4891 Android login", parentKey: "PTF-4891", links: [{ kind: "jira", id: "PTF-4891", label: "Parent PTF-4891" }, { kind: "repo", id: "app", label: "app" }] });
    expect(task).toMatchObject({ text: "Android login", parentKey: "PTF-4891" });
    expect(task.jiraKey).toBeUndefined();
    const saved = proposal(task.id, await captureTaskJiraKey("work", task.id));
    expect(await linkCreatedJiraTask(saved)).toBe("linked");
    const linked = findTask(work, task.id)!;
    expect(linked).toMatchObject({ text: "PTF-5271: Android login", jiraKey: "PTF-5271", parentKey: "PTF-4891", done: false });
    expect(linked.links).toEqual([
      { kind: "repo", id: "app", label: "app" },
      { kind: "jira", id: "PTF-5271", label: "PTF-5271", href: "https://jira.example.test/browse/PTF-5271" },
      { kind: "jira", id: "PTF-4891", label: "Parent PTF-4891" },
    ]);
    expect(linked.integrationRefs).toEqual([saved.receipt!.item!.ref]);
    expect(await linkCreatedJiraTask(saved)).toBe("linked");
    expect(findTask(work, task.id)).toEqual(linked);
  });

  it("can replace an originally misbound parent key but never a key changed by hand meanwhile", async () => {
    const task = createTask(work, { text: "PTF-4891: Android login" });
    const saved = proposal(task.id, "PTF-4891");
    expect(await linkCreatedJiraTask(saved)).toBe("linked");
    expect(findTask(work, task.id)).toMatchObject({ text: "PTF-5271: Android login", jiraKey: "PTF-5271", parentKey: "PTF-4891" });
    const manual = createTask(work, { text: "Android logout" });
    const pending = proposal(manual.id, await captureTaskJiraKey("work", manual.id));
    patchTask(work, manual.id, { text: "PTF-6000: Chosen by hand", jiraKey: "PTF-6000" });
    const before = findTask(work, manual.id);
    expect(await linkCreatedJiraTask(pending)).toBe("skipped");
    expect(findTask(work, manual.id)).toEqual(before);
  });

  it("writes only the proposal's profile even if the active profile switches", async () => {
    const task = createTask(work, { id: "same-task", text: "Work task" });
    const other = createTask(home, { id: task.id, text: "Home task" });
    vi.stubEnv("DEVHUB_PROFILE", "home");
    await linkCreatedJiraTask(proposal(task.id));
    expect(findTask(work, task.id)?.jiraKey).toBe("PTF-5271");
    expect(findTask(home, task.id)).toEqual(other);
  });

  it("does not link uncertain or unmatched receipts, or the parent's own key", async () => {
    const task = createTask(work, { text: "Android login" });
    const saved = proposal(task.id);
    for (const state of ["unknown", "failed"] as const) expect(await linkCreatedJiraTask({ ...saved, state })).toBe("skipped");
    expect(await linkCreatedJiraTask({ ...saved, taskJiraKey: undefined })).toBe("skipped");
    expect(await linkCreatedJiraTask({ ...saved, receipt: undefined })).toBe("skipped");
    saved.receipt!.item!.ref.id = "PTF-4891";
    expect(await linkCreatedJiraTask(saved)).toBe("skipped");
    expect(findTask(work, task.id)).toEqual(task);
  });

  it("creates and links the ticket immediately in the captured profile", async () => {
    const task = createTask(work, { text: "Android login", parentKey: "PTF-4891" });
    const input = proposal(task.id).input;
    const provider: IntegrationProvider = {
      id: "jira", apiVersion: 1, label: "Jira", capabilities: ["issue.create"], accounts: () => [{ id: "default", provider: "jira", label: "Default" }], get: vi.fn(),
      prepareWrite: vi.fn(async () => ({ destination: "https://jira.example.test", actor: "John", summary: "Create child", details: {}, native: {} })),
      executeWrite: vi.fn(async () => proposal(task.id).receipt!),
    };
    const options = { root: path.join(root, "writes"), now, provider: () => provider };
    const { result } = await writeNow(input, "work", signal, options);
    expect(result).toMatchObject({ state: "succeeded", taskLink: "linked", taskJiraKey: null, input: { taskId: task.id } });
    expect(findTask(work, task.id)?.jiraKey).toBe("PTF-5271");
    expect(provider.executeWrite).toHaveBeenCalledTimes(1);
  });
});
