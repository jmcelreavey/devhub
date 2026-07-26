/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRouteUsage,
  normaliseRoute,
  readRouteUsage,
  recordRouteVisit,
  summariseRouteUsage,
} from "./route-usage";

describe("normaliseRoute", () => {
  it.each([
    ["/", "/"],
    ["", "/"],
    ["/notes", "/notes"],
    ["/notes/", "/notes"],
    ["/notes/daily/2026-07-26", "/notes"],
    ["/repos/learn/devhub", "/repos"],
    ["/search?q=hello", "/search"],
  ])("%s -> %s", (input, expected) => {
    expect(normaliseRoute(input)).toBe(expected);
  });

  it("collapses deep paths so one vault doesn't become a thousand keys", () => {
    for (let i = 0; i < 50; i += 1) recordRouteVisit(`/notes/deep/path/${i}`, "2026-07-26");
    expect(Object.keys(readRouteUsage())).toEqual(["/notes"]);
    expect(readRouteUsage()["/notes"].count).toBe(50);
  });
});

describe("recordRouteVisit", () => {
  beforeEach(() => clearRouteUsage());

  it("counts visits and tracks the last date", () => {
    recordRouteVisit("/radar", "2026-07-25");
    recordRouteVisit("/radar", "2026-07-26");
    expect(readRouteUsage()["/radar"]).toEqual({ count: 2, last: "2026-07-26" });
  });

  it("keeps routes independent", () => {
    recordRouteVisit("/radar", "2026-07-26");
    recordRouteVisit("/docs", "2026-07-26");
    expect(readRouteUsage()["/radar"].count).toBe(1);
    expect(readRouteUsage()["/docs"].count).toBe(1);
  });

  it("stops adding new keys past the cap but keeps counting known ones", () => {
    for (let i = 0; i < 70; i += 1) recordRouteVisit(`/route${i}`, "2026-07-26");
    const usage = readRouteUsage();
    expect(Object.keys(usage).length).toBe(60);

    const before = usage["/route0"].count;
    recordRouteVisit("/route0", "2026-07-27");
    expect(readRouteUsage()["/route0"].count).toBe(before + 1);
  });
});

describe("summariseRouteUsage", () => {
  beforeEach(() => clearRouteUsage());

  it("names the never-visited routes — the point of the exercise", () => {
    recordRouteVisit("/radar", "2026-07-26");
    const out = summariseRouteUsage(["/radar", "/docs", "/shared"]);
    expect(out).toContain("Never visited (2)");
    expect(out).toContain("/docs");
    expect(out).toContain("/shared");
    expect(out).not.toMatch(/Never visited.*\/radar/);
  });

  it("sorts busiest first", () => {
    recordRouteVisit("/docs", "2026-07-26");
    recordRouteVisit("/radar", "2026-07-26");
    recordRouteVisit("/radar", "2026-07-26");
    const lines = summariseRouteUsage(["/docs", "/radar"]).split("\n");
    expect(lines[1]).toContain("/radar");
    expect(lines[2]).toContain("/docs");
  });

  it("says so when everything has been used", () => {
    recordRouteVisit("/radar", "2026-07-26");
    expect(summariseRouteUsage(["/radar"])).toContain("Every known route has been visited");
  });
});
