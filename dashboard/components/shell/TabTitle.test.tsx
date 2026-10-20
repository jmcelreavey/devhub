// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabTitle } from "./TabTitle";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

afterEach(() => {
  cleanup();
  document.title = "";
});

function titleAt(pathname: string): string {
  route.pathname = pathname;
  render(<TabTitle />);
  return document.title;
}

describe("TabTitle", () => {
  it.each([
    ["/", "Home · DevHub"],
    ["/work", "Tasks · DevHub"],
    ["/status", "Settings · DevHub"],
    ["/logs", "Logs · DevHub"],
    ["/review", "Weekly review · DevHub"],
    ["/review/rep", "Daily rep · DevHub"],
    ["/qa", "QA lab · DevHub"],
    ["/skills", "Agent skills · DevHub"],
    ["/briefing", "Briefing · DevHub"],
    ["/db", "Databases · DevHub"],
    ["/storyboard", "Storyboard · DevHub"],
    ["/repos/devhub", "Repos · DevHub"],
  ])("titles %s as '%s', the name the sidebar and palette use", (pathname, title) => {
    expect(titleAt(pathname)).toBe(title);
  });

  it("names notes and docs by their file", () => {
    expect(titleAt("/notes/daily/2026-10-17")).toBe("2026-10-17 · Notes");
    cleanup();
    expect(titleAt("/docs/guides/standup")).toBe("standup · Docs");
  });

  it("falls back to the product name for a page the registry does not know", () => {
    expect(titleAt("/nowhere")).toBe("DevHub");
  });
});
