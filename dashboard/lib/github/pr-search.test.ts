import { describe, expect, it } from "vitest";
import {
  buildPrSearchQuery,
  filterPrRows,
  hasSearchQualifier,
  matchesPrSearch,
  searchTerms,
} from "./pr-search";
import type { GithubPrRow } from "./prs";

function row(overrides: Partial<GithubPrRow> = {}): GithubPrRow {
  return {
    number: 46,
    title: "PTF-4382 - Add Meta feed delivery",
    url: "https://github.com/businessinsider/syndication-services/pull/46",
    repo: "businessinsider/syndication-services",
    author: { login: "lgcaobianco" },
    ...overrides,
  };
}

describe("searchTerms", () => {
  it("splits on whitespace and lowercases", () => {
    expect(searchTerms("  Meta   Feed ")).toEqual(["meta", "feed"]);
  });

  it("returns nothing for a blank query", () => {
    expect(searchTerms("   ")).toEqual([]);
  });
});

describe("matchesPrSearch", () => {
  it("matches everything on an empty query", () => {
    expect(matchesPrSearch(row(), "")).toBe(true);
  });

  it("matches on title", () => {
    expect(matchesPrSearch(row(), "meta feed")).toBe(true);
  });

  it("matches on repo name", () => {
    expect(matchesPrSearch(row(), "syndication")).toBe(true);
  });

  it("matches on the repo#number id", () => {
    expect(matchesPrSearch(row(), "syndication-services#46")).toBe(true);
  });

  it("matches on a bare #number", () => {
    expect(matchesPrSearch(row(), "#46")).toBe(true);
  });

  it("matches on the author login", () => {
    expect(matchesPrSearch(row(), "lgcaobianco")).toBe(true);
  });

  it("ANDs terms rather than ORing them", () => {
    expect(matchesPrSearch(row(), "meta nonsense")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(matchesPrSearch(row(), "META")).toBe(true);
  });
});

describe("filterPrRows", () => {
  it("returns a copy when the query is blank", () => {
    const rows = [row()];
    expect(filterPrRows(rows, "  ")).toEqual(rows);
    expect(filterPrRows(rows, "  ")).not.toBe(rows);
  });

  it("narrows to matching rows", () => {
    const rows = [row(), row({ number: 51, title: "bump actions/checkout" })];
    expect(filterPrRows(rows, "meta").map((r) => r.number)).toEqual([46]);
  });
});

describe("hasSearchQualifier", () => {
  it("detects GitHub qualifiers", () => {
    expect(hasSearchQualifier("author:jmcelreavey")).toBe(true);
    expect(hasSearchQualifier("meta repo:bi/syndication-services")).toBe(true);
  });

  it("does not fire on plain text", () => {
    expect(hasSearchQualifier("add meta feed delivery")).toBe(false);
  });
});

describe("buildPrSearchQuery", () => {
  it("scopes a bare phrase to the user's orgs", () => {
    expect(buildPrSearchQuery("meta feed", ["businessinsider", "GCDTech"])).toBe(
      "is:pr meta feed org:businessinsider org:GCDTech sort:updated-desc",
    );
  });

  it("leaves a qualified query unscoped", () => {
    expect(buildPrSearchQuery("repo:bi/syndication-services meta", ["businessinsider"])).toBe(
      "is:pr repo:bi/syndication-services meta sort:updated-desc",
    );
  });

  it("survives having no orgs", () => {
    expect(buildPrSearchQuery("meta", [])).toBe("is:pr meta sort:updated-desc");
  });
});
