import { describe, expect, it, vi } from "vitest";
import { withTaskTier, type AgentDispatchInput } from "./dispatch";

const base: AgentDispatchInput = { provider: "", prompt: "go", cwd: "/tmp", depth: 0, activity: { source: "interactive", action: "implement", taskId: "task-1" } };
const heavy = { step: "implement" as const, tier: "heavy" as const, provider: "claude", model: "opus", source: "defaults" as const };

describe("withTaskTier", () => {
  it.each(["plan", "implement", "verify", "create-pr", "review"])("passes tier effort to a %s run", (action) => {
    const out = withTaskTier({ ...base, activity: { ...base.activity!, action } }, () => ({ ...heavy, effort: "max" }), () => "codex");
    expect(out.effort).toBe("max");
  });

  it("preserves explicit effort, inherits on Default, and does not leak tier effort to another model", () => {
    const choose = () => ({ ...heavy, effort: "max" });
    expect(withTaskTier({ ...base, effort: "low" }, choose).effort).toBe("low");
    expect(withTaskTier({ ...base, effort: "" }, choose).effort).toBe("max");
    expect(withTaskTier({ ...base, provider: "codex", model: "gpt-6" }, choose).effort).toBeUndefined();
    expect(withTaskTier(base, () => heavy)).not.toHaveProperty("effort");
  });

  it("honours a pinned auto provider's default model without claiming a saved tier", () => {
    const out = withTaskTier(base, () => ({ ...heavy, model: "", override: true }), () => "codex");
    expect(out.provider).toBe("claude");
    expect(out.model).toBeUndefined();
    expect(out.tierUsed).toBeUndefined();
  });
  it("puts a task run on its step's tier and records it", () => {
    const choose = vi.fn(() => heavy);
    expect(withTaskTier(base, choose, () => "codex")).toMatchObject({ provider: "claude", model: "opus", tierUsed: { step: "implement", tier: "heavy" } });
    expect(choose).toHaveBeenCalledWith("task-1", "implement");
  });

  it("asks for the step that matches the run: review, plan, and fixes as implement", () => {
    const choose = vi.fn(() => heavy);
    for (const action of ["review", "plan", "agent"]) withTaskTier({ ...base, activity: { ...base.activity!, action } }, choose, () => "codex");
    expect(choose.mock.calls.map((call) => (call as unknown[])[1])).toEqual(["review", "plan", "agent"]);
  });

  it("passes a tier picked at launch through to the choice", () => {
    const choose = vi.fn(() => ({ ...heavy, tier: "cheap" as const, provider: "codex", model: "mini" }));
    expect(withTaskTier({ ...base, tier: "cheap" }, choose, () => "codex")).toMatchObject({ provider: "codex", model: "mini", tierUsed: { step: "implement", tier: "cheap" } });
    expect(choose).toHaveBeenCalledWith("task-1", "implement", "cheap");
  });

  it("leaves an explicit different pick alone and does not claim the tier", () => {
    const out = withTaskTier({ ...base, provider: "codex", model: "gpt-6" }, () => heavy, () => "codex");
    expect(out).toMatchObject({ provider: "codex", model: "gpt-6" });
    expect(out.tierUsed).toBeUndefined();
  });

  it("skips runs that are not task work or continue a session", () => {
    const choose = vi.fn(() => heavy);
    expect(withTaskTier({ ...base, activity: undefined }, choose)).toEqual({ ...base, activity: undefined });
    expect(withTaskTier({ ...base, resumeSessionId: "s1" }, choose).tierUsed).toBeUndefined();
    expect(choose).not.toHaveBeenCalled();
  });
});
