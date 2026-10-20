/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PrRow } from "@/components/PrRow";
import type { GithubPrRow } from "@/lib/github/prs";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const row: GithubPrRow = {
  repo: "example-org/example-service",
  number: 123,
  title: "ABC-123 - Example change",
  url: "https://github.com/example-org/example-service/pull/123",
  author: { login: "you", avatarUrl: "https://example.com/you.png" },
};

describe("PrRow", () => {
  it("keeps context on the meta line and every action behind the kebab", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<PrRow row={row} kind="authored" density="compact" />);

    const meta = document.querySelector("[data-pr-meta]");
    const actions = document.querySelector("[data-pr-actions]");
    expect(meta).toBeTruthy();
    expect(actions).toBeTruthy();

    expect(meta?.textContent).toContain("example-org/example-service#123");
    expect(actions?.querySelector('[aria-label="Actions for example-org/example-service#123"]')).toBeTruthy();

    expect(screen.queryByRole("button", { name: /copy request/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /request review/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /open in cursor/i })).toBeNull();
    expect(screen.queryByLabelText("Approved")).toBeNull();
    expect(screen.queryByLabelText("Merged")).toBeNull();

    vi.unstubAllGlobals();
  });

  it("shows an approved check when the PR is approved", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<PrRow row={{ ...row, approved: true }} kind="authored" density="compact" />);
    expect(screen.getByLabelText("Approved")).toBeTruthy();
    expect(screen.queryByLabelText("Merged")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("shows a merge icon when the PR is merged", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<PrRow row={{ ...row, prState: "merged", approved: true }} kind="reviewed" density="compact" />);
    expect(screen.getByLabelText("Merged")).toBeTruthy();
    expect(screen.queryByLabelText("Approved")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("shows a CI glance glyph when checks are known", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(
      <PrRow
        row={{ ...row, checks: "failing", checkCounts: { passed: 1, failed: 2, pending: 0 } }}
        kind="authored"
        density="compact"
      />,
    );
    expect(screen.getByLabelText("checks failing")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("opens pull-request actions from the CI pill without opening the row menu", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(
      <PrRow
        row={{ ...row, checks: "failing", checkCounts: { passed: 1, failed: 2, pending: 0 } }}
        kind="reviews"
        density="compact"
      />,
    );
    fireEvent.contextMenu(screen.getByLabelText("checks failing"), { clientX: 12, clientY: 12 });
    const menu = document.querySelector('[role="menu"]:not([hidden])');
    expect(menu?.textContent).toMatch(/Open failing checks/);
    expect(menu?.textContent).toMatch(/Open PR in GitHub/);
    expect(menu?.textContent).not.toMatch(/Review with agent/);
    vi.unstubAllGlobals();
  });

  it("opens pull-request actions from Shift+F10 on an approved pill", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<PrRow row={{ ...row, approved: true }} kind="authored" density="compact" />);
    fireEvent.keyDown(screen.getByLabelText("Approved"), { key: "F10", shiftKey: true });
    const menu = document.querySelector('[role="menu"]:not([hidden])');
    expect(menu?.textContent).toMatch(/Open checks/);
    expect(menu?.textContent).not.toMatch(/Open failing checks/);
    vi.unstubAllGlobals();
  });

  it("shows a draft pill when the pull request is a draft", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<PrRow row={{ ...row, draft: true }} kind="authored" density="compact" />);
    const draft = screen.getByText("Draft");
    expect(draft.getAttribute("data-pr-status-pill")).toBe("");
    fireEvent.keyDown(draft, { key: "ContextMenu" });
    expect(document.querySelector('[role="menu"]:not([hidden])')?.textContent).toMatch(/Copy PR link/);
    vi.unstubAllGlobals();
  });

  it("opens the row menu from a right-click on the PR title", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<PrRow row={row} kind="reviews" density="compact" />);
    const title = screen.getByRole("link", { name: row.title });
    fireEvent.contextMenu(title, { clientX: 40, clientY: 80 });
    // popover=manual keeps the menu out of the a11y tree in jsdom; assert DOM.
    const menu = document.querySelector('[role="menu"][aria-label$="actions"]');
    expect(menu).toBeTruthy();
    expect(menu?.textContent).toMatch(/Review with agent/i);
    expect(menu?.textContent).toMatch(/Investigate pipeline/i);
    expect([...menu!.querySelectorAll(".context-menu-group-label")].slice(0, 4).map((node) => node.textContent)).toEqual([
      "Review", "Open", "Copy and share", "Visibility",
    ]);
    const actions = [...menu!.querySelectorAll('[role="menuitem"]')];
    expect(actions.slice(0, 8).map((node) => node.querySelector(".context-menu-label")?.textContent)).toEqual([
      "Review with agent", "Investigate pipeline", "Open in Cursor", "Open on GitHub",
      "Open note", "Copy PR URL", "Copy Jira URL", "Skip until updated",
    ]);
    for (const action of actions) expect(action.querySelector(".context-menu-icon svg")).not.toBeNull();
    const host = document.querySelector("[data-context-menu-host][data-context-menu='open']");
    expect(host?.classList.contains("pr-row")).toBe(true);
    vi.unstubAllGlobals();
  });
});
