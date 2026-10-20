// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInboxItem } from "@/lib/workflows/inbox";
import type { TaskWorkflow } from "@/lib/workflows/types";
import { Bot } from "lucide-react";

const mocks = vi.hoisted(() => ({ live: vi.fn(), mutate: vi.fn(), push: vi.fn(), success: vi.fn(), error: vi.fn(), taskAction: vi.fn() }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: mocks.live }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: mocks.success, error: mocks.error, info: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock("@/lib/desktop/bridge", () => ({ requestNotifyPermission: vi.fn(async () => "granted") }));
vi.mock("@/lib/create-vault-note", () => ({ vaultNoteHref: (path: string) => `/notes/${path}` }));
// The shared task menu: the inbox must pass its items through.
vi.mock("@/components/tasks/useTaskAgentActions", () => ({
  useTaskAgentActions: () => ({ chip: null, upstart: null, dialogs: null, menuItems: [
    { id: "implement-agent", label: "Implement with agent", icon: <Bot size={12} />, onSelect: mocks.taskAction },
    { id: "workflow", label: "Workflow and evidence", onSelect: vi.fn() },
    { id: "storyboard", label: "Open on Storyboard", onSelect: vi.fn() },
  ] }),
}));

import { INBOX_PAGE, InboxToggle, WorkflowInboxPanel } from "./WorkflowInboxPanel";

const wf = (over: Partial<TaskWorkflow> = {}): TaskWorkflow => ({ version: 1, taskId: "t", revision: 3, stage: "review", status: "waiting-user", checks: [], reviews: [], proposals: [], events: [{ id: "e", at: "2026-10-17T10:00:00Z", summary: "Review accepted" }], seenRevision: 0, ...over });
const item = (id: string, over: Partial<TaskWorkflow> = {}): WorkflowInboxItem => ({ task: { id, text: `Task ${id}`, done: false, createdAt: "", rank: "1", startDate: "2026-10-17", date: "2026-10-17" } as WorkflowInboxItem["task"], workflow: wf({ taskId: id, ...over }) });
const posts = () => (vi.mocked(fetch).mock.calls as [string, RequestInit][]).map(([, init]) => JSON.parse(String(init.body)));

function show(items: WorkflowInboxItem[]) {
  mocks.live.mockReturnValue({ data: { items }, mutate: mocks.mutate, error: undefined });
}
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => Response.json({ workflow: {} }))); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("WorkflowInboxPanel", () => {
  it("opens an item's card on the board in one click and marks it read", async () => {
    show([item("a", { seenRevision: 4 }), item("b")]);
    const onOpenCard = vi.fn();
    render(<WorkflowInboxPanel onClose={vi.fn()} onOpenCard={onOpenCard} />);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("Task b")).toBeTruthy(); // unread first
    expect(within(rows[0]).getByText("Review accepted")).toBeTruthy();
    fireEvent.click(within(rows[0]).getByRole("button", { name: /Task b/ }));
    expect(onOpenCard).toHaveBeenCalledWith("b");
    await waitFor(() => expect(posts()).toEqual([{ taskId: "b", revision: 3, action: "seen" }]));
  });

  it("marks every unread item read", async () => {
    show([item("a"), item("b"), item("c", { seenRevision: 4 })]);
    render(<WorkflowInboxPanel onClose={vi.fn()} onOpenCard={vi.fn()} />);
    expect(screen.getByText("2 unread")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Marked 2 read"));
    expect(posts().map((body) => [body.taskId, body.action])).toEqual([["a", "seen"], ["b", "seen"]]);
  });

  it("right-click offers open card, open note, read state and the shared task actions", async () => {
    show([item("a", { seenRevision: 4 })]);
    const onOpenCard = vi.fn();
    render(<WorkflowInboxPanel onClose={vi.fn()} onOpenCard={onOpenCard} />);
    fireEvent.click(screen.getByRole("button", { name: "Show read updates" }));
    fireEvent.contextMenu(screen.getByRole("listitem"), { clientX: 40, clientY: 40 });
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const entries = [...menu.querySelectorAll<HTMLButtonElement>(".context-menu-item")];
    const labels = entries.map((entry) => entry.textContent);
    expect([...menu.querySelectorAll(".context-menu-group-label")].map((entry) => entry.textContent)).toEqual(["Open", "Read state", "Agent"]);
    for (const entry of entries) expect(entry.querySelector(".context-menu-icon svg")).not.toBeNull();
    expect(labels.some((label) => label?.startsWith("Open card"))).toBe(true);
    expect(labels.some((label) => label?.startsWith("Open note"))).toBe(true);
    expect(labels.some((label) => label?.startsWith("Implement with agent"))).toBe(true);
    // The shared menu's own workflow link is folded into "Open workflow".
    expect(labels.some((label) => label?.startsWith("Workflow and evidence"))).toBe(false);
    expect(labels.some((label) => label?.startsWith("Open on Storyboard"))).toBe(false);
    fireEvent.click(entries.find((entry) => entry.textContent?.startsWith("Mark unread"))!);
    await waitFor(() => expect(posts()).toEqual([{ taskId: "a", revision: 3, action: "unseen" }]));
  });

  it("shows a page at a time instead of an unbounded list, and closes on Escape", () => {
    show(Array.from({ length: INBOX_PAGE + 5 }, (_, i) => item(String(i))));
    const onClose = vi.fn();
    render(<WorkflowInboxPanel onClose={onClose} onOpenCard={vi.fn()} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(INBOX_PAGE);
    fireEvent.click(screen.getByRole("button", { name: "Show 5 more" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(INBOX_PAGE + 5);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("says what lands here when it's empty", () => {
    show([]);
    render(<WorkflowInboxPanel onClose={vi.fn()} onOpenCard={vi.fn()} />);
    expect(screen.getByText("No unread updates")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Mark all read" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the header toggle shows the unread count and its state", () => {
    show([item("a"), item("b", { seenRevision: 4 })]);
    render(<InboxToggle open={false} onToggle={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: /Updates/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(within(toggle).getByLabelText("1 unread updates")).toBeTruthy();
  });
});
