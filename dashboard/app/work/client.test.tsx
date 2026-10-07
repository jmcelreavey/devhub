// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/tasks/types";
import WorkPage from "./client";

const state = vi.hoisted(() => ({
  tasks: undefined as { tasks: Task[] } | undefined,
  taskError: undefined as Error | undefined,
  setup: { jira: true } as { jira: boolean } | undefined,
  refreshTasks: vi.fn(),
  refreshSetup: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("next/dynamic", () => ({ default: () => () => <p>Linked work view</p> }));
vi.mock("@/components/tasks/TaskList", () => ({
  TaskList: ({ searchQuery }: { searchQuery: string }) => <div data-testid="task-list" data-query={searchQuery}>Task actions</div>,
}));
vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: (key: string) => key === "/api/tasks"
    ? { data: state.tasks, error: state.taskError, mutate: state.refreshTasks }
    : { data: state.setup, error: undefined, mutate: state.refreshSetup },
}));

beforeEach(() => {
  window.history.replaceState(null, "", "/work");
  state.tasks = { tasks: [{ id: "one", text: "Fix #auth login", done: false } as Task] };
  state.taskError = undefined;
  state.setup = { jira: true };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Work views", () => {
  it("stores tab selection in the URL while preserving other query parameters", () => {
    window.history.replaceState(null, "", "/work?tag=auth&view=compact");
    const view = render(<WorkPage />);
    expect(screen.getByLabelText("Search tasks")).toHaveValue("");
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("history");
    expect(params.get("tag")).toBe("auth");
    expect(params.get("view")).toBe("compact");
    view.rerender(<WorkPage />);
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "work-tab-history");
  });

  it("follows Back and Forward URL changes, including return to the default tasks URL", () => {
    const view = render(<WorkPage />);
    const visit = (url: string) => {
      window.history.replaceState(null, "", url);
      view.rerender(<WorkPage />);
    };
    visit("/work?tab=history&tag=auth");
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
    visit("/work?tag=auth");
    expect(screen.getByRole("tab", { name: /Tasks/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Search tasks")).toHaveValue("");
    visit("/work?tab=history&tag=auth");
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
    visit("/work?tab=tickets");
    expect(screen.getByRole("tab", { name: "Jira" })).toHaveAttribute("aria-selected", "true");
  });

  it("supports roving tab focus with arrows and Home/End, linked to named panels", () => {
    const view = render(<WorkPage />);
    const tasksTab = screen.getByRole("tab", { name: /Tasks/ });
    tasksTab.focus();
    fireEvent.keyDown(tasksTab, { key: "ArrowRight" });
    view.rerender(<WorkPage />);
    const jiraTab = screen.getByRole("tab", { name: "Jira" });
    expect(jiraTab).toHaveFocus();
    expect(jiraTab).toHaveAttribute("tabindex", "0");
    expect(tasksTab).toHaveAttribute("tabindex", "-1");
    expect(document.getElementById(jiraTab.getAttribute("aria-controls")!)).toHaveAttribute("aria-labelledby", jiraTab.id);
    fireEvent.keyDown(jiraTab, { key: "End" });
    view.rerender(<WorkPage />);
    expect(screen.getByRole("tab", { name: "History" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "History" }), { key: "Home" });
    view.rerender(<WorkPage />);
    expect(screen.getByRole("tab", { name: /Tasks/ })).toHaveFocus();
  });

  it("keeps search available during loading and failure without presenting an empty task list", () => {
    state.tasks = undefined;
    const view = render(<WorkPage />);
    expect(screen.getByLabelText("Search tasks")).toBeInTheDocument();
    expect(screen.getByText("Loading tasks…")).toBeInTheDocument();
    expect(screen.queryByTestId("task-list")).not.toBeInTheDocument();
    state.taskError = new Error("Offline");
    view.rerender(<WorkPage />);
    expect(screen.getByText("Couldn't load tasks.")).toBeInTheDocument();
    expect(screen.queryByText("0 open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-list")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(state.refreshTasks).toHaveBeenCalledOnce();
  });

  it("explains unmatched search and clears the filter while retaining task actions", () => {
    render(<WorkPage />);
    fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "unmatched" } });
    expect(screen.getByText(/No tasks match/)).toBeInTheDocument();
    expect(screen.getByTestId("task-list")).toHaveAttribute("data-query", "unmatched");
    fireEvent.click(screen.getByRole("button", { name: "Clear search tasks" }));
    expect(screen.getByLabelText("Search tasks")).toHaveValue("");
    expect(screen.queryByText(/No tasks match/)).not.toBeInTheDocument();
    expect(screen.getByTestId("task-list")).toHaveAttribute("data-query", "");
  });
});
