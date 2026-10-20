// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/tasks/types";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import TaskHistoryPage from "./client";

interface TaskDay { date: string; total: number; completed: number; abandoned: number; moved: number; modified: number; tasks: Task[] }
const state = vi.hoisted(() => ({ days: [] as TaskDay[], tags: {} as Record<string, string[]>, mutate: vi.fn() }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: (key: string | null) => ({ data: key === "/api/tasks/note-tags" ? { tags: state.tags } : key?.startsWith("/api/tasks/history") ? state.days : undefined, error: undefined, isLoading: false, mutate: state.mutate }) }));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/components/tasks/TaskList", () => ({ TaskItem: ({ task, onToggle, readOnly }: { task: Task; onToggle: () => void; readOnly?: boolean }) => <button data-readonly={!!readOnly} disabled={readOnly} onClick={onToggle}>{task.text}</button> }));
vi.mock("@/components/today/TodayBootScreen", () => ({ BootScreen: () => null, useBootGate: () => "done" }));
vi.mock("@/components", () => ({
  FetchError: () => null,
  SkeletonRows: () => null,
  InlineSearch: ({ label }: { label: string }) => <input aria-label={label} />,
}));

beforeEach(() => { state.days = []; state.tags = {}; });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const task = (id: string, patch: Partial<Task> = {}): Task => ({ id, text: `Task ${id}`, startDate: "2026-10-17", rank: "a0", done: false, createdAt: "2026-10-17T10:00:00Z", ...patch });
const day = (date: string, tasks: Task[]): TaskDay => ({ date, tasks, total: tasks.length, completed: tasks.filter((item) => item.done).length, abandoned: tasks.filter((item) => item.abandonedAt).length, moved: tasks.filter((item) => item.movedAt).length, modified: 0 });

describe("Tasks → History", () => {
  it("is headed History, so it doesn't repeat the page it sits in", () => {
    render(<TaskHistoryPage />);
    expect(screen.getByRole("heading", { level: 1, name: "History" })).toBeInTheDocument();
  });

  it("links on to the weekly review", () => {
    render(<TaskHistoryPage />);
    expect(screen.getByRole("link", { name: /Weekly review/ })).toHaveAttribute("href", "/review");
  });

  it("reuses History's status filters, moved rows and pagination inside Storyboard", () => {
    state.days = [day("2026-10-17", Array.from({ length: 52 }, (_, index) => task(String(index))))];
    const view = render(<TaskHistoryPage embedded query="" />);
    expect(screen.getByRole("heading", { level: 2, name: "History" })).toBeInTheDocument();
    expect(screen.getByText("Showing 1-50 of 52")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    view.rerender(<TaskHistoryPage embedded query="Task 51" />);
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    state.days = [day("2026-10-17", [task("moved", { movedAt: "2026-10-18", movedToDate: "2026-10-18" })])];
    view.rerender(<TaskHistoryPage embedded query="" />);
    fireEvent.click(screen.getByRole("button", { name: /^Moved/ }));
    expect(screen.getByRole("button", { name: "Task moved" })).toBeDisabled();
    expect(screen.getByText(/Continued on/)).toBeInTheDocument();
  });

  it("applies q, tag, date, repo and Jira/parent from the surrounding URL filters", () => {
    state.days = [day("2026-10-17", [task("wanted", { text: "Fix login", jiraKey: "TEST-1" }), task("other")]), day("2026-10-18", [task("later", { text: "Fix login" })])];
    const cards = [{ taskId: "wanted", repo: "api", jira: ["TEST-1"], parentJira: "TEST-2", tags: ["bug"] }] as BoardCard[];
    render(<TaskHistoryPage embedded query="login" date="2026-10-17" filters={{ repo: "api", tag: "bug", jira: "TEST-1", parentJira: "TEST-2" }} cards={cards} />);
    expect(screen.getByRole("button", { name: "Fix login" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Task other" })).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1-1 of 1")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("uses explicit completion with the historical task's date", async () => {
    const record = task("old");
    state.days = [day("2026-10-17", [record])];
    const fetch = vi.fn(async () => Response.json({ ...record, done: true }));
    vi.stubGlobal("fetch", fetch);
    render(<TaskHistoryPage embedded query="" />);
    fireEvent.click(screen.getByRole("button", { name: "Task old" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/tasks", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ id: "old", date: "2026-10-17", completion: true }) })));
  });
});
