import { describe, it, expect } from "vitest";
import {
  buildEntityLinksSection,
  entityKey,
  extractTags,
  formatEntityRefLine,
  mergeEntityRefs,
  parseEntityLinksFromMarkdown,
  slugify,
  tagRefs,
  upsertEntityLinksInMarkdown,
  type EntityRef,
} from "./index.ts";

describe("slugify / entityKey", () => {
  it("slugifies", () => {
    expect(slugify("Sprint Planning!")).toBe("sprint-planning");
  });
  it("never ends on a separator after truncation", () => {
    // maxLen lands exactly on the hyphen between "ab" and "cd".
    expect(slugify("ab cd", { maxLen: 3 })).toBe("ab");
    expect(slugify("!!!", { maxLen: 8 })).toBe("untitled");
  });
  it("keys kind+id", () => {
    expect(entityKey({ kind: "task", id: "abc" })).toBe("task:abc");
  });
});

describe("extractTags / tagRefs", () => {
  it("extracts unique lowercase tags", () => {
    expect(extractTags("Fix login #auth #urgent #auth")).toEqual(["auth", "urgent"]);
  });
  it("ignores bare issue numbers and PR short forms", () => {
    expect(extractTags("see owner/repo#123 and (#525)")).toEqual([]);
  });
  it("requires a letter or underscore start, never pure digits", () => {
    expect(extractTags("#123 #1_2 #ab1")).toEqual(["ab1"]);
  });
  it("bounds tag length", () => {
    const long = "a".repeat(40);
    expect(extractTags(`#${long}`)).toEqual([]);
  });
  it("tagRefs carry the work-filter href", () => {
    const refs = tagRefs("ship it #devhub");
    expect(refs).toEqual([
      { kind: "tag", id: "devhub", label: "#devhub", href: "/work?tag=devhub" },
    ]);
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

  it("round-trips repository links", () => {
    const markdown = buildEntityLinksSection([
      { kind: "repo", id: "devhub-private", label: "devhub-private" },
    ]);
    expect(markdown).toContain("**Repo:** devhub-private");
    expect(parseEntityLinksFromMarkdown(markdown)).toEqual([
      { kind: "repo", id: "devhub-private", label: "devhub-private", href: undefined },
    ]);
  });

  it("round-trips diagram links", () => {
    const markdown = buildEntityLinksSection([
      {
        kind: "diagram",
        id: "diagrams/Acme/overview",
        label: "overview",
        href: "/diagrams/Acme/overview",
      },
    ]);
    expect(markdown).toContain("**Diagram:** [overview](/diagrams/Acme/overview)");
    expect(parseEntityLinksFromMarkdown(markdown)).toEqual([
      {
        kind: "diagram",
        id: "diagrams/Acme/overview",
        label: "overview",
        href: "/diagrams/Acme/overview",
      },
    ]);
  });

  it("normalises encoded diagram hrefs to vault storage ids", () => {
    const markdown = [
      "## Links",
      "",
      "**Diagram:** [Legal overview](/diagrams/Acme/Widget/Legal%20architecture%20overview)",
      "",
    ].join("\n");
    expect(parseEntityLinksFromMarkdown(markdown)).toEqual([
      {
        kind: "diagram",
        id: "diagrams/Acme/Widget/Legal architecture overview",
        label: "Legal overview",
        href: "/diagrams/Acme/Widget/Legal%20architecture%20overview",
      },
    ]);
  });

  it("dedupes diagram refs across build + parse id shapes", () => {
    const built = {
      kind: "diagram" as const,
      id: "diagrams/Acme/overview",
      label: "overview",
      href: "/diagrams/Acme/overview",
    };
    const section = buildEntityLinksSection([built]);
    const parsed = parseEntityLinksFromMarkdown(section);
    expect(mergeEntityRefs(parsed, [built])).toHaveLength(1);
  });

  it("upsertEntityLinksInMarkdown replaces or appends ## Links", () => {
    const withSection = ["# Hello", "", "## Links", "", "**Jira:** PTF-1", "", "## Notes", "body"].join(
      "\n",
    );
    const replaced = upsertEntityLinksInMarkdown(withSection, [
      { kind: "calendar", id: "evt-1", label: "Standup", href: "/calendar" },
    ]);
    expect(replaced).toContain("**Event:** [Standup](/calendar)");
    expect(replaced).not.toContain("PTF-1");
    expect(replaced).toContain("## Notes");

    const appended = upsertEntityLinksInMarkdown("# Solo", [
      { kind: "pr", id: "a/b#1", label: "a/b#1", href: "https://github.com/a/b/pull/1" },
    ]);
    expect(appended).toContain("# Solo");
    expect(appended).toContain("## Links");
    expect(appended).toContain("a/b#1");
  });

  it("removes the section cleanly when there are no refs left", () => {
    const md = ["# Hello", "", "## Links", "", "**Jira:** PTF-1", "", "## Notes", "body"].join("\n");
    const stripped = upsertEntityLinksInMarkdown(md, []);
    expect(stripped).not.toContain("## Links");
    expect(stripped).not.toContain("PTF-1");
    expect(stripped).toContain("# Hello");
    expect(stripped).toContain("## Notes");
    // No blank-line crater where the section used to be.
    expect(stripped).not.toMatch(/\n{3,}/);
  });
});
