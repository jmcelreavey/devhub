import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceProposal } from "./types";

const train = vi.hoisted(() => ({ planDraft: vi.fn(), generateDraft: vi.fn() }));
vi.mock("./train", () => train);

const plan = { system: "s", prompt: "p", answers: [{ scenarioId: "a", answeredAt: "t" }], current: null };
const proposal: VoiceProposal = { content: "# Learned voice\nx", answers: plan.answers, current: null };

/** A model call the test finishes by hand. */
function pendingModelCall() {
  let resolve!: (p: VoiceProposal) => void;
  let reject!: (e: Error) => void;
  train.generateDraft.mockReturnValue(new Promise<VoiceProposal>((res, rej) => ((resolve = res), (reject = rej))));
  return { resolve, reject };
}

// The draft lives in module state, so every test needs a fresh module.
async function load() {
  vi.resetModules();
  return import("./drafts");
}

beforeEach(() => {
  vi.resetAllMocks();
  train.planDraft.mockReturnValue(plan);
});

describe("voice draft holder", () => {
  it("starts idle", async () => {
    const { getDraft } = await load();
    expect(getDraft()).toEqual({ status: "idle" });
  });

  it("is running while the model works, then holds the finished draft", async () => {
    const { getDraft, startDraft } = await load();
    const call = pendingModelCall();

    const { started, done } = startDraft();
    expect(started).toBe(true);
    expect(getDraft().status).toBe("running");

    call.resolve(proposal);
    await expect(done).resolves.toBe(proposal);
    expect(getDraft()).toMatchObject({ status: "ready", proposal });
  });

  it("joins a draft already running instead of starting a second model call", async () => {
    const { startDraft } = await load();
    const call = pendingModelCall();

    const first = startDraft();
    const second = startDraft();
    expect(second.started).toBe(false);
    expect(second.done).toBe(first.done);
    expect(train.generateDraft).toHaveBeenCalledTimes(1);

    call.resolve(proposal);
    await first.done;
  });

  it("records why a draft failed, and still rejects the caller waiting on it", async () => {
    const { getDraft, startDraft } = await load();
    const call = pendingModelCall();

    const { done } = startDraft();
    call.reject(new Error("cursor-agent hit its time limit"));

    await expect(done).rejects.toThrow("time limit");
    expect(getDraft()).toMatchObject({ status: "failed", error: "cursor-agent hit its time limit" });
  });

  it("lets a failed draft be retried", async () => {
    const { getDraft, startDraft } = await load();
    pendingModelCall().reject(new Error("boom"));
    await startDraft().done.catch(() => undefined);

    train.generateDraft.mockResolvedValue(proposal);
    const retry = startDraft();
    expect(retry.started).toBe(true);
    await retry.done;
    expect(getDraft().status).toBe("ready");
  });

  it("refuses up front, with no model call and no state change, when drafting isn't possible", async () => {
    const { getDraft, startDraft } = await load();
    train.planDraft.mockImplementation(() => {
      throw new Error("No new answers to learn from.");
    });

    expect(() => startDraft()).toThrow("No new answers");
    expect(train.generateDraft).not.toHaveBeenCalled();
    expect(getDraft()).toEqual({ status: "idle" });
  });

  it("forgets a finished draft, but never one still being generated", async () => {
    const { clearDraft, getDraft, startDraft } = await load();
    const call = pendingModelCall();

    const { done } = startDraft();
    clearDraft();
    expect(getDraft().status).toBe("running");

    call.resolve(proposal);
    await done;
    clearDraft();
    expect(getDraft()).toEqual({ status: "idle" });
  });
});
