/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { JiraTicket } from "@/lib/jira/client";
import type { Task } from "@/lib/tasks/types";
import { JiraTicketQueueRow, JiraTicketRow } from "./JiraTicketRow";
import { JiraWidget } from "./JiraWidget";
import { GridSizeContext } from "@/lib/hooks/use-grid-size";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  push: vi.fn(),
  mutate: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: mocks.copy }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("swr", () => ({ mutate: mocks.mutate }));
vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: () => ({ data: { configured: true, tickets: [ticket] }, isLoading: false }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: mocks.success, error: mocks.error }),
}));
vi.mock("@/lib/hooks/use-tag-menu", () => ({
  useTagMenuGroup: () => ({ group: null, modal: null }),
  withTagsGroup: (groups: unknown) => groups,
}));
vi.mock("@/components/EntityNoteAction", () => ({ useVaultNoteExists: () => false }));
vi.mock("@/components/jira/JiraTransitionModal", () => ({ JiraTransitionModal: () => null }));
vi.mock("@/components/jira/JiraStatusPill", () => ({ JiraStatusPill: () => null }));
vi.mock("@/components/tasks/PlanTaskDialog", () => ({
  PlanTaskDialog: ({ task, date, onClose }: { task: Task; date: string; onClose: () => void }) => (
    <div role="dialog" aria-label="Plan task" data-task-id={task.id} data-date={date}>
      <button onClick={onClose}>Cancel</button>
    </div>
  ),
}));
vi.mock("@/components/tasks/ImplementTaskDialog", () => ({
  ImplementTaskDialog: ({ task, date }: { task: Task; date: string }) => (
    <div role="dialog" aria-label="Implement task" data-task-id={task.id} data-date={date} />
  ),
}));

const ticket: JiraTicket = {
  key: "TEST-123", summary: "Add ticket actions", status: "Open", priority: "Medium",
  issuetype: "Task", project: "Test", projectKey: "TEST",
  url: "https://example.atlassian.net/browse/TEST-123", updatedAt: "",
};
const task: Task = {
  id: "created-task", text: "TEST-123 Add ticket actions", jiraKey: "TEST-123",
  done: false, createdAt: "2026-10-01T12:00:00Z", startDate: "2026-10-01", rank: "1",
};

beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => task });
  mocks.copy.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it.each([
  { w: 4, h: 6, action: "Create task", dialog: null },
  { w: 4, h: 6, action: "Write plan with Agent…", dialog: "Plan task" },
  { w: 4, h: 6, action: "Implement with Agent…", dialog: "Implement task" },
  { w: 6, h: 8, action: "Create task", dialog: null },
  { w: 6, h: 8, action: "Write plan with Agent…", dialog: "Plan task" },
  { w: 6, h: 8, action: "Implement with Agent…", dialog: "Implement task" },
])("runs $action from the $w×$h dashboard widget", async ({ w, h, action, dialog }) => {
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => action.startsWith("Write") ? { task, date: "2026-10-01" } : task,
  });
  render(<GridSizeContext.Provider value={{ jira: { w, h } }}><JiraWidget /></GridSizeContext.Provider>);
  expect(screen.getByRole("list", { name: /Your Jira tickets/ })).toBeTruthy();
  openMenu();
  fireEvent.click(menuItem(new RegExp(action.replace("…", ""))));
  await waitFor(() => expect(mocks.success).toHaveBeenCalled());
  if (dialog) expect(screen.getByRole("dialog", { name: dialog }).getAttribute("data-task-id")).toBe(task.id);
  else expect(screen.queryByRole("dialog")).toBeNull();
});

it.each([JiraTicketQueueRow, JiraTicketRow])("shows and copies the parent from either ticket row", async (Row) => {
  render(<Row ticket={{ ...ticket, parent: { key: "TEST-1", summary: "Subscription reliability" } }} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy parent ticket key TEST-1" }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith("TEST-1"));
  expect(mocks.copy).not.toHaveBeenCalledWith(ticket.key);
  openMenu();
  fireEvent.click(menuItem("Copy parent key (TEST-1)"));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledTimes(2));
});

it("omits parent controls when Jira has no parent", () => {
  render(<JiraTicketRow ticket={ticket} />);
  expect(screen.queryByRole("button", { name: /Copy parent ticket/ })).toBeNull();
  openMenu();
  expect(screen.queryByRole("menuitem", { name: /Copy parent key/, hidden: true })).toBeNull();
});

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Actions for TEST-123" }));
  expect(screen.getAllByRole("menu", { hidden: true }).some((menu) => !menu.hasAttribute("hidden"))).toBe(true);
}

function menuItem(name: string | RegExp) {
  // jsdom has no native popover display; browser checks cover visibility.
  return screen.getByRole("menuitem", { name, hidden: true }) as HTMLButtonElement;
}

it.each([JiraTicketQueueRow, JiraTicketRow])("creates a Jira-linked task from either ticket row", async (Row) => {
  render(<Row ticket={ticket} />);
  openMenu();
  fireEvent.click(menuItem("Create task"));
  await waitFor(() => expect(mocks.success).toHaveBeenCalled());
  const [url, request] = mocks.fetch.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/tasks");
  expect(JSON.parse(String(request.body))).toEqual({
    text: "TEST-123 Add ticket actions",
    date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    links: [{ kind: "jira", id: ticket.key, label: ticket.key, href: ticket.url }],
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.mutate).toHaveBeenCalledWith(expect.any(Function));
  const refresh = mocks.mutate.mock.calls[0]![0] as (key: unknown) => boolean;
  expect(refresh("/api/tasks/plan-status")).toBe(true);
  expect(refresh("/api/jira/tickets")).toBe(false);
});

it("captures a draft before opening the standard planning dialog and keeps it on cancel", async () => {
  mocks.fetch.mockResolvedValue({
    ok: true, json: async () => ({ task: { ...task, stage: "draft" }, date: "2026-10-01" }),
  });
  render(<JiraTicketQueueRow ticket={ticket} />);
  openMenu();
  fireEvent.click(menuItem(/Write plan with Agent/));
  const dialog = await screen.findByRole("dialog", { name: "Plan task" });
  expect(mocks.fetch.mock.calls[0]![0]).toBe("/api/tasks/capture");
  expect(dialog.getAttribute("data-task-id")).toBe(task.id);
  expect(dialog.getAttribute("data-date")).toBe("2026-10-01");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("passes the saved task and its creation date to the standard implementation dialog", async () => {
  render(<JiraTicketQueueRow ticket={ticket} />);
  openMenu();
  fireEvent.click(menuItem(/Implement with Agent/));
  const dialog = await screen.findByRole("dialog", { name: "Implement task" });
  const request = mocks.fetch.mock.calls[0]![1] as RequestInit;
  expect(dialog.getAttribute("data-task-id")).toBe(task.id);
  expect(dialog.getAttribute("data-date")).toBe(JSON.parse(String(request.body)).date);
});

it.each(["response", "network"])("does not open an agent dialog when creation fails (%s)", async (failure) => {
  if (failure === "network") mocks.fetch.mockRejectedValue(new Error("Offline"));
  else mocks.fetch.mockResolvedValue({ ok: false });
  render(<JiraTicketQueueRow ticket={ticket} />);
  openMenu();
  fireEvent.click(menuItem(/Implement with Agent/));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Couldn't create a task from TEST-123."));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.success).not.toHaveBeenCalled();
  openMenu();
  expect(menuItem("Create task").disabled).toBe(false);
});

it("disables all task actions until the current creation finishes", async () => {
  let resolve: (response: unknown) => void = () => {};
  mocks.fetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<JiraTicketQueueRow ticket={ticket} />);
  openMenu();
  fireEvent.click(menuItem("Create task"));
  openMenu();
  for (const name of [/Creating task/, /Write plan with Agent/, /Implement with Agent/]) {
    const item = menuItem(name);
    expect(item.disabled).toBe(true);
    fireEvent.click(item);
  }
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ ok: true, json: async () => task }));
});
