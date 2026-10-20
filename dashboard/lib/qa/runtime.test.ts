import { describe, expect, it, vi } from "vitest";
import { DecisionError, jevPolicy, routeDecision, runQa, type QaDriver, type QaScenario, type Routing } from "@devhub/qa";
import { ScenarioSchema } from "./schema";

const scenario: QaScenario = {
  id: "smoke", title: "Smoke", surface: "dom",
  goals: [{ id: "outcome", description: "Success visible", assertion: "text", expected: "Success" }],
  maxSteps: 3, maxDurationMs: 10000, maxCostUsd: 1, stallSteps: 3,
};
const call = { provider: "typesafe", model: "jev-1.13.0", inputTokens: 100, outputTokens: 12, costUsd: 0.0000042, costBasis: "estimated" as const, durationMs: 10 };
function fixture(passAfter = 1) {
  let actions = 0;
  const driver: QaDriver = {
    surface: "dom", start: vi.fn(async () => {}),
    observe: vi.fn<QaDriver["observe"]>(async () => ({ text: "Next", fingerprint: "same", actions: [{ id: "next", description: "Next", kind: "click" }] })),
    act: vi.fn(async () => { actions++; }),
    assert: vi.fn<QaDriver["assert"]>(async goals => goals.map(goal => ({ id: goal.id, description: goal.description, passed: actions >= passAfter, actual: actions >= passAfter ? "Success" : "Next" }))),
    capture: vi.fn<QaDriver["capture"]>(async phase => ({ file: phase + ".png", phase, kind: "image", sha256: "a".repeat(64) })),
    close: vi.fn(async () => []),
  };
  const routing: Routing = { text: vi.fn(async () => ({ actionId: "next", confidence: 0.95, calls: [call] })), experimentalImages: false, minConfidence: 0.65 };
  return { driver, routing };
}
describe("QA evidence gates", () => {
  it("passes only after the independent assertion succeeds and records model usage", async () => {
    const { driver, routing } = fixture();
    const receipt = await runQa(scenario, driver, routing);
    expect(receipt.status).toBe("passed");
    expect(receipt.steps).toHaveLength(1);
    expect(receipt.totals.inputTokens).toBe(100);
    expect(receipt.artifacts.map(artifact => artifact.phase)).toEqual(["before", "after"]);
    expect(driver.close).toHaveBeenCalledOnce();
  });
  it("cannot pass because a confident model keeps acting", async () => {
    const { driver, routing } = fixture(100);
    const receipt = await runQa(scenario, driver, routing);
    expect(receipt.status).toBe("failed");
    expect(receipt.stopReason).toBe("step-budget");
    expect(receipt.goals[0].passed).toBe(false);
    expect(receipt.artifacts.at(-1)?.phase).toBe("failure");
  });
  it("escalates uncertainty and retains both calls", async () => {
    const { driver, routing } = fixture();
    routing.text = async () => ({ actionId: "next", confidence: 0.2, calls: [call] });
    routing.fallback = vi.fn(async () => ({ actionId: "next", confidence: 0.9, calls: [{ ...call, provider: "vision", costUsd: null, costBasis: "unavailable" as const }] }));
    const receipt = await runQa(scenario, driver, routing);
    expect(receipt.status).toBe("passed");
    expect(receipt.steps[0].calls).toHaveLength(2);
    expect(receipt.totals.unknownCostCalls).toBe(1);
  });
  it("never executes an unoffered action and escalates action failures", async () => {
    const { driver, routing } = fixture();
    routing.text = async () => ({ actionId: "invented", confidence: 1, calls: [call] });
    const receipt = await runQa(scenario, driver, routing);
    expect(receipt.status).toBe("blocked");
    expect(driver.act).not.toHaveBeenCalled();
    expect(driver.close).toHaveBeenCalledOnce();
  });
  it("keeps failed API usage and will not send canvas images without opt-in", async () => {
    const { driver, routing } = fixture();
    routing.text = async () => { throw new DecisionError("HTTP failure", [call]); };
    const receipt = await runQa(scenario, driver, routing);
    expect(receipt.steps[0].calls).toHaveLength(1);
    expect(receipt.status).toBe("blocked");
    routing.vision = vi.fn();
    await expect(routeDecision("canvas", routing, { goal: "play", observation: await driver.observe(new AbortController().signal), history: [], signal: new AbortController().signal })).rejects.toThrow("No vision");
    expect(routing.vision).not.toHaveBeenCalled();
  });
  it("rejects empty goal sets and malformed scenario IDs", async () => {
    const { driver, routing } = fixture();
    await expect(runQa({ ...scenario, goals: [] }, driver, routing)).rejects.toThrow("Invalid");
    expect(ScenarioSchema.safeParse({ ...scenario, id: "../escape", url: "http://localhost:3000" }).success).toBe(false);
    expect(ScenarioSchema.safeParse({ ...scenario, url: "file:///etc/passwd" }).success).toBe(false);
  });
  it("does not turn missing evidence into a passing receipt", async () => {
    const { driver, routing } = fixture();
    driver.close = async () => { throw new Error("video missing"); };
    const receipt = await runQa(scenario, driver, routing);
    expect(receipt.status).toBe("blocked");
    expect(receipt.stopReason).toBe("evidence-incomplete");
  });
});

describe("Jev wire contract", () => {
  it("uses the explicit image header, unique asset reference and reported model version", async () => {
    const transport = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(init?.headers).toMatchObject({ "TypeSafe-Danger-Zone-Images": "true" });
      expect(body.model).toBe("jev-1.14.0");
      expect(body.assets[body.state.screenshot]).toMatchObject({ type: "image", format: "png" });
      return Response.json({ model: "jev-1.14.0", answers: { action: { type: "choice", choice: "next", confidence: 0.9, probabilities: { next: 1 } } }, usage: { input_tokens: 30, output_tokens: 5 } });
    });
    const policy = jevPolicy({ apiKey: () => "test-placeholder", images: true, fetch: transport as typeof fetch });
    const result = await policy({ goal: "Next", history: [], signal: new AbortController().signal, observation: { text: "Next", fingerprint: "x", screenshot: Buffer.from("fixture"), actions: [{ id: "next", kind: "click", description: "Next" }] } });
    expect(result.calls[0].model).toBe("jev-1.14.0");
    expect(result.calls[0].costUsd).toBeCloseTo(30 / 1000000 * 0.042);
  });
  it("does not expose upstream response bodies or credentials in errors", async () => {
    const policy = jevPolicy({ apiKey: () => "never-print-me", fetch: vi.fn(async () => new Response("never-print-me", { status: 401 })) as typeof fetch });
    await expect(policy({ goal: "Next", history: [], signal: new AbortController().signal, observation: { text: "Next", fingerprint: "x", actions: [{ id: "next", kind: "click", description: "Next" }] } })).rejects.toThrow("TypeSafe returned HTTP 401.");
  });
});
