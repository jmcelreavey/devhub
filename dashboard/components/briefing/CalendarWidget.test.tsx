/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarWidget } from "@/components/briefing/CalendarWidget";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: () => ({ data: { events: [], configured: true }, error: undefined, isLoading: false }),
}));

afterEach(cleanup);

describe("CalendarWidget View all", () => {
  it("links to the calendar page", () => {
    render(<CalendarWidget onToggle={() => undefined} />);
    expect(screen.getByRole("link", { name: "View all →" }).getAttribute("href")).toBe("/calendar");
  });
});
