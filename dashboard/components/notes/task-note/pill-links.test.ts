import { describe, expect, it } from "vitest";
import { dedupePillLinks, destinationKey, pillText } from "./pill-links";

const link = (kind: string, id: string, label: string, href?: string) => ({ kind, id, label, ...(href ? { href } : {}) });

describe("destinationKey", () => {
  it("treats every page of one GitHub PR as one destination, case-insensitively", () => {
    const base = destinationKey("https://github.com/Acme/App/pull/170");
    expect(destinationKey("https://github.com/acme/app/pull/170/")).toBe(base);
    expect(destinationKey("https://github.com/acme/app/pull/170/files#diff-1")).toBe(base);
    expect(destinationKey("https://www.github.com/acme/app/pull/170?diff=split")).toBe(base);
    expect(destinationKey("https://github.com/acme/app/pull/171")).not.toBe(base);
  });

  it("ignores host case, fragments, trailing slashes and query order, but not the path case or the query", () => {
    expect(destinationKey("https://Example.com/Docs/#top")).toBe(destinationKey("https://example.com/Docs"));
    expect(destinationKey("https://example.com/a?x=1&y=2")).toBe(destinationKey("https://example.com/a/?y=2&x=1"));
    expect(destinationKey("https://example.com/a?x=1")).not.toBe(destinationKey("https://example.com/a?x=2"));
    expect(destinationKey("https://example.com/Docs")).not.toBe(destinationKey("https://example.com/docs"));
  });

  it("handles relative hrefs and missing ones", () => {
    expect(destinationKey("/work?tab=tasks")).toBe(destinationKey("/work/?tab=tasks"));
    expect(destinationKey("/work?tab=tasks")).not.toBe(destinationKey("https://example.com/work?tab=tasks"));
    expect(destinationKey(undefined)).toBeUndefined();
    expect(destinationKey("  ")).toBeUndefined();
  });
});

describe("dedupePillLinks", () => {
  it("drops the same PR however its URL is written", () => {
    const out = dedupePillLinks([
      link("pr", "a/app#170", "app#170 — workflows", "https://github.com/a/app/pull/170"),
      link("pr", "a/app#170", "PR 170", "https://github.com/A/app/pull/170/files"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("app#170 — workflows");
  });

  it("keeps two links that only share a short label when both have destinations", () => {
    const out = dedupePillLinks([
      link("note", "n1", "Plan — phase 1", "/notes/plan-1"),
      link("note", "n2", "Plan — phase 2", "/notes/plan-2"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("collapses a link without an href into the same-kind, same-text one, preferring the href", () => {
    const withoutHref = link("jira", "PTF-1", "PTF-1");
    const withHref = link("jira", "PTF-1", "PTF-1", "https://jira.example.com/browse/PTF-1");
    expect(dedupePillLinks([withoutHref, withHref])).toEqual([withHref]);
    expect(dedupePillLinks([withHref, withoutHref])).toEqual([withHref]);
  });

  it("is case-insensitive on the text and keeps unrelated kinds apart", () => {
    const out = dedupePillLinks([link("repo", "r", "Devhub"), link("repo", "r2", "devhub"), link("note", "n", "devhub")]);
    expect(out.map((l) => l.id)).toEqual(["r", "n"]);
  });

  it("returns distinct links in order and an empty list for none", () => {
    const links = [link("pr", "1", "x#1", "https://github.com/o/x/pull/1"), link("pr", "2", "x#2", "https://github.com/o/x/pull/2")];
    expect(dedupePillLinks(links)).toEqual(links);
    expect(dedupePillLinks([])).toEqual([]);
  });
});

describe("pillText", () => {
  it("shows repo#number for GitHub PRs and the short part of 'a — b' labels", () => {
    expect(pillText(link("pr", "x", "PTF-5195 — big change", "https://github.com/o/app/pull/9"))).toBe("app#9");
    expect(pillText(link("note", "x", "Plan — phase 1"))).toBe("Plan");
    expect(pillText(link("pr", "x", "PTF-5195 — big change"))).toBe("big change");
    expect(pillText(link("jira", "PTF-1", "PTF-1 — thing"))).toBe("PTF-1");
  });
});
