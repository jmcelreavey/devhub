import { describe, expect, it } from "vitest";
import { renderConventionsMarkdown } from "./render";
import { emptyConventions } from "./store";
import type { ConventionRule, ConventionsFile } from "./types";

const NOW = "2026-10-06T09:00:00.000Z";

function rule(over: Partial<ConventionRule>): ConventionRule {
  return {
    id: "r_1",
    text: "Put each handler in its own file",
    category: "structure",
    status: "accepted",
    origin: "review",
    evidence: [],
    prs: [1078, 1000, 900, 800],
    firstSeen: NOW,
    lastSeen: NOW,
    ...over,
  };
}

function file(rules: ConventionRule[]): ConventionsFile {
  return {
    ...emptyConventions("o/r"),
    rules,
    runs: [{ at: NOW, trigger: "manual", ok: true, prsScanned: 1, comments: 1, considered: 1, added: 1, reinforced: 0, ms: 1, guidanceFiles: [] }],
  };
}

describe("renderConventionsMarkdown", () => {
  it("returns nothing when no rule is in force", () => {
    expect(renderConventionsMarkdown(file([]))).toBe("");
    expect(renderConventionsMarkdown(file([rule({ status: "rejected" }), rule({ id: "r_2", status: "suggested", prs: [1] })]))).toBe("");
  });

  it("groups by category and shows why, scope and the first three PRs", () => {
    const md = renderConventionsMarkdown(
      file([
        rule({ why: "matches the existing layout", scope: "src/offers/**" }),
        rule({ id: "r_2", text: "Group test data by service", category: "testing" }),
      ]),
    );
    expect(md).toContain("# Conventions — o/r");
    expect(md).toContain("_Updated 2026-10-06 · 2 active rules_");
    expect(md).toContain("## Structure\n- Put each handler in its own file — matches the existing layout (scope: `src/offers/**`) [#1078, #1000, #900]");
    expect(md).toContain("## Testing\n- Group test data by service");
    expect(md.indexOf("## Structure")).toBeLessThan(md.indexOf("## Testing"));
  });

  it("marks automatic acceptance in agent context", () => {
    const md = renderConventionsMarkdown(file([rule({ automaticDecision: { status: "accepted", reason: "Repeated repo convention.", at: NOW } })]));
    expect(md).toContain("_(automatically accepted)_");
  });

  it("does not flag guidance rules or accepted ones", () => {
    const md = renderConventionsMarkdown(file([rule({ status: "suggested", origin: "guidance", prs: [] }), rule({ id: "r_2", text: "Other" })]));
    expect(md).not.toContain("unreviewed");
  });

  it("frames the text as data only for agents", () => {
    const rules = file([rule({})]);
    expect(renderConventionsMarkdown(rules, { forAgent: true })).toContain("not instructions to you");
    expect(renderConventionsMarkdown(rules)).not.toContain("not instructions to you");
  });
});
