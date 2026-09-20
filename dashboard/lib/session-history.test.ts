import { describe, expect, it } from "vitest";
import { appendSessionHistory, uniqueSessionHistory } from "./session-history";

const e = (href: string, label: string, ts: number) => ({ href, label, ts });

describe("appendSessionHistory", () => {
  it("keeps paths unique and moves revisits to the end", () => {
    let h = appendSessionHistory([], e("/agents", "Agents", 1));
    h = appendSessionHistory(h, e("/prs", "PRs", 2));
    h = appendSessionHistory(h, e("/today", "Today", 3));
    h = appendSessionHistory(h, e("/agents", "Agents", 4));
    expect(h.map((x) => x.href)).toEqual(["/prs", "/today", "/agents"]);
  });

  it("collapses Agents view query variants into one crumb", () => {
    let h = appendSessionHistory([], e("/agents", "Agents", 1));
    h = appendSessionHistory(h, e("/prs", "PRs", 2));
    h = appendSessionHistory(h, e("/agents?view=activity", "Agents", 3));
    h = appendSessionHistory(h, e("/today", "Today", 4));
    h = appendSessionHistory(h, e("/agents?view=archive", "Agents", 5));
    expect(h.map((x) => x.href)).toEqual(["/prs", "/today", "/agents?view=archive"]);
    expect(h.map((x) => x.label)).toEqual(["PRs", "Today", "Agents"]);
  });
});

describe("uniqueSessionHistory", () => {
  it("dedupes Agents query variants for breadcrumb display", () => {
    const trail = uniqueSessionHistory([
      e("/agents", "Agents", 1),
      e("/agents?view=activity", "Agents", 2),
      e("/prs", "PRs", 3),
      e("/today", "Today", 4),
      e("/agents?view=connection", "Agents", 5),
    ], 5);
    expect(trail.map((x) => x.label)).toEqual(["PRs", "Today", "Agents"]);
    expect(trail.at(-1)?.href).toBe("/agents?view=connection");
  });
});
