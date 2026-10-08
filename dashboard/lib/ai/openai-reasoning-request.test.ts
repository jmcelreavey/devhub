import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateAiText } from "@/lib/ai/generate";
import { draftModelOverride } from "@/lib/jira/draft-ticket";
import { listAgentRuns } from "@/lib/agent-runs/store";

const ENV_KEYS = [
  "AI_API_KEY",
  "AI_BASE_URL",
  "AI_MODEL",
  "AI_REASONING_EFFORT",
  "DEVHUB_AI_PROVIDER",
  "JIRA_DRAFT_PROVIDER",
  "JIRA_DRAFT_MODEL",
  "JIRA_DRAFT_REASONING_EFFORT",
  "DEVHUB_AGENT_RUNS_DIR",
] as const;

function useOpenAi(model: string) {
  process.env.AI_API_KEY = "test-key";
  process.env.AI_BASE_URL = "https://api.openai.com/v1";
  process.env.AI_MODEL = model;
  delete process.env.AI_REASONING_EFFORT;
  delete process.env.DEVHUB_AI_PROVIDER;
  delete process.env.JIRA_DRAFT_PROVIDER;
  delete process.env.JIRA_DRAFT_MODEL;
  delete process.env.JIRA_DRAFT_REASONING_EFFORT;
}

/** The draft path: streamText via generateAiText, then the OpenAI Responses call. */
async function captureDraftRequest(extra: ReturnType<typeof draftModelOverride> = {}) {
  const bodies: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/responses") && init?.body) {
      bodies.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    }
    return new Response(JSON.stringify({ error: { message: "stopped in test" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }));

  await expect(generateAiText({
    prefer: "api",
    activity: { action: "Draft Jira ticket" },
    system: "Return JSON.",
    prompt: "Draft a ticket about the flaky checkout.",
    maxOutputTokens: 3_000,
    onTextDelta() {},
    ...extra,
  })).rejects.toThrow(/stopped in test/);

  expect(bodies).toHaveLength(1);
  return bodies[0]!;
}

describe("Jira draft reasoning effort on the OpenAI request", () => {
  let root: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-openai-effort-"));
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.DEVHUB_AGENT_RUNS_DIR = root;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sends reasoning.effort low for gpt-6-luna when the draft override is low", async () => {
    useOpenAi("gpt-5.4-mini");
    process.env.AI_REASONING_EFFORT = "high";
    process.env.JIRA_DRAFT_PROVIDER = "api";
    process.env.JIRA_DRAFT_MODEL = "gpt-6-luna";
    process.env.JIRA_DRAFT_REASONING_EFFORT = "low";

    const request = await captureDraftRequest(draftModelOverride());
    expect(request.url).toMatch(/\/responses$/);
    expect(request.body.model).toBe("gpt-6-luna");
    expect(request.body.reasoning).toEqual({ effort: "low" });
    expect(request.body).not.toHaveProperty("reasoning_effort");
    expect(listAgentRuns()[0]?.spec).toMatchObject({
      provider: "api",
      model: "gpt-6-luna",
      reasoningEffort: "low",
    });
  });

  it("sends reasoning.effort low for gpt-6-luna when no effort env is set", async () => {
    useOpenAi("gpt-6-luna");
    process.env.JIRA_DRAFT_PROVIDER = "api";
    process.env.JIRA_DRAFT_MODEL = "gpt-6-luna";

    const request = await captureDraftRequest(draftModelOverride());
    expect(request.url).toMatch(/\/responses$/);
    expect(request.body.model).toBe("gpt-6-luna");
    expect(request.body.reasoning).toEqual({ effort: "low" });
    expect(request.body).not.toHaveProperty("reasoning_effort");
    expect(listAgentRuns()[0]?.spec).toMatchObject({
      provider: "api",
      model: "gpt-6-luna",
      reasoningEffort: "low",
    });
  });

  it("omits reasoning effort for a non-Luna model when nothing asked for one", async () => {
    useOpenAi("gpt-5.4-mini");

    const request = await captureDraftRequest(draftModelOverride());
    expect(request.body.model).toBe("gpt-5.4-mini");
    expect(request.body.reasoning).toBeUndefined();
    expect(listAgentRuns()[0]?.spec).toMatchObject({ provider: "api", model: "gpt-5.4-mini" });
    expect(listAgentRuns()[0]?.spec).not.toHaveProperty("reasoningEffort");
  });
});
