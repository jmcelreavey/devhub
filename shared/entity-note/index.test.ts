import { describe, it, expect } from "vitest";
import {
  buildEntityLinksSection,
  entityKey,
  formatEntityRefLine,
  mergeEntityRefs,
  parseEntityLinksFromMarkdown,
  slugify,
  type EntityRef,
} from "./index.ts";

describe("slugify / entityKey", () => {
  it("slugifies", () => {
    expect(slugify("Sprint Planning!")).toBe("sprint-planning");
  });
  it("keys kind+id", () => {
    expect(entityKey({ kind: "task", id: "abc" })).toBe("task:abc");
  });
});

describe("format + build + parse round-trip", () => {
  it("formats markers and links", () => {
    expect(
      formatEntityRefLine({
        kind: "task",
        id: "a",
        label: "Hi",
        marker: "::task-ref a 2026-01-01 Hi",
      }),
    ).toBe("::task-ref a 2026-01-01 Hi");
    expect(
      formatEntityRefLine({
        kind: "pr",
        id: "org/repo#1",
        label: "org/repo#1",
        href: "https://github.com/org/repo/pull/1",
      }),
    ).toBe("**PR:** [org/repo#1](https://github.com/org/repo/pull/1)");
  });

  it("parses ## Links and task-ref markers", () => {
    const md = [
      "# Hello",
      "",
      "## Links",
      "",
      "::task-ref abc-1 2026-07-28 Ship it",
      "**PR:** [bi/svc#9](https://github.com/bi/svc/pull/9)",
      "**Event:** [Open in Calendar](https://cal.example/e)",
      "",
      "## Notes",
    ].join("\n");
    const refs = parseEntityLinksFromMarkdown(md);
    expect(refs.map((r) => r.kind)).toEqual(["task", "pr", "calendar"]);
    expect(refs[0].id).toBe("abc-1");
    expect(refs[1].href).toContain("github.com");
  });

  it("merges without duplicates", () => {
    const a: EntityRef = { kind: "task", id: "1", label: "A" };
    const b: EntityRef = { kind: "task", id: "1", label: "A again" };
    const c: EntityRef = { kind: "pr", id: "r#1", label: "PR" };
    expect(mergeEntityRefs([a], [b, c])).toHaveLength(2);
  });

  it("buildEntityLinksSection wraps refs", () => {
    expect(buildEntityLinksSection([{ kind: "note", id: "x", label: "X", href: "/notes/x" }])).toContain(
      "## Links",
    );
  });
});
