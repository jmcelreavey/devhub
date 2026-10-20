/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraTicket } from "@/lib/jira/client";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import TicketsPage from "./client";

const state = vi.hoisted(() => ({ tickets: [] as JiraTicket[], configured: true }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => ({ data: { tickets: state.tickets, configured: state.configured }, mutate: vi.fn() }) }));
vi.mock("@/lib/hooks/use-sidebar-counts", () => ({ useMarkTicketsSeen: () => undefined }));
vi.mock("@/components/today/TodayBootScreen", () => ({ BootScreen: () => null, useBootGate: () => "done" }));
vi.mock("@/components/jira/JiraTicketRow", () => ({ JiraTicketRow: ({ ticket, boardIntake }: { ticket: JiraTicket; boardIntake?: boolean }) => <div data-testid={ticket.key} data-intake={boardIntake}>{ticket.summary}</div> }));
beforeEach(() => {
  state.configured = true;
  state.tickets = [{ key: "TEST-1", summary: "Fix login", status: "In Progress", updatedAt: "2026-10-18T10:00:00Z", parent: { key: "TEST-2" } }, { key: "TEST-3", summary: "Other ticket", status: "Open", updatedAt: "2026-10-17T10:00:00Z" }] as JiraTicket[];
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Storyboard Jira reuse", () => {
  it("shares Jira rows and intake, applying q/date and linked-task filters", () => {
    const cards = [{ taskId: "linked", repo: "api", tags: ["bug"], jira: ["TEST-1"] }] as BoardCard[];
    render(<TicketsPage embedded query="login" date="2026-10-18" filters={{ repo: "api", tag: "bug", parentJira: "TEST-2" }} cards={cards} />);
    expect(screen.getByTestId("TEST-1")).toHaveAttribute("data-intake", "true");
    expect(screen.queryByTestId("TEST-3")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Jira" })).toBeInTheDocument();
  });
  it("keeps Setup one click away when Jira is not connected", () => {
    state.configured = false;
    render(<TicketsPage embedded query="" />);
    expect(screen.getByRole("link", { name: "Setup" })).toHaveAttribute("href", "/setup");
  });
});
