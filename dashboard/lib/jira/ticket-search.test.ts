import { describe, expect, it } from "vitest";
import { filterTickets, matchesTicketSearch } from "./ticket-search";
import type { JiraTicket } from "./client";

function ticket(overrides: Partial<JiraTicket> = {}): JiraTicket {
  return {
    key: "PTF-4382",
    summary: "Add Meta feed delivery",
    status: "In Progress",
    priority: "High",
    issuetype: "Story",
    project: "Platform",
    projectKey: "PTF",
    url: "https://example.atlassian.net/browse/PTF-4382",
    updatedAt: "2026-08-13T19:07:19.000Z",
    assignee: { displayName: "John McElreavey", email: "john@example.com" },
    ...overrides,
  };
}

describe("matchesTicketSearch", () => {
  it("matches everything on an empty query", () => {
    expect(matchesTicketSearch(ticket(), "")).toBe(true);
  });

  it("matches on key", () => {
    expect(matchesTicketSearch(ticket(), "ptf-4382")).toBe(true);
  });

  it("matches on summary", () => {
    expect(matchesTicketSearch(ticket(), "meta feed")).toBe(true);
  });

  it("matches on status", () => {
    expect(matchesTicketSearch(ticket(), "in progress")).toBe(true);
  });

  it("matches on assignee name", () => {
    expect(matchesTicketSearch(ticket(), "mcelreavey")).toBe(true);
  });

  it("matches on project", () => {
    expect(matchesTicketSearch(ticket(), "platform")).toBe(true);
  });

  it("ANDs terms", () => {
    expect(matchesTicketSearch(ticket(), "meta nonsense")).toBe(false);
  });

  it("survives a missing assignee", () => {
    expect(matchesTicketSearch(ticket({ assignee: undefined }), "meta")).toBe(true);
  });
});

describe("filterTickets", () => {
  it("returns a copy on a blank query", () => {
    const rows = [ticket()];
    expect(filterTickets(rows, " ")).toEqual(rows);
    expect(filterTickets(rows, " ")).not.toBe(rows);
  });

  it("narrows to matching tickets", () => {
    const rows = [ticket(), ticket({ key: "PTF-1", summary: "Something else" })];
    expect(filterTickets(rows, "meta").map((t) => t.key)).toEqual(["PTF-4382"]);
  });
});
