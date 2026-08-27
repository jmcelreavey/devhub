/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JiraWidget } from "@/components/jira/JiraWidget";
import { JiraTicketQueueRow, JiraTicketRow } from "@/components/jira/JiraTicketRow";
import { GridSizeContext } from "@/lib/hooks/use-grid-size";
import type { JiraTicket } from "@/lib/jira/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/EntityNoteAction", () => ({
  useVaultNoteExists: () => false,
}));

const tickets: JiraTicket[] = [];

vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: (key: string | null) => {
    if (key === "/api/jira/tickets") {
      return { data: { tickets, configured: true }, error: undefined, isLoading: false };
    }
    return { data: undefined, error: undefined, isLoading: false };
  },
}));

function ticket(n: number): JiraTicket {
  return {
    key: `PTF-${n}`,
    summary: `Ticket ${n}`,
    status: "Open",
    priority: "Medium",
    issuetype: "Task",
    project: "Platform",
    projectKey: "PTF",
    url: `https://jira.example/browse/PTF-${n}`,
    updatedAt: `2026-08-27T10:00:${String(n).padStart(2, "0")}Z`,
    assignee: { displayName: "JM", email: "jm@example.com" },
  };
}

function setTickets(list: JiraTicket[]) {
  tickets.splice(0, tickets.length, ...list);
}

function menuLabels(): string[] {
  return screen.getAllByRole("menuitem", { hidden: true }).map((el) => el.textContent ?? "");
}

afterEach(() => {
  cleanup();
  tickets.splice(0, tickets.length);
});

describe("JiraWidget compact column", () => {
  it("lists every ticket instead of a +N more preview", () => {
    setTickets(Array.from({ length: 12 }, (_, i) => ticket(i + 1)));
    render(
      <GridSizeContext.Provider value={{ jira: { w: 4, h: 14 } }}>
        <JiraWidget />
      </GridSizeContext.Provider>,
    );

    for (let n = 1; n <= 12; n++) {
      expect(screen.getByText(`PTF-${n}`)).toBeTruthy();
    }
    expect(screen.queryByText(/\+\d+ more/)).toBeNull();
  });

  it("opens the same row actions as the wide ticket row", () => {
    const row = ticket(4791);
    const { container } = render(<JiraTicketQueueRow ticket={row} />);
    const host = container.querySelector("[data-context-menu-host]");
    expect(host).toBeTruthy();
    expect(screen.getByRole("button", { name: "Actions for PTF-4791" })).toBeTruthy();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Change status from Open" }), {
      clientX: 20,
      clientY: 24,
    });
    const compact = menuLabels();
    cleanup();

    render(<JiraTicketRow ticket={row} density="comfortable" />);
    fireEvent.contextMenu(screen.getByText("Ticket 4791"), { clientX: 20, clientY: 24 });
    expect(menuLabels()).toEqual(compact);
    expect(compact.map((label) => label.replace(/No tags yet$/, "").trim())).toEqual(
      expect.arrayContaining(["Copy key", "Open in Jira", "Update ticket state", "Create note", "Copy browse URL"]),
    );
  });
});
