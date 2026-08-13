import { describe, expect, it } from "vitest";
import { buildEntityRefFromInput, parseJiraIssueKey } from "./build-ref";

describe("buildEntityRefFromInput", () => {
  it("parses PR URLs", () => {
    const ref = buildEntityRefFromInput("pr", "https://github.com/org/repo/pull/42");
    expect(ref).toEqual({
      kind: "pr",
      id: "org/repo#42",
      label: "org/repo#42",
      href: "https://github.com/org/repo/pull/42",
    });
  });

  it("normalises jira keys", () => {
    expect(buildEntityRefFromInput("jira", "ptf-12").id).toBe("PTF-12");
  });

  it("parses jira browse URLs", () => {
    const ref = buildEntityRefFromInput(
      "jira",
      "https://example.atlassian.net/browse/PTF-99?focusedCommentId=1",
    );
    expect(ref).toEqual({
      kind: "jira",
      id: "PTF-99",
      label: "PTF-99",
      href: "https://example.atlassian.net/browse/PTF-99",
    });
  });

  it("parseJiraIssueKey accepts keys and browse paths", () => {
    expect(parseJiraIssueKey("dad-1")).toBe("DAD-1");
    expect(parseJiraIssueKey("https://x.atlassian.net/browse/DAD-1")).toBe("DAD-1");
    expect(parseJiraIssueKey("not-a-ticket")).toBeNull();
  });

  it("builds calendar refs from event id", () => {
    const ref = buildEntityRefFromInput("calendar", "evt-abc");
    expect(ref.kind).toBe("calendar");
    expect(ref.id).toBe("evt-abc");
    expect(ref.href).toBe("/calendar");
  });

  it("builds repository refs from local folder names", () => {
    expect(buildEntityRefFromInput("repo", "repo:devhub private")).toEqual({
      kind: "repo",
      id: "devhub private",
      label: "devhub private",
    });
    expect(() => buildEntityRefFromInput("repo", "../elsewhere")).toThrow(
      "Choose a local repository.",
    );
  });

  it("builds diagram refs from vault storage paths", () => {
    expect(
      buildEntityRefFromInput("diagram", "diagrams/Acme/Widget/Legal architecture overview"),
    ).toEqual({
      kind: "diagram",
      id: "diagrams/Acme/Widget/Legal architecture overview",
      label: "Legal architecture overview",
      href: "/diagrams/Acme/Widget/Legal%20architecture%20overview",
    });
  });

  it("normalises diagram route paths and rejects traversal", () => {
    expect(buildEntityRefFromInput("diagram", "/diagrams/Acme/foo.json")).toEqual({
      kind: "diagram",
      id: "diagrams/Acme/foo",
      label: "foo",
      href: "/diagrams/Acme/foo",
    });
    expect(() => buildEntityRefFromInput("diagram", "../elsewhere")).toThrow(
      /diagram path/,
    );
  });
});
