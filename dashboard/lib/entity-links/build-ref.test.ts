import { describe, expect, it } from "vitest";
import { buildEntityRefFromInput } from "./build-ref";

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
});
