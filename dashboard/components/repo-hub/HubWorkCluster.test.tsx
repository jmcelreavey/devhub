/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/tasks/types";
import type { WorkCluster } from "@/lib/repos/work-hub";
import { HubWorkCluster } from "./HubWorkCluster";

const mocks = vi.hoisted(() => ({
  useJiraTicketMenu: vi.fn((ticket: { key: string }) => ({
    menu: {
      bindRow: () => ({ "data-testid": `jira-row-${ticket.key}` }),
      openAtPoint: vi.fn(),
    },
    menuUi: <div data-testid={`jira-menu-ui-${ticket.key}`} />,
  })),
  toastError: vi.fn(),
}));

vi.mock("@/components/jira/JiraTicketRow", () => ({
  useJiraTicketMenu: mocks.useJiraTicketMenu,
}));

vi.mock("@/components/tasks/TaskItem", () => ({
  TaskItem: ({
    task,
    onToggle,
    onDelete,
    cwd,
    repoName,
  }: {
    task: Task;
    onToggle: () => void;
    onDelete: () => void;
    cwd?: string;
    repoName?: string;
  }) => (
    <div data-testid={`hub-task-${task.id}`} data-cwd={cwd} data-repo={repoName}>
      <span>{task.text}</span>
      <button type="button" onClick={onToggle}>
        Mark done
      </button>
      <button type="button" onClick={onDelete}>
        Delete
      </button>
    </div>
  ),
}));

vi.mock("@/components/notes/NoteListRow", () => ({
  NoteListRow: ({ children }: { children: import("react").ReactNode }) => <div data-testid="hub-note">{children}</div>,
}));

vi.mock("@/components/tasks/SkillAgentDialog", () => ({
  SkillAgentDialog: ({
    open,
    getPrompt,
    cwd,
    title,
  }: {
    open: boolean;
    getPrompt: () => string;
    cwd?: string;
    title: string;
  }) =>
    open ? (
      <div data-testid="skill-dialog">
        <span>{title}</span>
        <span>{getPrompt()}</span>
        <span>{cwd}</span>
      </div>
    ) : null,
}));

vi.mock("@/components/tasks/ImplementTaskDialog", () => ({
  ImplementTaskDialog: ({
    open,
    cwd,
    repoName,
  }: {
    open: boolean;
    cwd?: string;
    repoName?: string;
  }) => (open ? <div data-testid="implement-dialog">{cwd} {repoName}</div> : null),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: mocks.toastError }),
}));

vi.mock("swr", () => ({ mutate: vi.fn() }));

const cluster: WorkCluster = {
  id: "jira:PTF-4783",
  inProgress: false,
  jira: {
    key: "PTF-4783",
    summary: "Atlas comments count",
    status: "Open",
    url: "https://jira/PTF-4783",
  },
  tasks: [
    {
      id: "task-1",
      text: "PTF-4783 PR 3: Atlas comments count #mobile-app",
      date: "2026-08-27",
      jiraKey: "PTF-4783",
      links: [{ kind: "repo", id: "app-poc", label: "app-poc" }],
    },
  ],
  notes: [{ slug: "tickets/PTF-4783", title: "Ticket note", href: "/notes/tickets/PTF-4783" }],
  prs: [],
  calendar: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HubWorkCluster", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "", json: async () => ({}) }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wires TaskItem done/delete hooks and the shared Jira menu, and renders linked notes", () => {
    render(
      <HubWorkCluster
        cluster={cluster}
        date="2026-08-27"
        repoName="app-poc"
        repoPath="/repos/app-poc"
        onWorkMutate={vi.fn()}
      />,
    );

    expect(mocks.useJiraTicketMenu).toHaveBeenCalledWith(
      expect.objectContaining({ key: "PTF-4783", summary: "Atlas comments count" }),
    );
    expect(screen.getByTestId("jira-row-PTF-4783")).toBeTruthy();
    expect(screen.getByTestId("jira-menu-ui-PTF-4783")).toBeTruthy();
    expect(screen.getByTestId("hub-task-task-1").textContent).toContain("Atlas comments count");
    expect(screen.getByTestId("hub-task-task-1").getAttribute("data-cwd")).toBe("/repos/app-poc");
    expect(screen.getByTestId("hub-task-task-1").getAttribute("data-repo")).toBe("app-poc");
    expect(screen.getByRole("button", { name: "Mark done" })).toBeTruthy();
    expect(screen.getByTestId("hub-note").textContent).toContain("Ticket note");
  });

  it("marks the nested task done through the TaskItem hook", async () => {
    const onWorkMutate = vi.fn();
    render(
      <HubWorkCluster
        cluster={cluster}
        date="2026-08-27"
        repoName="app-poc"
        repoPath="/repos/app-poc"
        onWorkMutate={onWorkMutate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/tasks",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ id: "task-1", done: true }),
        }),
      );
    });
    expect(onWorkMutate).toHaveBeenCalled();
  });

  it("opens Create PR with the create-pr skill prompt in the repo cwd", () => {
    render(
      <HubWorkCluster
        cluster={cluster}
        date="2026-08-27"
        repoName="app-poc"
        repoPath="/repos/app-poc"
        onWorkMutate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Create PR/ }));

    const dialog = screen.getByTestId("skill-dialog");
    expect(dialog.textContent).toContain("Create PR with agent");
    expect(dialog.textContent).toContain("create-pr skill");
    expect(dialog.textContent).toContain("PTF-4783");
    expect(dialog.textContent).toContain("/repos/app-poc");
    expect(dialog.textContent).toContain("ask any questions");
  });

  it("launches Implement with this repo as cwd", () => {
    render(
      <HubWorkCluster
        cluster={cluster}
        date="2026-08-27"
        repoName="app-poc"
        repoPath="/repos/app-poc"
        onWorkMutate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Implement/ }));
    expect(screen.getByTestId("implement-dialog").textContent).toContain("/repos/app-poc");
    expect(screen.getByTestId("implement-dialog").textContent).toContain("app-poc");
  });
});
