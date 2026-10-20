import { describe, expect, it } from "vitest";
import { legacyTodayHref } from "./home-redirect";
import { prTabFromSearch } from "./github/pr-tabs";
import { NAV_ITEMS } from "./nav";
import { paletteCommandScore } from "./command-palette-score";

describe("retired Today links", () => {
  it.each(["today", "focus", "dashboard"])("redirects view=%s to Home", (view) => {
    expect(legacyTodayHref(`view=${view}`)).toBe("/");
  });
  it("keeps selected task, profile, filters and unrelated hashes", () => {
    expect(legacyTodayHref("view=today&task=abc&taskProfile=work&repo=app&tag=one&tag=two", "#evidence")).toBe("/?task=abc&taskProfile=work&repo=app&tag=one&tag=two#evidence");
    expect(legacyTodayHref("view=today&tab=jira&q=APP-1&profile=work")).toBe("/work?tab=jira&q=APP-1&profile=work");
  });
  it.each([["#tasks", "/storyboard"], ["#jira", "/work?tab=jira"], ["#calendar", "/calendar"], ["#worktrees", "/prs?tab=cleanup"], ["#today", "/"]])("maps %s to its surviving surface", (hash, href) => {
    expect(legacyTodayHref("", hash)).toBe(href);
  });
  it("keeps a /today alias and leaves normal Home links alone", () => {
    expect(legacyTodayHref("task=abc", "", true)).toBe("/?task=abc");
    expect(legacyTodayHref("task=abc")).toBeNull();
    expect(legacyTodayHref("", "#notes")).toMatch(/^\/notes\/daily\/\d{4}-\d{2}-\d{2}$/);
  });
  it("still finds Home when Today is typed in the command palette", () => {
    const home = NAV_ITEMS.find((item) => item.href === "/")!;
    expect(paletteCommandScore("Today", [home.label, home.keywords ?? ""])).toBeGreaterThan(0);
    expect(home.label).toBe("Home");
  });
  it.each(["authored", "owned", "reviews", "recent", "skipped", "cleanup"] as const)("supports the PR %s deep link", (tab) => {
    expect(prTabFromSearch(tab)).toBe(tab);
  });
  it("defaults PRs to Mine + Owned action items without changing existing tabs", () => {
    expect(prTabFromSearch(null)).toBe("attention");
    expect(prTabFromSearch("attention")).toBe("attention");
    expect(prTabFromSearch("unknown")).toBe("attention");
  });
});
