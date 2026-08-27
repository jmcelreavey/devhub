/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepoWorkHub } from "./RepoWorkHub";
import type { RepoInfo } from "@/app/repos/types";
import type { WorkHubModel } from "@/lib/repos/work-hub";

const live = vi.hoisted(() => ({
  model: {
    clusters: [],
    leftoverTasks: [],
    leftoverNotes: [],
    leftoverPrs: [],
    leftoverEvents: [],
    openTickets: [],
  } as WorkHubModel,
  degraded: undefined as { source: string; message: string }[] | undefined,
}));

vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: (key: string) => {
    if (typeof key === "string" && key.includes("/work")) {
      return {
        data: {
          date: "2026-08-27",
          fullName: null,
          model: live.model,
          degraded: live.degraded,
        },
        error: undefined,
        isLoading: false,
        mutate: vi.fn(),
      };
    }
    return { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() };
  },
}));

vi.mock("@/lib/hooks/use-github-pr-search", () => ({
  useGithubPrSearch: () => ({ results: [], loading: false, error: null, retry: vi.fn() }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/hooks/use-stored-state", async () => {
  const react = await import("react");
  return {
    useStoredState: (_key: string, initial: boolean) => react.useState(initial),
  };
});

vi.mock("@/components/repo-git/HubWorkingTree", () => ({
  HubWorkingTree: () => <div data-testid="hub-local-files">Local files</div>,
}));

vi.mock("@/components/repo-git/HistoryPanel", () => ({
  HistoryPanel: () => null,
}));

vi.mock("@/components/repo-git/RepoGitWorkspace", () => ({
  RepoGitWorkspace: () => <div>Open Git</div>,
}));

vi.mock("@/components/repo-hub/HubWorkCluster", () => ({
  HubWorkCluster: () => null,
}));

vi.mock("@/components/PrRow", () => ({
  PrRow: () => null,
}));

vi.mock("@/components/repo-hub/HubWorkRows", async () => {
  const actual = await vi.importActual<typeof import("./HubWorkRows")>("./HubWorkRows");
  return {
    ...actual,
    HubTaskRow: ({
      task,
      cwd,
      suppressLinks,
    }: {
      task: { id: string; text: string };
      cwd?: string;
      suppressLinks?: readonly { id: string }[];
    }) => (
      <div
        data-testid={`leftover-task-${task.id}`}
        data-cwd={cwd}
        data-suppressed={(suppressLinks ?? []).map((ref) => ref.id).join(",")}
      >
        {task.text}
      </div>
    ),
    HubRepoNoteButton: ({ repoName }: { repoName: string }) => (
      <button type="button">Create note for {repoName}</button>
    ),
  };
});

vi.mock("@/components/jira/JiraTicketRow", () => ({
  JiraTicketQueueRow: ({ ticket }: { ticket: { key: string } }) => (
    <div data-testid={`other-ticket-${ticket.key}`}>{ticket.key}</div>
  ),
}));

vi.mock("@/components/briefing/CalendarEventRow", () => ({
  CalendarEventRow: ({ event }: { event: { title: string } }) => <div>{event.title}</div>,
}));

vi.mock("@/components/notes/NoteListRow", () => ({
  NoteListRow: ({ children }: { children: import("react").ReactNode }) => <div>{children}</div>,
}));

const repo: RepoInfo = {
  name: "app-poc",
  path: "/repos/app-poc",
  branch: "main",
  dirtyCount: 13,
  remote: null,
};

afterEach(() => {
  live.model = {
    clusters: [],
    leftoverTasks: [],
    leftoverNotes: [],
    leftoverPrs: [],
    leftoverEvents: [],
    openTickets: [],
  };
  live.degraded = undefined;
  cleanup();
});

describe("RepoWorkHub", () => {
  /**
   * A dead Jira token used to render as "No in-progress work linked to this
   * repo." — indistinguishable from genuinely having no work.
   */
  it("says which integration is down instead of showing an empty state", () => {
    live.degraded = [{ source: "Jira", message: "401 Unauthorized" }];
    render(<RepoWorkHub repo={repo} onMutate={vi.fn()} />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Jira");
    expect(notice.textContent).toContain("unavailable");
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("shows no degraded notice when every integration answered", () => {
    render(<RepoWorkHub repo={repo} onMutate={vi.fn()} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders Commits above Local files", () => {
    render(<RepoWorkHub repo={repo} onMutate={vi.fn()} />);
    const commits = screen.getByRole("button", { name: /commits/i });
    const local = screen.getByTestId("hub-local-files");
    expect(commits.compareDocumentPosition(local) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders leftover tasks and a repo Create note control", () => {
    live.model.leftoverTasks = [
      { id: "t-left", text: "Associated leftover", date: "2026-08-27" },
    ];
    render(<RepoWorkHub repo={repo} onMutate={vi.fn()} />);
    expect(screen.getByTestId("leftover-task-t-left").textContent).toBe("Associated leftover");
    expect(screen.getByTestId("leftover-task-t-left").getAttribute("data-cwd")).toBe("/repos/app-poc");
    expect(screen.getByRole("button", { name: /Create note for app-poc/ })).toBeTruthy();
  });

  it("renders open tickets in the backlog section", () => {
    live.model.openTickets = [
      { key: "PTF-9", summary: "Backlog", status: "Open", url: "https://jira/PTF-9" },
    ];
    render(<RepoWorkHub repo={repo} onMutate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Backlog/ })).toBeTruthy();
    expect(screen.getByTestId("other-ticket-PTF-9").textContent).toBe("PTF-9");
  });

  it("hoists a link every backlog row shares into the section header", () => {
    const plan = { kind: "note" as const, id: "projects/plan", label: "WebView plan" };
    live.model.leftoverTasks = [
      { id: "t-a", text: "Queued A", date: "2026-08-27", links: [plan] },
      { id: "t-b", text: "Queued B", date: "2026-08-27", links: [plan] },
    ];
    render(<RepoWorkHub repo={repo} onMutate={vi.fn()} />);
    expect(screen.getByLabelText("Shared by every backlog item").textContent).toContain(
      "WebView plan",
    );
    for (const id of ["t-a", "t-b"]) {
      expect(screen.getByTestId(`leftover-task-${id}`).getAttribute("data-suppressed")).toBe(
        "projects/plan",
      );
    }
  });

  it("leaves a link only one backlog row carries on that row", () => {
    live.model.leftoverTasks = [
      { id: "t-a", text: "Queued A", date: "2026-08-27", links: [{ kind: "note", id: "solo", label: "Solo" }] },
      { id: "t-b", text: "Queued B", date: "2026-08-27", links: [] },
    ];
    render(<RepoWorkHub repo={repo} onMutate={vi.fn()} />);
    expect(screen.queryByLabelText("Shared by every backlog item")).toBeNull();
    expect(screen.getByTestId("leftover-task-t-a").getAttribute("data-suppressed")).toBe("");
  });

  it("collapses a long backlog behind a counted toggle", () => {
    live.model.leftoverTasks = Array.from({ length: 7 }, (_, i) => ({
      id: `t-${i}`,
      text: `Queued ${i}`,
      date: "2026-08-27",
    }));
    render(<RepoWorkHub repo={repo} onMutate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Backlog/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.queryByTestId("leftover-task-t-0")).toBeNull();
  });
});
