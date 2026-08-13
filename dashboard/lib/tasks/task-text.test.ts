import { describe, it, expect } from "vitest";
import {
  escapeRegExp,
  stripLinkedJiraKeyFromText,
  rewriteTaskKey,
  textWithJiraLinkPromotion,
  parseMarkdownLinks,
  detectBareUrl,
  clearedLineForToday,
  matchesTaskSearch,
  CLEARED_LINES,
} from "@/lib/tasks/task-text";
import type { Task } from "@/lib/tasks/types";

const task = (over: Partial<Task> = {}): Task => ({
  id: "1",
  text: "do the thing",
  done: false,
  createdAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

describe("escapeRegExp", () => {
  it("escapes characters that would otherwise be regex syntax", () => {
    expect(new RegExp(escapeRegExp("a.b*c")).test("a.b*c")).toBe(true);
    expect(new RegExp(escapeRegExp("a.b*c")).test("axbxc")).toBe(false);
  });
});

describe("stripLinkedJiraKeyFromText", () => {
  it("removes the key and tidies the remaining text", () => {
    expect(stripLinkedJiraKeyFromText("ABC-1 fix the login bug", "ABC-1")).toBe("fix the login bug");
  });

  it("removes a leading separator left behind", () => {
    expect(stripLinkedJiraKeyFromText("ABC-1 - fix login", "ABC-1")).toBe("fix login");
    expect(stripLinkedJiraKeyFromText("ABC-1: fix login", "ABC-1")).toBe("fix login");
  });

  it("is case insensitive", () => {
    expect(stripLinkedJiraKeyFromText("abc-1 fix login", "ABC-1")).toBe("fix login");
  });

  it("does not strip a key that is part of a longer token", () => {
    // \b guards this; without it "ABC-12" would lose its prefix.
    expect(stripLinkedJiraKeyFromText("ABC-12 fix login", "ABC-1")).toBe("ABC-12 fix login");
  });

  it("collapses the whitespace left where the key was", () => {
    expect(stripLinkedJiraKeyFromText("fix ABC-1 login", "ABC-1")).toBe("fix login");
  });
});

describe("rewriteTaskKey", () => {
  it("prepends the key when the task had none", () => {
    expect(rewriteTaskKey("fix login", undefined, "ABC-2")).toBe("ABC-2 fix login");
  });

  it("replaces an existing key in place", () => {
    expect(rewriteTaskKey("ABC-1 fix login", "ABC-1", "ABC-2")).toBe("ABC-2 fix login");
  });

  it("prepends when the old key isn't actually in the text", () => {
    expect(rewriteTaskKey("fix login", "ABC-1", "ABC-2")).toBe("ABC-2 fix login");
  });

  it("replaces every occurrence", () => {
    expect(rewriteTaskKey("ABC-1 then ABC-1", "ABC-1", "X-9")).toBe("X-9 then X-9");
  });
});


describe("textWithJiraLinkPromotion", () => {
  it("prepends the first jira link key when the task has none", () => {
    expect(
      textWithJiraLinkPromotion("fix login", undefined, [
        { kind: "jira", id: "ABC-9", label: "ABC-9" },
      ]),
    ).toBe("ABC-9 fix login");
  });

  it("leaves text alone when already jira-associated", () => {
    expect(
      textWithJiraLinkPromotion("ABC-1 fix login", "ABC-1", [
        { kind: "jira", id: "XYZ-2", label: "XYZ-2" },
      ]),
    ).toBe("ABC-1 fix login");
  });

  it("does not duplicate a key already present in the title", () => {
    expect(
      textWithJiraLinkPromotion("abc-9 fix login", undefined, [
        { kind: "jira", id: "ABC-9", label: "ABC-9" },
      ]),
    ).toBe("abc-9 fix login");
  });

  it("no-ops without jira links", () => {
    expect(
      textWithJiraLinkPromotion("fix login", undefined, [
        { kind: "pr", id: "org/repo#1", label: "PR" },
      ]),
    ).toBe("fix login");
  });
});

describe("parseMarkdownLinks", () => {
  it("returns a single text part for plain text", () => {
    expect(parseMarkdownLinks("hello")).toEqual([{ type: "text", text: "hello" }]);
  });

  it("splits text around a link", () => {
    expect(parseMarkdownLinks("see [docs](/docs) now")).toEqual([
      { type: "text", text: "see " },
      { type: "link", text: "docs", url: "/docs" },
      { type: "text", text: " now" },
    ]);
  });

  it("handles several links", () => {
    const parts = parseMarkdownLinks("[a](/a) and [b](/b)");
    expect(parts.filter((p) => p.type === "link").map((p) => p.url)).toEqual(["/a", "/b"]);
  });

  it("handles a link at the very start and end", () => {
    expect(parseMarkdownLinks("[a](/a)")).toEqual([{ type: "link", text: "a", url: "/a" }]);
  });

  it("returns an empty list for empty text", () => {
    expect(parseMarkdownLinks("")).toEqual([]);
  });
});

describe("detectBareUrl", () => {
  it("finds a bare url", () => {
    expect(detectBareUrl("see https://example.com now")).toBe("https://example.com");
  });

  it("ignores a url already inside a markdown link", () => {
    expect(detectBareUrl("see [docs](https://example.com)")).toBeNull();
  });

  it("returns null when there is no url", () => {
    expect(detectBareUrl("no links here")).toBeNull();
  });

  it("gives the same answer when called repeatedly", () => {
    // MD_LINK_RE is a module-level /g regex, so lastIndex is shared state and
    // without resets consecutive calls alternate between matching and not.
    // The original code got this right; this pins the behaviour so a future
    // tidy-up of the "redundant looking" resets can't reintroduce the hazard.
    const text = "see [docs](https://example.com)";
    expect(detectBareUrl(text)).toBeNull();
    expect(detectBareUrl(text)).toBeNull();
    expect(detectBareUrl(text)).toBeNull();
  });

  it("stays consistent when alternating between inputs", () => {
    expect(detectBareUrl("plain https://a.com")).toBe("https://a.com");
    expect(detectBareUrl("[x](https://b.com)")).toBeNull();
    expect(detectBareUrl("plain https://a.com")).toBe("https://a.com");
  });
});

describe("clearedLineForToday", () => {
  it("returns one of the known lines", () => {
    expect(CLEARED_LINES).toContain(clearedLineForToday("2026-07-26"));
  });

  it("is stable for the same day", () => {
    expect(clearedLineForToday("2026-07-26")).toBe(clearedLineForToday("2026-07-26"));
  });

  it("varies across dates", () => {
    const seen = new Set(
      ["2026-07-24", "2026-07-25", "2026-07-26", "2026-07-27"].map(clearedLineForToday),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("matchesTaskSearch", () => {
  it("matches everything on an empty query", () => {
    expect(matchesTaskSearch(task(), "")).toBe(true);
  });

  it("matches on text", () => {
    expect(matchesTaskSearch(task({ text: "Fix the login" }), "login")).toBe(true);
  });

  it("matches on jira key", () => {
    expect(matchesTaskSearch(task({ jiraKey: "ABC-1" }), "abc-1")).toBe(true);
  });

  it("is case insensitive in both directions", () => {
    expect(matchesTaskSearch(task({ text: "Fix Login" }), "LOGIN")).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(matchesTaskSearch(task(), "nonsense")).toBe(false);
  });
});
