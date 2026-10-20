/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrchestrationSummary } from "@/lib/storyboard/orchestration";

const mocks = vi.hoisted(() => ({ data: null as null | { orchestrations: OrchestrationSummary[]; errors: string[] } }));
vi.mock("@/lib/storyboard/use-orchestrations", () => ({ useOrchestrations: () => ({ data: mocks.data, error: undefined }) }));
vi.mock("@/components/storyboard/AutoModeSwitch", () => ({ AutoModeSwitch: () => <span>switch</span> }));
vi.mock("@/components/storyboard/RepoAnswer", () => ({ RepoAnswer: () => null }));

import { OrchestratorStatus } from "./OrchestratorStatus";

afterEach(cleanup);

// The legacy step says Implement and the checkout says worktree: neither may show as its own line on auto.
const onAuto: OrchestrationSummary = {
  taskId: "t1", taskDate: "2026-10-17", status: "running", executionStep: "implement", openQuestions: 0, runCount: 4, updatedAt: "2026-10-17T15:00:00.000Z",
  checkout: { mode: "worktree", reason: "task looks large" },
  auto: { phase: "fix", round: 1, maxRounds: 2, runs: [] },
};

describe("OrchestratorStatus on auto", () => {
  it("shows one progress line, the card's own, with no separate step or checkout line", () => {
    mocks.data = { orchestrations: [onAuto], errors: [] };
    const { container } = render(<OrchestratorStatus ticket="t1" progress="Auto · Fixing, round 1 of 2 (4/5)" />);
    expect(screen.getByText("Auto · Fixing, round 1 of 2 (4/5) · Worktree")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Step:/);
    expect(container.textContent).not.toMatch(/task looks large/);
    expect(container.querySelectorAll("[data-progress]")).toHaveLength(1);
  });

  it("shows Manual even while the board still has the previous auto progress", () => {
    mocks.data = { orchestrations: [{ ...onAuto, status: "paused-manual" }], errors: [] };
    render(<OrchestratorStatus ticket="t1" progress="Auto · Fixing, round 1 of 2 (4/5)" />);
    expect(screen.getByText("Manual · Fixing, round 1 of 2 (4/5) · Worktree")).toBeTruthy();
  });

  it("keeps the failure and recovery visible when the first plan could not start", () => {
    mocks.data = { orchestrations: [{ ...onAuto, status: "paused", runCount: 0, checkout: undefined, lastError: "Paseo is unavailable.", auto: { phase: "plan", round: 0, maxRounds: 2, runs: [] } }], errors: [] };
    render(<OrchestratorStatus ticket="t1" progress="Auto · Planning (1/5)" />);
    expect(screen.getByText("Auto · Planning (1/5) · paused")).toBeTruthy();
    expect(screen.getByText(/Paseo is unavailable/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Tasks" })).toHaveAttribute("href", "/work?tab=tasks");
  });

  it("falls back to the auto state's own line without a card", () => {
    mocks.data = { orchestrations: [{ ...onAuto, checkout: undefined }], errors: [] };
    render(<OrchestratorStatus ticket="t1" />);
    expect(screen.getByText("Auto · Fixing, round 1 of 2 (4/5)")).toBeTruthy();
  });
});
