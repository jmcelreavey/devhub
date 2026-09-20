import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wrapLanguageModel } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream, convertReadableStreamToArray } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { aiActivityMiddleware, startGenerationActivity } from "./activity";
import { listAgentRuns, readAgentRun } from "@/lib/agent-runs/store";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 3, text: 3, reasoning: 0 },
};
const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "Summarise the briefing." }] }];

describe("AI activity", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-ai-activity-"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", root);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("records a real model response and usage without changing the result", async () => {
    const result = { content: [{ type: "text" as const, text: "Three changes." }], finishReason: { unified: "stop" as const, raw: "stop" }, usage, warnings: [] };
    const model = wrapLanguageModel({
      model: new MockLanguageModelV3({ modelId: "test-model", doGenerate: result }),
      middleware: aiActivityMiddleware({ source: "briefing", action: "Morning briefing", groupId: "briefing-day" }),
    });
    expect(await model.doGenerate({ prompt })).toEqual(result);
    const [run] = listAgentRuns();
    expect(run.spec).toMatchObject({ runtime: "generation", model: "test-model", activity: { source: "briefing", groupId: "briefing-day" } });
    expect(run.status).toMatchObject({ state: "succeeded", resultText: "Three changes.", inputTokens: 10, outputTokens: 3 });
    expect(run.status.costUsd).toBeUndefined();
    expect(run.status.proposalId).toBeUndefined();
  });

  it("records a provider failure and propagates the original error", async () => {
    const error = new Error("Provider unavailable");
    const model = wrapLanguageModel({
      model: new MockLanguageModelV3({ doGenerate: async () => { throw error; } }),
      middleware: aiActivityMiddleware(),
    });
    await expect(model.doGenerate({ prompt })).rejects.toBe(error);
    expect(listAgentRuns()[0].status).toMatchObject({ state: "failed", error: "Provider unavailable" });
  });

  it("preserves streamed chunks and records the completed text", async () => {
    const chunks: LanguageModelV3StreamPart[] = [
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: "One " },
      { type: "text-delta", id: "text", delta: "result." },
      { type: "text-end", id: "text" },
      { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
    ];
    const model = wrapLanguageModel({
      model: new MockLanguageModelV3({ doStream: { stream: convertArrayToReadableStream(chunks) } }),
      middleware: aiActivityMiddleware(),
    });
    const result = await model.doStream({ prompt });
    expect(await convertReadableStreamToArray(result.stream)).toEqual(chunks);
    expect(listAgentRuns()[0].status).toMatchObject({ state: "succeeded", resultText: "One result.", outputTokens: 3 });
  });

  it("fails an incomplete stream instead of leaving a run active forever", async () => {
    const model = wrapLanguageModel({
      model: new MockLanguageModelV3({ doStream: { stream: convertArrayToReadableStream([{ type: "text-delta", id: "text", delta: "Partial" }]) } }),
      middleware: aiActivityMiddleware(),
    });
    await convertReadableStreamToArray((await model.doStream({ prompt })).stream);
    expect(listAgentRuns()[0].status).toMatchObject({ state: "failed", resultText: "Partial" });
  });

  it("forwards reader cancellation to the provider and records cancellation", async () => {
    const cancel = vi.fn();
    const model = wrapLanguageModel({
      model: new MockLanguageModelV3({ doStream: { stream: new ReadableStream<LanguageModelV3StreamPart>({ cancel }) } }),
      middleware: aiActivityMiddleware(),
    });
    const result = await model.doStream({ prompt });
    await result.stream.cancel("Closed the editor");
    expect(cancel).toHaveBeenCalledWith("Closed the editor");
    expect(listAgentRuns()[0].status.state).toBe("cancelled");
  });

  it("does not overwrite cancellation with a late successful result", () => {
    const controller = new AbortController();
    const activity = startGenerationActivity({ provider: "codex", prompt: "A prompt", signal: controller.signal });
    controller.abort();
    activity.succeed();
    expect(readAgentRun(activity.id)?.status).toMatchObject({ state: "cancelled", eventCount: 1 });
  });
});
