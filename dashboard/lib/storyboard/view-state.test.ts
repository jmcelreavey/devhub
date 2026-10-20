import { describe, expect, it } from "vitest";
import type { BoardCard } from "./notes-board-shared";
import type { JiraTicket } from "@/lib/jira/client";
import type { Task } from "@/lib/tasks/types";
import { matchesCardQuery, storyboardUrl, storyboardView, taskMatchesWorkFilters, ticketMatchesStatusFilter, ticketMatchesWorkFilters, ticketStatusTabs, workFilters, workViewTickets } from "./view-state";

describe("Storyboard URL state", () => {
  it("sends the removed list view to the board", () => {
    expect(storyboardView()).toBe("board");
  });

  it("is the board alone", () => {
    expect(storyboardView()).toBe("board");
  });
  it("switches views without losing filters, selection, repeated params or the hash", () => {
    const before = "repo=api&jira=TEST-1&parentJira=TEST-2&tag=bug&q=login&date=2026-10-18&task=task-1&taskSection=evidence&extra=a&extra=b";
    const result = new URL(storyboardUrl("/storyboard", before, { view: "history" }, "#details"), "http://localhost");
    expect(result.hash).toBe("#details");
    expect(result.searchParams.get("view")).toBe("history");
    for (const [key, value] of new URLSearchParams(before)) expect(result.searchParams.getAll(key)).toContain(value);
  });
  it("only changes requested params and supports the parent alias", () => {
    expect(storyboardUrl("/storyboard", "view=list&q=old&task=one", { q: null, tag: "bug" }, "#note")).toBe("/storyboard?view=list&task=one&tag=bug#note");
    expect(workFilters(new URLSearchParams("parent=TEST-2&repo=api&tag=bug"))).toEqual({ parentJira: "TEST-2", repo: "api", tag: "bug" });
  });
});

describe("filters shared by the work views", () => {
  it("counts exactly the Jira rows selected by search, status, shared filters, date and Needs you", () => {
    const tickets = [
      { key: "PTF-5271", summary: "Android login", status: "Code Review", parent: { key: "PTF-4891" }, updatedAt: "2026-10-18T10:00:00Z" },
      { key: "PTF-5272", summary: "Android logout", status: "Paused", parent: { key: "PTF-4891" }, updatedAt: "2026-10-18T10:00:00Z" },
      { key: "OTHER-1", summary: "Web login", status: "In Review", updatedAt: "2026-10-17T10:00:00Z" },
    ] as JiraTicket[];
    const cards = [{ taskId: "login", jira: ["PTF-5271"], repo: "app", tags: ["bug"] }] as BoardCard[];
    expect(workViewTickets(tickets, "Android", { parentJira: "PTF-4891" }, cards)).toHaveLength(2);
    expect(workViewTickets(tickets, "Android", { repo: "app" }, cards, "Code Review", "2026-10-18", new Set(["login"])).map((ticket) => ticket.key)).toEqual(["PTF-5271"]);
    expect(workViewTickets(tickets, "", {}, cards, "All", "2026-10-17")).toHaveLength(1);
  });
  const task: Task = { id: "task", text: "Fix login #urgent", rank: "a0", done: false, startDate: "2026-10-18", createdAt: "", jiraKey: "TEST-1", due: "2026-10-20", links: [{ kind: "repo", id: "api", label: "api" }] };
  const card = { taskId: task.id, title: "Fix login", date: "2026-10-18", status: "todo", tags: ["bug"], jira: ["TEST-1"], parentJira: "TEST-2", repo: "api", summary: ["Keep the session"], task } as BoardCard;
  const ticket = { key: "TEST-1", parent: { key: "TEST-2" } } as JiraTicket;

  it("searches the same task text, links, dates and note tags in Board and List", () => {
    expect(matchesCardQuery(card, "login #bug api 2026-10-20")).toBe(true);
    expect(matchesCardQuery(card, "unrelated")).toBe(false);
  });
  it("matches historical tasks by note-only or inline tag and linked repo/Jira", () => {
    expect(taskMatchesWorkFilters(task, { tag: "bug", repo: "api", jira: "TEST-1", parentJira: "TEST-2" }, card)).toBe(true);
    expect(taskMatchesWorkFilters(task, { tag: "urgent" })).toBe(true);
    expect(taskMatchesWorkFilters(task, { tag: "notes" }, undefined, { task: ["notes"] })).toBe(true);
    expect(taskMatchesWorkFilters(task, { repo: "other" }, card)).toBe(false);
  });
  it("applies Jira/parent directly and repo/tag through a linked task", () => {
    expect(ticketMatchesWorkFilters(ticket, { parentJira: "TEST-2", repo: "api", tag: "bug" }, [card])).toBe(true);
    expect(ticketMatchesWorkFilters(ticket, { jira: "none" }, [card])).toBe(false);
    expect(ticketMatchesWorkFilters(ticket, { repo: "api" }, [])).toBe(false);
    expect(ticketMatchesWorkFilters(ticket, {}, [])).toBe(true);
  });
});

describe("ticket status tabs", () => {
  it("lists only the statuses tickets really have, in workflow order, with counts, and matches them exactly", () => {
    const tabs = ticketStatusTabs([{ status: "In Progress" }, { status: "Open" }, { status: "Paused" }, { status: "Open" }, { status: "Done" }]);
    expect(tabs).toEqual([{ status: "All", count: 5 }, { status: "Open", count: 2 }, { status: "In Progress", count: 1 }, { status: "Paused", count: 1 }, { status: "Done", count: 1 }]);
    expect(ticketMatchesStatusFilter("In Progress", "in progress")).toBe(true);
    expect(ticketMatchesStatusFilter("In Progress", "Progress")).toBe(false);
  });
});
