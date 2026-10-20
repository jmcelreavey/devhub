/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { TeamTaskButtons, teamMenuGroups } from "./TeamTaskActions";
const state = vi.hoisted(() => ({ linked: false, fetch: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => ({ data: { linked: state.linked, online: true, members: [{ userId: "U2", userName: "helper" }] }, mutate: vi.fn() }) }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: state.success, info: state.info }) }));
vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("@/components/shell/ModalShell", () => ({ ModalShell: ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) => open ? <section role="dialog" aria-label={title}>{children}</section> : null }));
const card = { taskId: "task-one", title: "APP-1 Fix the task", task: { id: "task-one", done: false } } as BoardCard;
beforeEach(() => { state.linked = false; vi.clearAllMocks(); state.fetch.mockReset(); vi.stubGlobal("fetch", state.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("team task entry points", () => {
  it("notifies the owner when a live pending task is handed back", () => {
    const pending = { ...card, task: { ...card.task!, handoff: { handoffId: "h1", status: "pending" as const, toUserId: "U2", toName: "helper", expiresAt: 1 } } };
    const view = render(<TeamTaskButtons card={pending} />);
    view.rerender(<TeamTaskButtons card={card} />);
    expect(state.info).toHaveBeenCalledWith("Your handoff to @helper ended. It's yours again.");
  });
  it("leaves direct mode buttons and menus unchanged", () => {
    render(<TeamTaskButtons card={card} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(teamMenuGroups(false, false, vi.fn())).toEqual([]);
  });
  it("offers both actions only when linked and editable", () => {
    state.linked = true;
    const view = render(<TeamTaskButtons card={card} />);
    expect(screen.getByRole("button", { name: "Ask a teammate…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hand off…" })).toBeTruthy();
    expect(teamMenuGroups(true, false, vi.fn())[0].items.map((entry) => entry.label)).toEqual(["Ask a teammate…", "Hand off…"]);
    view.rerender(<TeamTaskButtons card={{ ...card, task: { ...card.task!, handoff: { handoffId: "h1", status: "accepted", toUserId: "U2", toName: "helper", expiresAt: 1 } } }} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("asks on one member click and blocks duplicate sends", async () => {
    state.linked = true;
    let finish!: (response: Response) => void;
    state.fetch.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    render(<TeamTaskButtons card={card} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask a teammate…" }));
    const helper = screen.getByRole("button", { name: "@helper" });
    fireEvent.click(helper); fireEvent.click(helper);
    expect(state.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({ action: "ask", taskId: "task-one", teammate: "U2" });
    finish(Response.json({ ok: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it.each([false, true])("requires a red, explicit confirmation before handoff (dirty=%s)", async (dirty) => {
    state.linked = true;
    state.fetch.mockResolvedValueOnce(Response.json({ token: "token", name: "helper", files: dirty ? ["app.ts"] : [], jira: true, reassignJira: true }));
    render(<TeamTaskButtons card={card} />);
    fireEvent.click(screen.getByRole("button", { name: "Hand off…" }));
    fireEvent.click(screen.getByRole("button", { name: "@helper" }));
    const confirm = await screen.findByRole("button", { name: dirty ? "Commit WIP and push" : "Push and hand off" });
    expect(confirm.className).toContain("danger");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(state.fetch).toHaveBeenCalledOnce();
    if (dirty) expect(screen.getByText("app.ts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.fetch).toHaveBeenCalledOnce();
  });
});

