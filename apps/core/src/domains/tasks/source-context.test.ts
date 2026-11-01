import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getJiraSourceContext, type JiraSourceContext } from "../../lib/jira/client";
import { currentTaskNode } from "./task-index";
import { activeTaskProfile } from "./profile-request";
import { acknowledgeSourceContext, readSourceContext, refreshSourceContext, SourceContextConflict } from "./source-context";

const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("../../lib/notes/dir", () => ({
  getActiveTasksDir: () => path.join(fixture.root, "tasks"),
  getNotesDir: () => path.join(fixture.root, "notes"),
}));
vi.mock("../../lib/jira/client", () => ({ getJiraSourceContext: vi.fn() }));
vi.mock("./task-index", () => ({ loadTaskIndex: vi.fn(), currentTaskNode: vi.fn() }));
vi.mock("./task-notes", () => ({ resolveTaskNotePath: () => "brief" }));
vi.mock("./profile-request", () => ({ activeTaskProfile: vi.fn() }));
const source: JiraSourceContext = { key: "DEV-1", summary: "Source title", description: "Jira description",
  updated: null, parent: null, links: [], comments: [], commentTotal: 0, truncated: false };
const node = { task: { id: "task-1", text: "My edited brief", jiraKey: "DEV-1", links: [], done: false, startDate: "2026-10-26", rank: "1", createdAt: "2026-10-26T12:00:00Z" }, date: "2026-10-26" };
function writeBrief(text: string) {
  fs.writeFileSync(path.join(fixture.root, "notes/brief.json"), JSON.stringify([
    { type: "paragraph", content: [{ type: "text", text }], children: [] },
  ]));
}
beforeEach(() => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-source-test-"));
  fs.mkdirSync(path.join(fixture.root, "notes"));
  writeBrief("Keep my edits");
  vi.mocked(currentTaskNode).mockReturnValue(node as ReturnType<typeof currentTaskNode>);
  vi.mocked(activeTaskProfile).mockReturnValue("work");
  vi.mocked(getJiraSourceContext).mockResolvedValue(source);
});
afterEach(() => { fs.rmSync(fixture.root, { recursive: true, force: true }); vi.resetAllMocks(); });
it("refreshes source separately and invalidates acknowledgement after a brief edit", async () => {
  const before = fs.readFileSync(path.join(fixture.root, "notes/brief.json"), "utf8");
  const refreshed = await refreshSourceContext("task-1", null);
  expect(refreshed.stale).toBe(true);
  expect(fs.readFileSync(path.join(fixture.root, "notes/brief.json"), "utf8")).toBe(before);
  const reviewed = await acknowledgeSourceContext("task-1", refreshed.snapshot!.revision, refreshed.briefRevision);
  expect(reviewed.stale).toBe(false);
  writeBrief("A newer human edit");
  expect(readSourceContext("task-1").stale).toBe(true);
  await expect(acknowledgeSourceContext("task-1", refreshed.snapshot!.revision, refreshed.briefRevision)).rejects.toBeInstanceOf(SourceContextConflict);
});
it("rejects a concurrent refresh and retains the newer source", async () => {
  let resolve!: (value: JiraSourceContext) => void;
  vi.mocked(getJiraSourceContext).mockReturnValueOnce(new Promise(value => { resolve = value; }));
  const slow = refreshSourceContext("task-1", null);
  const newer = await refreshSourceContext("task-1", null);
  resolve({ ...source, description: "Late stale response" });
  await expect(slow).rejects.toBeInstanceOf(SourceContextConflict);
  expect(readSourceContext("task-1").snapshot).toEqual(newer.snapshot);
});
it.each(["profile", "ticket"])("rejects a changed %s while Jira is loading", async kind => {
  vi.mocked(getJiraSourceContext).mockImplementationOnce(async () => {
    if (kind === "profile") vi.mocked(activeTaskProfile).mockReturnValue("personal");
    else vi.mocked(currentTaskNode).mockReturnValue({ ...node, task: { ...node.task, jiraKey: "DEV-2" } } as ReturnType<typeof currentTaskNode>);
    return source;
  });
  await expect(refreshSourceContext("task-1", null)).rejects.toBeInstanceOf(SourceContextConflict);
  expect(readSourceContext("task-1").snapshot).toBeNull();
});
