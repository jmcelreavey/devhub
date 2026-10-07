// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavProgress } from "./NavProgress";

const route = vi.hoisted(() => ({ pathname: "/agents", query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.query),
}));
vi.mock("@/lib/desktop/bridge", () => ({
  isDesktop: () => false,
  logDesktopEvent: vi.fn(),
  openInBrowser: vi.fn(),
}));

function Navigation({ href }: { href: string }) {
  return <>
    <NavProgress />
    <a href={href} onClick={event => event.preventDefault()}>Navigate</a>
  </>;
}

beforeEach(() => {
  route.pathname = "/agents";
  route.query = "";
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("NavProgress", () => {
  it.each([
    { from: "", to: "view=usage", href: "/agents?view=usage" },
    { from: "view=usage", to: "", href: "/agents" },
  ])("finishes query-only navigation from '$from' to '$to'", ({ from, to, href }) => {
    route.query = from;
    const { container, rerender } = render(<Navigation href={href} />);
    const bar = container.querySelector(".nav-progress");
    fireEvent.click(screen.getByRole("link"));
    expect(bar).toHaveClass("nav-progress-loading");

    route.query = to;
    rerender(<Navigation href={href} />);
    expect(bar).toHaveClass("nav-progress-done");
    act(() => vi.advanceTimersByTime(320));
    expect(bar).toHaveClass("nav-progress-idle");
  });

  it("does not start progress when clicking the current query tab", () => {
    route.query = "view=usage";
    const { container } = render(<Navigation href="/agents?view=usage" />);
    fireEvent.click(screen.getByRole("link"));
    expect(container.querySelector(".nav-progress")).toHaveClass("nav-progress-idle");
  });

  it("still finishes navigation to a different pathname", () => {
    const { container, rerender } = render(<Navigation href="/repos" />);
    fireEvent.click(screen.getByRole("link"));
    expect(container.querySelector(".nav-progress")).toHaveClass("nav-progress-loading");
    route.pathname = "/repos";
    rerender(<Navigation href="/repos" />);
    act(() => vi.advanceTimersByTime(320));
    expect(container.querySelector(".nav-progress")).toHaveClass("nav-progress-idle");
  });
});
