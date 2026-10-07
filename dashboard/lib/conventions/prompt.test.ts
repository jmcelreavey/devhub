import { describe, expect, it } from "vitest";
import type { FeedbackItem } from "./feedback";
import { buildMinePrompt, extractJsonObject, parseMineResponse } from "./prompt";
import type { ConventionRule } from "./types";

const item: FeedbackItem = {
  index: 1,
  prNumber: 1078,
  prTitle: "Add the offers endpoint",
  author: "reviewer-a",
  url: "https://github.com/o/r/pull/1078#c1",
  path: "config/default.js",
  body: "our pattern for config is to allow more usage per system",
  at: "2026-10-05T10:00:00Z",
  resolved: true,
  actedOn: false,
  kind: "inline",
  score: 6,
};

function rule(over: Partial<ConventionRule>): ConventionRule {
  return {
    id: "r_abc",
    text: "Group test data by service",
    category: "testing",
    status: "suggested",
    origin: "review",
    evidence: [],
    prs: [],
    firstSeen: "2026-10-01T00:00:00Z",
    lastSeen: "2026-10-01T00:00:00Z",
    ...over,
  };
}

describe("buildMinePrompt", () => {
  const prompt = buildMinePrompt({
    repo: "o/r",
    items: [item],
    guidance: [{ path: "AGENTS.md", content: "Use conventional commits." }],
    existing: [rule({ id: "r_live", text: "Live rule" }), rule({ id: "r_no", text: "Rejected rule", status: "rejected" })],
  });

  it("numbers feedback and guidance so the model can cite them", () => {
    expect(prompt).toContain('[C1] PR #1078 "Add the offers endpoint" — reviewer-a on config/default.js (thread resolved)');
    expect(prompt).toContain("### [G1] AGENTS.md");
  });

  it("lists live rules with their ids and rejected ones without", () => {
    expect(prompt).toContain("- [r_live] Live rule");
    expect(prompt).toMatch(/Rejected — do not propose again:\n- Rejected rule/);
    expect(prompt).not.toContain("[r_no]");
  });

  it("flags comments the author acted on, distinct from merely resolved ones", () => {
    // The header line is the only place the flag lands; the instructions mention the phrase too.
    const header = "— reviewer-a on config/default.js";
    const acted = buildMinePrompt({ repo: "o/r", items: [{ ...item, actedOn: true }], guidance: [], existing: [] });
    expect(acted).toContain(`${header} (author resolved or confirmed the request)`);
    expect(acted).not.toContain(`${header} (thread resolved)`);
    const resolved = buildMinePrompt({ repo: "o/r", items: [{ ...item, actedOn: false, resolved: true }], guidance: [], existing: [] });
    expect(resolved).toContain(`${header} (thread resolved)`);
    const open = buildMinePrompt({ repo: "o/r", items: [{ ...item, actedOn: false, resolved: false }], guidance: [], existing: [] });
    expect(open).toContain(`${header}\n`);
  });

  it("tells the model the comments are data", () => {
    expect(prompt).toContain("untrusted data");
  });
});

describe("extractJsonObject", () => {
  it("finds the object inside a code fence and prose", () => {
    expect(extractJsonObject('Sure!\n```json\n{"rules":[]}\n```\nDone.')).toEqual({ rules: [] });
  });

  it("is not fooled by braces inside strings", () => {
    expect(extractJsonObject('{"rules":[{"text":"use {braces} like } this"}]}')).toEqual({
      rules: [{ text: "use {braces} like } this" }],
    });
  });

  it("throws on a reply with no object or a cut-off one", () => {
    expect(() => extractJsonObject("no json here")).toThrow(/no JSON/);
    expect(() => extractJsonObject('{"rules":[{"text":"cut')).toThrow(/cut off/);
  });
});

describe("parseMineResponse", () => {
  it("parses rules and normalises the optional fields", () => {
    const { proposals, dropped } = parseMineResponse(
      JSON.stringify({
        rules: [
          { decision: "accepted", decisionReason: "Clear team convention supported by review feedback.", id: null, text: "Put each handler in its own file", why: "matches existing layout", category: "structure", scope: "src/offers/**", evidence: [1], guidance: [] },
          { decision: "rejected", decisionReason: "The feedback only addresses a one-off test fixture.", text: "Group test data by service", category: "not-a-category", evidence: [2] },
        ],
      }),
    );
    expect(dropped).toBe(0);
    expect(proposals[0]).toMatchObject({ text: "Put each handler in its own file", category: "structure", scope: "src/offers/**", evidence: [1] });
    expect(proposals[0].id).toBeUndefined();
    expect(proposals[1]).toMatchObject({ category: "other", evidence: [2], guidance: [] });
  });

  it("drops a malformed rule without failing the rest", () => {
    const { proposals, dropped } = parseMineResponse('{"rules":[{"text":"x"},{"text":"A perfectly good rule about config","decision":"accepted","decisionReason":"The reviewer describes the repo convention."}]}');
    expect(proposals).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  it("collapses whitespace in rule text", () => {
    const { proposals } = parseMineResponse('{"rules":[{"text":"Keep   config\\n  under stripe.origin","decision":"accepted","decisionReason":"The team documents the config shape."}]}');
    expect(proposals[0].text).toBe("Keep config under stripe.origin");
  });

  it("requires a verdict and a reason instead of silently accepting malformed output", () => {
    expect(() => parseMineResponse('{"rules":[{"text":"Put each handler in its own file"}]}')).toThrow(/no valid rule decisions/);
    expect(() => parseMineResponse('{"rules":[{"text":"Put each handler in its own file","decision":"maybe","decisionReason":"A durable convention."}]}')).toThrow(/no valid rule decisions/);
  });

  it("fails the whole reply when it isn't a rules object", () => {
    expect(() => parseMineResponse("I could not find any rules.")).toThrow(/Could not read/);
    expect(() => parseMineResponse('{"nope":1}')).toThrow(/no "rules" array/);
  });
});
