import { randomUUID } from "node:crypto";
import { DecisionError } from "./jev";
import type { Decision, DecisionInput, ModelUsage, QaDriver, QaReceipt, QaScenario, QaStep, Routing } from "./types";

function message(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "QA operation failed.";
}

export async function routeDecision(surface: QaScenario["surface"], routing: Routing, input: DecisionInput, forceFallback = false): Promise<Decision> {
  const first = forceFallback ? routing.fallback : surface === "canvas"
    ? routing.experimentalImages ? routing.vision : routing.fallback
    : routing.text;
  if (!first) throw new DecisionError("No vision policy is configured for this scenario.");
  const calls: ModelUsage[] = [];
  try {
    const decision = await first(input);
    calls.push(...decision.calls);
    if (decision.confidence >= routing.minConfidence) return { ...decision, calls };
  } catch (error) {
    if (error instanceof DecisionError) calls.push(...error.calls);
    if (!routing.fallback || first === routing.fallback || input.signal.aborted) throw new DecisionError(message(error), calls);
  }
  if (!routing.fallback || first === routing.fallback) throw new DecisionError("Low confidence: a vision fallback is required.", calls);
  try {
    const fallback = await routing.fallback(input);
    calls.push(...fallback.calls);
    if (fallback.confidence < routing.minConfidence) throw new DecisionError("Vision fallback is uncertain.");
    return { ...fallback, calls };
  } catch (error) {
    if (error instanceof DecisionError) calls.push(...error.calls);
    throw new DecisionError(message(error), calls);
  }
}

export async function runQa(scenario: QaScenario, driver: QaDriver, routing: Routing, options: {
  id?: string;
  signal?: AbortSignal;
  onStep?: (step: QaStep, receipt: QaReceipt) => Promise<void>;
} = {}): Promise<QaReceipt> {
  if (scenario.surface !== driver.surface || scenario.goals.length === 0 || scenario.maxSteps < 1 || scenario.maxSteps > 3000 ||
      scenario.maxDurationMs < 100 || scenario.maxDurationMs > 600000 || !Number.isFinite(scenario.maxCostUsd) || scenario.maxCostUsd <= 0) throw new Error("Invalid QA scenario or driver.");
  const started = Date.now();
  const deadline = AbortSignal.timeout(scenario.maxDurationMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const receipt: QaReceipt = {
    schemaVersion: 1, id: options.id ?? randomUUID(), scenarioId: scenario.id, title: scenario.title, surface: scenario.surface,
    startedAt: new Date(started).toISOString(), endedAt: "", status: "failed", stopReason: "step-budget",
    goals: scenario.goals.map(goal => ({ id: goal.id, description: goal.description, passed: false, actual: "Not evaluated." })),
    steps: [], artifacts: [], errors: [],
    totals: { durationMs: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, unknownCostCalls: 0 },
  };
  let lastFingerprint = "";
  let repeated = 0;
  let lastProgress = started;
  let actionFailed = false;
  try {
    await driver.start(signal);
    receipt.artifacts.push(await driver.capture("before"));
    for (let index = 0; index < scenario.maxSteps; index++) {
      signal.throwIfAborted();
      receipt.goals = await driver.assert(scenario.goals, signal);
      if (receipt.goals.length === scenario.goals.length && receipt.goals.every(goal => goal.passed)) {
        receipt.status = "passed"; receipt.stopReason = "assertions-passed"; break;
      }
      const observation = await driver.observe(signal);
      if (observation.terminal === "death") { receipt.stopReason = "player-death"; break; }
      repeated = observation.fingerprint === lastFingerprint ? repeated + 1 : 0;
      if (repeated === 0) lastProgress = Date.now();
      lastFingerprint = observation.fingerprint;
      const stalled = repeated >= scenario.stallSteps && Date.now() - lastProgress > 12000;
      if (stalled && (actionFailed || !routing.fallback)) { receipt.stopReason = "suspected-soft-lock"; break; }
      const stepStart = Date.now();
      const step: QaStep = { index, at: new Date(stepStart).toISOString(), observationHash: observation.fingerprint, durationMs: 0, calls: [] };
      try {
        const decision = await routeDecision(scenario.surface, routing, {
          goal: scenario.goals.map(goal => goal.description).join("; "),
          observation, history: receipt.steps.slice(-8).map(row => `${row.action ?? "none"}${row.error ? ": " + row.error : ""}`), signal,
        }, actionFailed || stalled);
        step.calls = decision.calls;
        step.confidence = decision.confidence;
        const action = observation.actions.find(item => item.id === decision.actionId);
        if (!action) throw new Error("Policy selected an action outside the offered menu.");
        const cost = receipt.totals.estimatedCostUsd + step.calls.reduce((total, call) => total + (call.costUsd ?? 0), 0);
        if (cost > scenario.maxCostUsd) throw new Error("QA cost budget reached.");
        step.action = action.id;
        await driver.act(action, signal);
        actionFailed = stalled;
      } catch (error) {
        step.error = message(error);
        if (error instanceof DecisionError) step.calls.push(...error.calls);
        if (error instanceof DecisionError || actionFailed || signal.aborted || step.error.includes("budget")) {
          receipt.status = signal.aborted && options.signal?.aborted ? "cancelled" : "blocked";
          receipt.stopReason = signal.aborted ? options.signal?.aborted ? "cancelled" : "time-budget" : step.error;
        } else {
          actionFailed = true;
        }
      }
      step.durationMs = Date.now() - stepStart;
      receipt.steps.push(step);
      for (const call of step.calls) {
        receipt.totals.inputTokens += call.inputTokens ?? 0;
        receipt.totals.outputTokens += call.outputTokens ?? 0;
        receipt.totals.estimatedCostUsd += call.costUsd ?? 0;
        if (call.costUsd === null) receipt.totals.unknownCostCalls++;
      }
      await options.onStep?.(step, receipt);
      if (receipt.status === "blocked" || receipt.status === "cancelled") break;
    }
    if (!signal.aborted && receipt.status !== "blocked" && receipt.status !== "cancelled") {
      receipt.goals = await driver.assert(scenario.goals, signal);
      if (receipt.goals.length === scenario.goals.length && receipt.goals.every(goal => goal.passed)) {
        receipt.status = "passed"; receipt.stopReason = "assertions-passed";
      }
    }
  } catch (error) {
    receipt.status = options.signal?.aborted ? "cancelled" : "blocked";
    receipt.stopReason = signal.aborted ? deadline.aborted && !options.signal?.aborted ? "time-budget" : "cancelled" : message(error);
    receipt.errors.push(message(error));
  } finally {
    try { receipt.artifacts.push(await driver.capture(receipt.status === "passed" ? "after" : "failure")); }
    catch (error) { receipt.errors.push("Final capture: " + message(error)); }
    try { receipt.artifacts.push(...await driver.close()); }
    catch (error) { receipt.errors.push("Runner cleanup: " + message(error)); }
    if (receipt.status === "passed" && receipt.errors.length) { receipt.status = "blocked"; receipt.stopReason = "evidence-incomplete"; }
    receipt.endedAt = new Date().toISOString();
    receipt.totals.durationMs = Date.now() - started;
  }
  return receipt;
}
