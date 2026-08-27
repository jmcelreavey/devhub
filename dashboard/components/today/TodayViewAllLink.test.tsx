/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onTodayCardHeaderClick, TodayViewAllLink } from "@/components/today/TodayViewAllLink";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("TodayViewAllLink", () => {
  it("is a real in-app link so Shift/⌘-click can open a workspace tab", () => {
    render(<TodayViewAllLink href="/calendar" />);
    const link = screen.getByRole("link", { name: "View all →" });
    expect(link.getAttribute("href")).toBe("/calendar");
    expect(link.getAttribute("data-today-view-all")).toBe("");
  });
});

describe("onTodayCardHeaderClick", () => {
  function Header() {
    return (
      <div onClick={onTodayCardHeaderClick}>
        <span>Today</span>
        <TodayViewAllLink href="/calendar" />
        <button type="button">Collapse</button>
      </div>
    );
  }

  it("replays a Shift-click on header chrome onto View all", () => {
    const replayed: MouseEvent[] = [];
    render(<Header />);
    screen.getByRole("link", { name: "View all →" }).addEventListener("click", (e) => {
      replayed.push(e);
    });

    fireEvent.click(screen.getByText("Today"), { shiftKey: true });
    expect(replayed).toHaveLength(1);
    expect(replayed[0].shiftKey).toBe(true);
  });

  it("leaves buttons and unmodified clicks alone", () => {
    const replayed: MouseEvent[] = [];
    render(<Header />);
    screen.getByRole("link", { name: "View all →" }).addEventListener("click", (e) => {
      replayed.push(e);
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse" }), { shiftKey: true });
    fireEvent.click(screen.getByText("Today"));
    expect(replayed).toHaveLength(0);
  });
});
