import { afterEach, expect, it, vi } from "vitest";
import { clearDraft, getDraft, startDraft } from "./drafts";
import { generateDraft, planDraft, type DraftPlan } from "./train";
import type { VoiceProposal } from "../../../../../packages/shared/ui-lib/voice/types";

vi.mock("./train", () => ({ planDraft: vi.fn(), generateDraft: vi.fn() }));

afterEach(() => {
  clearDraft();
  vi.clearAllMocks();
});

it("joins an in-flight draft while its provider is being checked", async () => {
  let finishPlan!: (plan: DraftPlan) => void;
  let finishDraft!: (proposal: VoiceProposal) => void;
  const plan: DraftPlan = { system: "", prompt: "", answers: [], current: null };
  const proposal: VoiceProposal = { content: "draft", answers: [], current: null };
  vi.mocked(planDraft).mockReturnValue(new Promise((resolve) => { finishPlan = resolve; }));
  vi.mocked(generateDraft).mockReturnValue(new Promise((resolve) => { finishDraft = resolve; }));

  const first = startDraft();
  const second = startDraft();
  expect(planDraft).toHaveBeenCalledTimes(1);
  expect(generateDraft).not.toHaveBeenCalled();
  finishPlan(plan);
  const [started, joined] = await Promise.all([first, second]);
  expect(started.started).toBe(true);
  expect(joined.started).toBe(false);
  expect(joined.done).toBe(started.done);
  expect(generateDraft).toHaveBeenCalledTimes(1);
  expect((await startDraft()).done).toBe(started.done);
  finishDraft(proposal);
  expect(await started.done).toEqual(proposal);
  expect(getDraft()).toMatchObject({ status: "ready", proposal });
});

it("rejects failed preflight without starting a model call", async () => {
  vi.mocked(planDraft).mockRejectedValueOnce(new Error("No AI provider"));
  await expect(startDraft()).rejects.toThrow("No AI provider");
  expect(generateDraft).not.toHaveBeenCalled();
  expect(getDraft()).toEqual({ status: "idle" });
});
