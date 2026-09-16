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
    const host = document.querySelector("[data-context-menu-host][data-context-menu='open']");
    expect(host?.classList.contains("pr-row")).toBe(true);
    vi.unstubAllGlobals();
  });
});
