/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const launched = vi.hoisted(() => ({ props: [] as Array<{ tierStep?: string; intent: { stage?: string } }> }));
vi.mock("@/components/agents/AgentLaunchSheet", () => ({
  AgentLaunchForm: (props: { tierStep?: string; intent: { stage?: string } }) => { launched.props.push(props); return null; },
}));
vi.mock("swr", () => ({ mutate: vi.fn() }));

import { SkillAgentDialog } from "./SkillAgentDialog";

afterEach(() => { cleanup(); launched.props = []; });

const base = { open: true, onClose: () => undefined, title: "Implement with agent", description: "", getPrompt: () => "Do it", summary: "Implement t", reason: "r", taskId: "t1", taskDate: "2026-10-17" };

describe("SkillAgentDialog tiers", () => {
  it("starts the manual Implement on the saved Implement tier (the launch sheet preselects its agent and model)", () => {
    render(<SkillAgentDialog {...base} />);
    expect(launched.props.at(-1)).toMatchObject({ tierStep: "implement", intent: { stage: "implement" } });
  });

  it("uses the plan and PR tiers for those steps, and no tier for a follow-up that keeps its session's agent", () => {
    render(<SkillAgentDialog {...base} stage="plan" />);
    expect(launched.props.at(-1)!.tierStep).toBe("plan");
    render(<SkillAgentDialog {...base} stage="create-pr" />);
    expect(launched.props.at(-1)!.tierStep).toBe("draft-pr");
    render(<SkillAgentDialog {...base} parentRunId="run-1" />);
    expect(launched.props.at(-1)!.tierStep).toBeUndefined();
  });
});
