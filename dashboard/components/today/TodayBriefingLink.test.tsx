/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TodayBriefingLink } from "@/components/today/TodayBriefingLink";


afterEach(cleanup);

describe("Briefing link on Today", () => {
  it("is a quiet hero link to /briefing", () => {
    render(<TodayBriefingLink />);
    const link = screen.getByRole("link", { name: "Briefing" });
    expect(link).toHaveAttribute("href", "/briefing");
    expect(link).toHaveClass("hub-hero-link");
  });

});
