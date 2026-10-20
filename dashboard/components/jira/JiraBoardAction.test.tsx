/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraTicket } from "@/lib/jira/client";
import { JiraBoardAction } from "./JiraBoardAction";

const mocks = vi.hoisted(() => ({ live: vi.fn(), mutate: vi.fn(), openTask: vi.fn(), fetch: vi.fn(), profile: "work" }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: (key: string) => key === "/api/tasks/profiles" ? { data: { active: mocks.profile } } : mocks.live(key) }));
vi.mock("@/components/storyboard/TaskDetailProvider", () => ({ useTaskDetail: () => ({ openTask: mocks.openTask }) }));
vi.mock("swr", () => ({ mutate: mocks.mutate }));

const ticket = { key: "TEST-1", summary: "Fix a bug", url: "https://example.atlassian.net/browse/TEST-1" } as JiraTicket;
beforeEach(() => {
  mocks.profile = "work";
  mocks.live.mockReturnValue({ data: { profile: "work", linked: {} }, mutate: mocks.mutate });
  mocks.fetch.mockResolvedValue(Response.json({ task: { id: "task-1" }, date: "2026-10-18", created: true }, { status: 201 }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("Jira Add to board", () => {
  it("offers Open task for an existing link, without any creation or launch", () => {
    mocks.live.mockReturnValue({ data: { profile: "work", linked: { "TEST-1": { taskId: "existing", date: "2026-10-10" } } }, mutate: mocks.mutate });
    render(<JiraBoardAction ticket={ticket} />);
    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(mocks.openTask).toHaveBeenCalledWith("existing");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("uses the server duplicate check and then offers the same detail panel", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ task: { id: "found-during-capture" }, date: "2026-10-10", created: false }));
    render(<JiraBoardAction ticket={ticket} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to board" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open task" }));
    expect(mocks.openTask).toHaveBeenCalledWith("found-during-capture");
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("/api/tasks/jira-intake", expect.objectContaining({ method: "POST", body: JSON.stringify({ key: ticket.key, summary: ticket.summary, url: ticket.url, profile: "work" }) }));
  });

  it("does not optimistically offer an Open task until capture has succeeded", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: "Couldn't save the task" }, { status: 503 }));
    render(<JiraBoardAction ticket={ticket} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to board" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save the task"));
    expect(screen.queryByRole("button", { name: "Open task" })).not.toBeInTheDocument();
    expect(mocks.openTask).not.toHaveBeenCalled();
  });

  it("never carries an Open task or a just-created link across profiles", async () => {
    const view = render(<JiraBoardAction ticket={ticket} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to board" }));
    expect(await screen.findByRole("button", { name: "Open task" })).toBeEnabled();
    mocks.profile = "home";
    view.rerender(<JiraBoardAction ticket={ticket} />);
    expect(screen.queryByRole("button", { name: "Open task" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to board" })).toBeDisabled();
  });
});
