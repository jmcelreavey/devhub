import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTasks: vi.fn(),
  getTicket: vi.fn(),
  resolveLocalGithubRepos: vi.fn(),
}));

vi.mock("@/lib/tasks/storage", () => ({ getTasks: mocks.getTasks }));
vi.mock("@/lib/jira/client", () => ({ getTicket: mocks.getTicket }));
vi.mock("@/lib/repos/resolution", () => ({ resolveLocalGithubRepos: mocks.resolveLocalGithubRepos }));

import { GET } from "./route";

describe("GET /api/tasks/implement/plan", () => {
  beforeEach(() => {
    mocks.getTasks.mockReset();
    mocks.getTicket.mockReset();
    mocks.resolveLocalGithubRepos.mockReset();
    mocks.resolveLocalGithubRepos.mockResolvedValue([]);
  });

  afterEach(() => vi.useRealTimers());

  it("requires a task id", async () => {
    const response = await GET(new NextRequest("http://test/api/tasks/implement/plan"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "taskId required" });
  });

  it("rejects unsafe task dates", async () => {
    const response = await GET(
      new NextRequest("http://test/api/tasks/implement/plan?taskId=task-1&date=../../secrets"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "date must be YYYY-MM-DD" });
    expect(mocks.getTasks).not.toHaveBeenCalled();
  });

  it("returns task, tag, Jira, note, and repo context", async () => {
    mocks.getTasks.mockReturnValue([
      {
        id: "task-1",
        text: "Implement article footer #mobile #ptf",
        done: false,
        jiraKey: "PTF-4781",
        createdAt: "2026-08-25T10:00:00.000Z",
        links: [
          { kind: "repo", id: "businessinsider/app-poc", label: "app-poc" },
          { kind: "note", id: "projects/article-plan", label: "Article plan" },
        ],
      },
    ]);
    mocks.getTicket.mockResolvedValue({
      key: "PTF-4781",
      summary: "Article screen footer",
      status: { name: "In Progress" },
      issuetype: "Story",
      parent: null,
    });
    mocks.resolveLocalGithubRepos.mockResolvedValue([
      {
        fullName: "businessinsider/app-poc",
        repo: { name: "app-poc", path: "/repos/app-poc" },
      },
    ]);

    const response = await GET(
      new NextRequest("http://test/api/tasks/implement/plan?taskId=task-1&date=2026-08-25"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getTasks).toHaveBeenCalledWith("2026-08-25");
    expect(body).toMatchObject({
      id: "task-1",
      date: "2026-08-25",
      tags: ["mobile", "ptf"],
      jira: { key: "PTF-4781", summary: "Article screen footer", status: "In Progress" },
      notePath: "task-notes/2026-08-25-task-1",
      repos: ["businessinsider/app-poc"],
      repoPath: "/repos/app-poc",
    });
  });

  it("uses and returns today's date when the query omits it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00.000Z"));
    mocks.getTasks.mockReturnValue([
      { id: "task-1", text: "Implement footer", done: false, createdAt: "2026-08-25T10:00:00.000Z" },
    ]);

    const response = await GET(new NextRequest("http://test/api/tasks/implement/plan?taskId=task-1"));
    const body = await response.json();

    expect(mocks.getTasks).toHaveBeenCalledWith("2026-08-25");
    expect(body.date).toBe("2026-08-25");
    expect(body.notePath).toBe("task-notes/2026-08-25-task-1");
  });
});
