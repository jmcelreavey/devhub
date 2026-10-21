/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { HomeTaskContext } from "./HomeTaskContext";
import { HomeTasks } from "./HomeTasks";
import { WorkSummaryCard } from "@/components/storyboard/WorkSummaryCard";
import { clearTransitionOverride } from "@/lib/jira/transition-state";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { homeWorkSummary } from "@/lib/storyboard/home-summary";

const state = vi.hoisted(() => ({
  fetch: vi.fn(), copy: vi.fn(), success: vi.fn(), error: vi.fn(), push: vi.fn(), cardMenu: vi.fn(),
  cursor: vi.fn(), folder: vi.fn(), terminal: vi.fn(), gitkraken: vi.fn(), browser: vi.fn(),
  status: "In Progress", failTicket: false,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: state.success, error: state.error, info: vi.fn() }) }));
vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: state.copy }));
vi.mock("@/lib/desktop/bridge", () => ({ isDesktop: () => true, openInBrowser: state.browser }));
vi.mock("@/components/EntityNoteAction", () => ({ useVaultNoteExists: () => false }));
vi.mock("@/lib/hooks/use-tag-menu", () => ({
  useTagMenuGroup: () => ({ group: null, modal: null }), withTagsGroup: (groups: unknown) => groups,
}));
vi.mock("@/components/storyboard/TaskDetailProvider", () => ({
  useTaskDetail: () => ({ openTask: vi.fn(), profileId: "work", hrefForTask: () => "/?task=one" }),
}));
vi.mock("@/components/tasks/useTaskMenu", () => ({
  useTaskMenu: () => ({ groups: [{ id: "task", items: [{ id: "task-only", label: "Task-only action", onSelect: state.cardMenu }] }], agent: { menuItems: [] }, dialogs: null }),
}));
vi.mock("@/components/shell/ModalShell", () => ({
  ModalShell: ({ open, title, children, footer }: { open: boolean; title: string; children: ReactNode; footer: ReactNode }) =>
    open ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null,
}));
vi.mock("@/app/repos/useReposActions", () => ({
  useReposActions: () => ({
    opening: null, openInCursor: state.cursor, openInFolder: state.folder,
    openInTerminal: state.terminal, openInGitKraken: state.gitkraken,
  }),
}));

const card: BoardCard = {
  taskId: "one", title: "Fix login", repo: "app", jira: ["APP-42", "APP-43"],
  date: "2026-10-19", status: "todo", taskDone: false, notePath: null, noteHref: null,
  tags: [], links: [], models: [], summary: [], counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 },
  screenshot: null, images: [], jev: null, tiers: null, run: null, steps: [], updatedAt: "", attention: null,
};
const repo = { name: "app", path: "/repos/app", branch: "main", dirtyCount: 0, remote: "git@github.com:acme/app.git" };
const wrapper = ({ children }: { children: ReactNode }) => <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false }}>{children}</SWRConfig>;
function Tasks({ value = card }: { value?: BoardCard }) {
  return <HomeTasks cards={[value]} summary={homeWorkSummary([value], [], [], 0)} items={[]} now={0} profile="work" limit={3} known workflowReady expanded finished={false} onFinished={vi.fn()} onExpand={vi.fn()} loading={false} onRefresh={vi.fn()} />;
}
function Summary() {
  return <WorkSummaryCard home profile="work" work={{ kind: "task", card, presentation: { status: "Ready", action: null, needsYou: false } }} onRefresh={vi.fn()} />;
}
function activeMenu(label: string) {
  // jsdom does not expose accessible names on manual popovers.
  const menu = document.querySelector<HTMLElement>(`[role="menu"][aria-label="${label}"]:not([hidden])`);
  expect(menu).not.toBeNull();
  return menu!;
}
const writes = () => state.fetch.mock.calls.filter(([url]) => String(url).endsWith("/transition"));

beforeEach(() => {
  vi.clearAllMocks();
  clearTransitionOverride("APP-42");
  state.status = "In Progress"; state.failTicket = false;
  state.copy.mockResolvedValue(undefined);
  state.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
    if (input.endsWith("/transitions")) return Response.json({ transitions: [{ id: "41", name: "Finish", to: "Done" }] });
    if (input.endsWith("/transition")) {
      const change = JSON.parse(String(init?.body));
      state.status = change.toStatusId ? "In Progress" : "Done";
      return Response.json({ from: change.toStatusId ? "Done" : "In Progress", to: state.status, undo: { toStatusId: "3", label: "Move back" } });
    }
    if (/^\/api\/jira\/ticket\/APP-/.test(input)) return state.failTicket
      ? Response.json({ error: "Not configured" }, { status: 503 })
      : Response.json({ key: input.split("/").pop(), status: { name: state.status }, summary: card.title });
    if (input === "/api/repos/app") return Response.json({ repo });
    if (input === "/api/repos/apps") return Response.json({ gitkraken: true, revealLabel: "Show in Finder" });
    if (input === "/api/tasks/profiles") return Response.json({ active: "work" });
    if (input.startsWith("/api/team/")) return Response.json({ linked: false, members: [] });
    return Response.json({});
  });
  vi.stubGlobal("fetch", state.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearTransitionOverride("APP-42"); });

describe("Home task context", () => {
  it("dedupes the primary status across My tasks and a Home WorkCard and refreshes both after a move and Undo", async () => {
    render(<><Tasks /><Summary /></>, { wrapper });
    const pills = await screen.findAllByRole("button", { name: "Change status from In Progress" });
    expect(pills).toHaveLength(2);
    expect(state.fetch.mock.calls.filter(([url]) => url === "/api/jira/ticket/APP-42")).toHaveLength(1);
    fireEvent.click(pills[0]);
    expect(screen.getByRole("dialog", { name: "Update Jira status" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Change status from Done" })).toHaveLength(2));
    expect(writes()).toHaveLength(1);
    expect(new Headers(writes()[0][1].headers).get("x-devhub-task-profile")).toBe("work");
    const undo = state.success.mock.calls.find(([message]) => message === "APP-42 moved to Done")![1].action;
    await act(async () => undo.onClick());
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Change status from In Progress" })).toHaveLength(2));
    expect(JSON.parse(writes()[1][1].body)).toEqual({ toStatusId: "3" });
    expect(new Headers(writes()[1][1].headers).get("x-devhub-task-profile")).toBe("work");
  });

  it.each([Tasks, Summary])("copies a Jira key and opens the ticket menu without opening the task menu", async (Surface) => {
    render(<Surface />, { wrapper });
    const key = screen.getByRole("button", { name: "Jira APP-42" });
    fireEvent.click(key);
    await waitFor(() => expect(state.copy).toHaveBeenCalledWith("APP-42"));
    expect(state.success).toHaveBeenCalledWith("Copied APP-42");
    fireEvent.contextMenu(key, { clientX: 10, clientY: 20 });
    const menu = activeMenu("APP-42 actions");
    for (const label of ["Open in Jira", "Copy browse URL", "Update ticket state", "Write plan with Agent…", "Implement with Agent…"]) {
      expect(within(menu).getByRole("menuitem", { name: new RegExp(`^${label}`), hidden: true })).toBeInTheDocument();
    }
    expect(screen.queryByText("Task-only action")).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Update ticket state", hidden: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(new Headers(writes()[0][1].headers).get("x-devhub-task-profile")).toBe("work");
  });

  it.each([Tasks, Summary])("links to the repo screen and opens the existing repo actions without the task menu", async (Surface) => {
    render(<Surface />, { wrapper });
    const link = screen.getByRole("link", { name: "app" });
    expect(link).toHaveAttribute("href", "/repos/app");
    // Cancel navigation in jsdom while still dispatching the link's real click.
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(screen.queryByText("Task-only action")).toBeNull();
    fireEvent.contextMenu(link);
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Open in Cursor", hidden: true })).toBeInTheDocument());
    const menu = activeMenu("app repository actions");
    for (const label of ["Terminal", "Show in Finder", "Open on GitHub", "Copy path"]) {
      expect(within(menu).getByRole("menuitem", { name: new RegExp(`^${label}`), hidden: true })).toBeInTheDocument();
    }
    expect(screen.queryByText("Task-only action")).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open in Cursor", hidden: true }));
    expect(state.cursor).toHaveBeenCalledWith("app");
  });

  it.each([Tasks, Summary])("opens the status picker from the task menu", async (Surface) => {
    render(<Surface />, { wrapper });
    const row = screen.queryByRole("article") ?? screen.getByRole("checkbox").closest("li")!;
    fireEvent.contextMenu(row);
    const menu = activeMenu("Fix login actions");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Update Jira status", hidden: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(new Headers(writes()[0][1].headers).get("x-devhub-task-profile")).toBe("work");
  });

  it.each(["ContextMenu", "F10"])("supports the %s keyboard menu on keys and repos", async (key) => {
    render(<Tasks />, { wrapper });
    const jira = screen.getByRole("button", { name: "Jira APP-42" });
    jira.focus();
    fireEvent.keyDown(jira, { key, shiftKey: key === "F10" });
    activeMenu("APP-42 actions");
    expect(screen.queryByText("Task-only action")).toBeNull();
    fireEvent.keyDown(jira, { key: "Escape" });
    expect(document.querySelector('[role="menu"][aria-label="APP-42 actions"]:not([hidden])')).toBeNull();
    const link = screen.getByRole("link", { name: "app" });
    link.focus();
    fireEvent.keyDown(link, { key, shiftKey: key === "F10" });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Copy path", hidden: true })).toBeInTheDocument());
    activeMenu("app repository actions");
    expect(screen.queryByText("Task-only action")).toBeNull();
  });

  it.each([
    { taskDone: true },
    { task: { id: "one", text: "Fix login", done: true, createdAt: "", startDate: "2026-10-19", rank: "a0" } },
    { task: { id: "one", text: "Fix login", done: false, abandonedAt: "2026-10-19", createdAt: "", startDate: "2026-10-19", rank: "a0" } },
    { jira: [] },
  ] satisfies Partial<BoardCard>[])("omits the pill for a finished, abandoned or unlinked task", async (patch) => {
    render(<HomeTaskContext card={{ ...card, ...patch }} profile="work" />, { wrapper });
    await act(async () => undefined);
    expect(screen.queryByRole("button", { name: /Change status from/ })).toBeNull();
    expect(state.fetch.mock.calls.filter(([url]) => url === "/api/jira/ticket/APP-42")).toHaveLength(0);
  });

  it("refreshes the ticket that changed when a secondary key is primary in another row", async () => {
    render(<><HomeTaskContext card={card} profile="work" /><HomeTaskContext card={{ ...card, taskId: "two", jira: ["APP-43"] }} profile="work" /></>, { wrapper });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Change status from In Progress" })).toHaveLength(2));
    fireEvent.contextMenu(screen.getAllByRole("button", { name: "Jira APP-43" })[0]);
    const menu = activeMenu("APP-43 actions");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Update ticket state", hidden: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Change status from Done" })).toHaveLength(1));
    expect(screen.getAllByRole("button", { name: "Change status from In Progress" })).toHaveLength(1);
    expect(writes()[0][0]).toBe("/api/jira/ticket/APP-43/transition");
  });

  it("quietly omits the pill when Jira is unavailable", async () => {
    state.failTicket = true;
    render(<Tasks />, { wrapper });
    await waitFor(() => expect(state.fetch).toHaveBeenCalledWith("/api/jira/ticket/APP-42"));
    expect(screen.queryByRole("button", { name: /Change status from/ })).toBeNull();
    expect(state.error).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
