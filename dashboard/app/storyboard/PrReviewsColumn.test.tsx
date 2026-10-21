/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NOTES_OPEN_PATH_EVENT } from "@/lib/notes/open-in-panel";
import { PrReviewsColumn } from "./PrReviewsColumn";

vi.mock("@/components/storyboard/WorkCardPrMenu", () => ({ WorkCardPrMenu: () => null }));

const item = {
  pr: { repo: "example-org/example-service", number: 123, title: "Example change", url: "https://github.com/example-org/example-service/pull/123" },
  note: { path: "reviews/example-service-123", title: "Review", repo: "example-service", prNumbers: [123] },
};

describe("PrReviewsColumn", () => {
  it("opens the review note in the Notes side panel instead of navigating", () => {
    const onOpen = vi.fn();
    window.addEventListener(NOTES_OPEN_PATH_EVENT, onOpen);
    render(<PrReviewsColumn items={[item]} collapsed={false} onToggle={() => {}} />);
    const link = screen.getByRole("link", { name: "Open review note" });
    expect(link.getAttribute("href")).toContain("/notes/");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(link, click);
    expect(click.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect((onOpen.mock.calls[0]![0] as CustomEvent<{ path: string }>).detail.path).toBe("reviews/example-service-123");
    window.removeEventListener(NOTES_OPEN_PATH_EVENT, onOpen);
  });

  it("keeps the full page for a modifier click", () => {
    const onOpen = vi.fn();
    window.addEventListener(NOTES_OPEN_PATH_EVENT, onOpen);
    render(<PrReviewsColumn items={[item]} collapsed={false} onToggle={() => {}} />);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true });
    fireEvent(screen.getByRole("link", { name: "Open review note" }), click);
    expect(onOpen).not.toHaveBeenCalled();
    window.removeEventListener(NOTES_OPEN_PATH_EVENT, onOpen);
  });

  it("marks the card while its context menu is open", () => {
    render(<PrReviewsColumn items={[item]} collapsed={false} onToggle={() => {}} />);
    const card = screen.getByRole("article", { name: "Example change" });
    fireEvent.contextMenu(card, { clientX: 20, clientY: 20 });
    expect(card.getAttribute("data-context-menu")).toBe("open");
  });
});
