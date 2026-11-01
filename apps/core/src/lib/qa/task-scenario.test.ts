import { describe, expect, it, vi } from "vitest";
import { jevPolicy, runQa, type QaDriver } from "@devhub/qa";
import { buildTaskQaScenario } from "./service";

const task = { id: "task-123", text: "Show the saved status", links: [] };
const qaScenario = { goals: [{ assertion: "text", selector: "[data-testid='save-status']", expected: "Saved", description: "Saved status is shown" }] };

describe("task QA declarations", () => {
  it("uses explicit assertions as evidence without granting page controls", async () => {
    const noteMarkdown = `## Verification\n\`\`\`devhub-qa\n${JSON.stringify(qaScenario)}\n\`\`\``;
    const selected = buildTaskQaScenario({ task, noteMarkdown, targetUrl: "http://localhost:4173/app" });
    if ("reason" in selected) throw new Error(selected.reason);
    expect(selected.scenario).toMatchObject({
      url: "http://localhost:4173/app",
      goals: [{ assertion: "text", selector: "[data-testid='save-status']", expected: "Saved" }],
    });
    expect(selected.scenario.actions?.length).toBeGreaterThan(0);
    expect(selected.scenario.actions?.every((action) => action.kind === "wait")).toBe(true);
    expect(selected.scenario.maxDurationMs).toBeGreaterThanOrEqual(120_000);

    const driver = (actual: string): QaDriver => ({
      surface: "dom",
      start: async () => undefined,
      observe: async () => ({ text: actual, fingerprint: actual, actions: selected.scenario.actions ?? [] }),
      act: async () => undefined,
      assert: async (goals) => goals.map((goal) => ({ id: goal.id, description: goal.description, passed: actual.includes(goal.expected ?? ""), actual })),
      capture: async (phase) => ({ file: `${phase}.png`, kind: "image", phase, sha256: "a".repeat(64) }),
      close: async () => [{ file: "run.webm", kind: "video", phase: "after", sha256: "b".repeat(64) }],
    });
    const routing = { text: jevPolicy({ apiKey: () => undefined }), experimentalImages: false, minConfidence: 0.65 };
    const passed = await runQa(selected.scenario, driver("Saved"), routing);
    const blocked = await runQa(selected.scenario, driver("Not saved"), routing);
    expect(passed).toMatchObject({ status: "passed", goals: [{ passed: true, actual: "Saved" }] });
    expect(blocked).toMatchObject({ status: "blocked", stopReason: expect.stringContaining("TYPESAFE_API_KEY"), goals: [{ passed: false }] });
    expect(blocked.artifacts.some((artifact) => artifact.kind === "video")).toBe(true);
  });

  it.each([
    { ...qaScenario, url: "https://example.com" },
    { ...qaScenario, actions: [{ kind: "click", selector: "button" }] },
    { goals: [{ ...qaScenario.goals[0], action: "click" }] },
  ])("rejects unsafe fields in a directly edited declaration", (candidate) => {
    const noteMarkdown = `## Verification\n\`\`\`devhub-qa\n${JSON.stringify(candidate)}\n\`\`\``;
    expect(buildTaskQaScenario({ task, noteMarkdown, targetUrl: "http://localhost:4173/app" })).toMatchObject({ reason: expect.stringContaining("QA skipped") });
  });

  it.each([
    { timeoutMs: undefined, expected: 20_000 },
    { timeoutMs: 120_000, expected: 120_000 },
  ])("applies the shipped Jev request timeout", async ({ timeoutMs, expected }) => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
    try {
      const policy = jevPolicy({
        apiKey: () => "test",
        timeoutMs,
        fetch: async () => new Response(JSON.stringify({
          answers: { action: { type: "choice", choice: "wait", confidence: 1, probabilities: { wait: 1 } } },
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      });
      const decision = await policy({ goal: "Wait", observation: { text: "Preview", fingerprint: "preview", actions: [{ id: "wait", description: "Wait", kind: "wait" }] }, history: [], signal: new AbortController().signal });
      expect(decision.actionId).toBe("wait");
      expect(timeout).toHaveBeenCalledWith(expected);
    } finally {
      timeout.mockRestore();
    }
  });

  it("bounds the shipped Jev timeout and honors cancellation", async () => {
    expect(() => jevPolicy({ apiKey: () => "test", timeoutMs: 120_001 })).toThrow("Invalid Jev request timeout.");
    const controller = new AbortController();
    const policy = jevPolicy({
      apiKey: () => "test",
      timeoutMs: 120_000,
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal || signal.aborted) { reject(new Error("aborted")); return; }
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });
    const decision = policy({ goal: "Wait", observation: { text: "Preview", fingerprint: "preview", actions: [{ id: "wait", description: "Wait", kind: "wait" }] }, history: [], signal: controller.signal });
    controller.abort();
    await expect(decision).rejects.toMatchObject({ message: "Decision cancelled." });
  });

});
