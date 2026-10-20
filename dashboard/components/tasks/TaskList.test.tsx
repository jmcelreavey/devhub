/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Task } from "@/lib/tasks/types";
import { TaskList } from "./TaskList";

const state = vi.hoisted(() => ({ data: { tasks: [] as Task[] }, fetch: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => ({
  data: state.data, error: undefined, isLoading: false,
  mutate: async (update?: (current: typeof state.data) => typeof state.data) => {
    if (update) state.data = update(state.data);
    return state.data;
  },
}) }));
vi.mock("@/components/tasks/TaskItem", () => ({ TaskItem: ({ task, onToggle }: { task: Task; onToggle: () => void }) => <button onClick={onToggle}>{task.done ? "Reopen" : "Complete"}</button> }));
vi.mock("@/components/tasks/TaskComposer", () => ({ TaskComposer: () => null }));
vi.mock("@/components/tasks/ProfileOverlayTasks", () => ({ ProfileOverlayTasks: () => null }));
vi.mock("@/components/tasks/AddToJiraModal", () => ({ AddToJiraModal: () => null }));
vi.mock("@/components/jira/JiraTransitionModal", () => ({ JiraTransitionModal: () => null }));
vi.mock("@/components/ui/SortableList", () => ({ SortableList: ({ items, renderItem }: { items: Task[]; renderItem: (task: Task) => ReactNode }) => <>{items.map((task) => <div key={task.id}>{renderItem(task)}</div>)}</> }));
vi.mock("@/lib/hooks/use-stored-state", () => ({ useStoredChoice: () => ["flat", vi.fn()] }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ error: state.error, success: vi.fn() }) }));
vi.mock("@/lib/graphite-theme", () => ({ celebrateGraphite: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.restoreAllMocks(); });

it("deduplicates rapid checkbox completion during the exit animation and explicitly reopens the task", async () => {
  vi.useFakeTimers();
  state.data = { tasks: [{ id: "checkbox", text: "A small task", done: false, createdAt: "2026-10-17", startDate: "2026-10-17", rank: "a" }] };
  state.fetch.mockImplementation(async (_url: string, init: RequestInit) => Response.json({ ...state.data.tasks[0], done: JSON.parse(String(init.body)).completion }));
  vi.stubGlobal("fetch", state.fetch);
  render(<TaskList />);
  const button = screen.getByRole("button", { name: "Complete" });
  await act(async () => {
    fireEvent.click(button);
    fireEvent.click(button);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(440);
  });
  expect(state.fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({ id: "checkbox", completion: true });
  expect(state.data.tasks[0].done).toBe(true);
  const reopen = screen.getByRole("button", { name: "Reopen" });
  await act(async () => { fireEvent.click(reopen); fireEvent.click(reopen); });
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(state.fetch.mock.calls[1][1].body)).toEqual({ id: "checkbox", completion: false });
  expect(state.data.tasks[0].done).toBe(false);
});

it("explains why live work cannot be completed and restores the open task", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  state.data = { tasks: [{ id: "live-checkbox", text: "A live task", done: false, createdAt: "2026-10-17", startDate: "2026-10-17", rank: "a" }] };
  const error = "Work is still running. Wait for it to finish or stop it before finishing this task.";
  state.fetch.mockResolvedValue(Response.json({ error }, { status: 409 }));
  vi.stubGlobal("fetch", state.fetch);
  render(<TaskList />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(440);
  });
  expect(state.data.tasks[0].done).toBe(false);
  expect(state.error).toHaveBeenCalledWith(error);
});
