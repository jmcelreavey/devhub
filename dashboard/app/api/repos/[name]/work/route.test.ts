import { beforeEach, describe, expect, it, vi } from "vitest";

const sources = vi.hoisted(() => ({
  calendar: vi.fn(),
  jira: vi.fn(),
  prs: vi.fn(),
  tasks: vi.fn(),
}));
vi.mock("@/lib/google-calendar", () => ({ getEventsInRange: sources.calendar }));
vi.mock("@/lib/jira/client", () => ({ getMyTicketsCached: sources.jira }));
vi.mock("@/lib/scanned-repo", () => ({ resolveScannedRepo: () => "/tmp/app" }));
vi.mock("@/lib/repos", () => ({ getGithubFullNameForLocalRepo: () => "example/app" }));
vi.mock("@/lib/github/prs", () => ({
  resolveCanonicalRepoFullName: async (name: string) => name,
  rowFromSearchItem: (row: unknown) => row,
  searchIssues: sources.prs,
}));
vi.mock("@/lib/tasks/storage", async () => {
  const { isTaskOpen } = await import("@/lib/tasks/types");
  return { isTaskOpen, ensureTasksMigrated: async () => {}, getTasks: sources.tasks, listTaskDays: () => [] };
});
vi.mock("@/lib/entity-links/resolve", () => ({
  resolveEntityLinks: (kind: string) => ({
    related: kind === "calendar" ? [{ kind: "repo", id: "app", label: "app" }] : [],
    notes: [],
  }),
}));
vi.mock("@/lib/notes/note-index", () => ({ getNoteIndex: () => ({ notes: [] }) }));
vi.mock("@/lib/recall/store", () => ({ loadIndex: () => null }));

import { GET } from "./route";

const pullRequest = { url: "https://github.com/example/app/pull/7", title: "Fix login", repo: "example/app", number: 7 };
const ticket = { key: "APP-7", summary: "Fix login", status: "In Progress", url: "https://jira.example/APP-7" };
const task = { id: "task-7", text: "Fix login", done: false, createdAt: "2026-09-24T08:00:00Z", jiraKey: "APP-7", links: [{ kind: "repo" as const, id: "app", label: "app" }] };

function request() {
  return GET(new Request("http://localhost/api/repos/app/work"), { params: Promise.resolve({ name: "app" }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  sources.calendar.mockResolvedValue([]);
  sources.jira.mockResolvedValue([ticket]);
  sources.prs.mockResolvedValue([pullRequest]);
  sources.tasks.mockReturnValue([task]);
});

describe("GET /api/repos/[name]/work partial integration failures", () => {
  it("reports a Calendar failure while preserving Jira, local tasks and pull requests", async () => {
    sources.calendar.mockRejectedValue(new Error("Calendar request timed out"));
    const response = await request();
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.degraded).toEqual([{ source: "Calendar", message: "Calendar request timed out" }]);
    expect(payload.openPrs).toEqual([pullRequest]);
    expect(payload.myPrUrls).toEqual([pullRequest.url]);
    expect(payload.model.clusters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jira: expect.objectContaining({ key: ticket.key }),
        tasks: expect.arrayContaining([expect.objectContaining({ id: task.id })]),
      }),
    ]));
    expect(payload.model.leftoverEvents).toEqual([]);
  });

  it("clears the warning on a successful retry without discarding the recovered events", async () => {
    sources.calendar.mockRejectedValueOnce(new Error("invalid_grant"));
    expect((await (await request()).json()).degraded).toEqual([
      { source: "Calendar", message: "invalid_grant" },
    ]);

    const start = new Date().toISOString();
    sources.calendar.mockResolvedValueOnce([{ id: "meeting-7", title: "Review #app", start, end: start }]);
    const payload = await (await request()).json();
    expect(payload).not.toHaveProperty("degraded");
    expect(payload.model.leftoverEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "meeting-7", title: "Review #app" }),
    ]));
    expect(payload.openPrs).toEqual([pullRequest]);
  });
});
