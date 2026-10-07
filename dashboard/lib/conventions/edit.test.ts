import { describe, expect, it } from "vitest";
import { addManualRule, editRule, setRuleStatusWithUndo, undoRuleStatus } from "./edit";
import { emptyConventions } from "./store";

function fixture() {
  const file = emptyConventions("acme/widgets");
  const rule = addManualRule(file, { text: "Keep each handler in its own file" }, "2026-10-06T00:00:00Z");
  rule.status = "accepted";
  rule.acceptedBy = "pr";
  return { file, rule };
}

describe("decision undo", () => {
  it("restores automatic decision provenance without losing replay protection", () => {
    const { file, rule } = fixture();
    rule.origin = "review";
    delete rule.edited;
    delete rule.acceptedBy;
    rule.automaticDecision = { status: "accepted", reason: "A documented repo convention.", at: rule.lastSeen };
    const token = setRuleStatusWithUndo(file, rule.id, "rejected");
    expect(rule.automaticDecision).toBeUndefined();
    undoRuleStatus(file, token);
    expect(rule.automaticDecision?.reason).toBe("A documented repo convention.");
    expect(rule.status).toBe("accepted");
    expect(() => undoRuleStatus(file, token)).toThrow(/changed after/);
  });

  it("restores the actual previous status and automatic acceptance provenance", () => {
    const { file, rule } = fixture();
    const token = setRuleStatusWithUndo(file, rule.id, "rejected");
    expect(rule.acceptedBy).toBeUndefined();
    undoRuleStatus(file, token);
    expect(rule).toMatchObject({ status: "accepted", acceptedBy: "pr" });
  });

  it("survives serialisation and does not affect other rules", () => {
    const { file, rule } = fixture();
    const other = addManualRule(file, { text: "Group test fixtures by provider" }, "2026-10-06T00:00:00Z");
    const token = setRuleStatusWithUndo(file, rule.id, "rejected");
    const restored = JSON.parse(JSON.stringify(file));
    undoRuleStatus(restored, token);
    expect(restored.rules[1]).toEqual(other);
    expect(restored.rules[0].status).toBe("accepted");
  });

  it("does not overwrite a later edit", () => {
    const { file, rule } = fixture();
    const token = setRuleStatusWithUndo(file, rule.id, "rejected");
    editRule(file, rule.id, { text: "Keep each handler in a separate module" });
    expect(() => undoRuleStatus(file, token)).toThrow(/changed after/);
    expect(rule.text).toBe("Keep each handler in a separate module");
  });

  it("rejects stale decisions even if the status later returns to the same value", () => {
    const { file, rule } = fixture();
    const token = setRuleStatusWithUndo(file, rule.id, "rejected");
    setRuleStatusWithUndo(file, rule.id, "accepted");
    setRuleStatusWithUndo(file, rule.id, "rejected");
    expect(() => undoRuleStatus(file, token)).toThrow(/changed after/);
  });

  it("rejects replay, a different repo and malformed tokens", () => {
    const { file, rule } = fixture();
    const token = setRuleStatusWithUndo(file, rule.id, "rejected");
    expect(() => undoRuleStatus({ ...file, repo: "acme/other" }, token)).toThrow(/Invalid undo/);
    for (const invalid of ["{", "null", "{}"]) expect(() => undoRuleStatus(file, invalid)).toThrow(/Invalid undo/);
    undoRuleStatus(file, token);
    expect(() => undoRuleStatus(file, token)).toThrow(/changed after/);
  });
});
