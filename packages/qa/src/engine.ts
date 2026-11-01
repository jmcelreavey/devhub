import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { DecisionError } from "./jev";
import type { Decision, DecisionInput, ModelUsage, QaDriver, QaReceipt, QaScenario, QaStep, Routing } from "./types";

const SAFE_ERRORS = new Set([
  "TYPESAFE_API_KEY is not configured.",
  "Jev requires 1–255 offered actions.",
  "The vision observation has no screenshot.",
  "QA image exceeds the 4 MiB local limit.",
  "Invalid TypeSafe response.",
  "TypeSafe returned an invalid or unoffered action.",
  "TypeSafe returned an invalid probability distribution.",
  "TypeSafe request failed or timed out.",
  "Decision cancelled.",
  "No vision policy is configured for this scenario.",
  "Low confidence: a vision fallback is required.",
  "Vision fallback is uncertain.",
  "QA vision needs an HTTP AI provider and a screenshot.",
  "Vision provider failed, timed out, or returned an invalid action.",
  "Policy selected an action outside the offered menu.",
  "QA cost budget reached.",
  "QA cannot fill password fields.",
  "The observed control changed before the action.",
  "Too many simultaneous keys.",
  "Unsupported or missing QA action target.",
]);

function message(error: unknown, fallback = "QA operation failed."): string {
  try {
    const value = typeof error === "string" ? error : error && typeof error === "object"
      ? Object.getOwnPropertyDescriptor(error, "message")?.value : undefined;
    return typeof value === "string" && (SAFE_ERRORS.has(value) || /^TypeSafe returned HTTP (?:[1-5]\d\d|unknown)\.$/.test(value)) ? value : fallback;
  } catch {
    return fallback;
  }
}

function safeCall(call: ModelUsage): ModelUsage {
  return call.error === undefined ? call : { ...call, error: message(call.error, "QA model call failed.") };
}

export async function routeDecision(surface: QaScenario["surface"], routing: Routing, input: DecisionInput, forceFallback = false): Promise<Decision> {
  const first = forceFallback ? routing.fallback : surface === "canvas"
    ? routing.experimentalImages ? routing.vision : routing.fallback
    : routing.text;
  if (!first) throw new DecisionError("No vision policy is configured for this scenario.");
  const calls: ModelUsage[] = [];
  try {
    const decision = await first(input);
    calls.push(...decision.calls.map(safeCall));
    if (decision.confidence >= routing.minConfidence) return { ...decision, calls };
  } catch (error) {
    if (error instanceof DecisionError) calls.push(...error.calls.map(safeCall));
    if (!routing.fallback || first === routing.fallback || input.signal.aborted) throw new DecisionError(message(error), calls);
  }
  if (!routing.fallback || first === routing.fallback) throw new DecisionError("Low confidence: a vision fallback is required.", calls);
  try {
    const fallback = await routing.fallback(input);
    calls.push(...fallback.calls.map(safeCall));
    if (fallback.confidence < routing.minConfidence) throw new DecisionError("Vision fallback is uncertain.");
    return { ...fallback, calls };
  } catch (error) {
    if (error instanceof DecisionError) calls.push(...error.calls.map(safeCall));
    throw new DecisionError(message(error), calls);
  }
}

async function waitForAssertions(scenario: QaScenario, driver: QaDriver, receipt: QaReceipt, signal: AbortSignal, waitMs: number, onAssertion?: (receipt: QaReceipt) => Promise<void>): Promise<void> {
  const until = Date.now() + waitMs;
  for (;;) {
    signal.throwIfAborted();
    receipt.goals = await driver.assert(scenario.goals, signal);
    await onAssertion?.(receipt);
    signal.throwIfAborted();
    if (receipt.goals.length === scenario.goals.length && receipt.goals.every((goal, index) => goal.id === scenario.goals[index].id && goal.passed)) {
      receipt.status = "passed"; receipt.stopReason = "assertions-passed"; return;
    }
    const remaining = until - Date.now();
    if (remaining <= 0) { receipt.stopReason = "assertion-wait-budget"; return; }
    await delay(Math.min(1000, remaining), undefined, { signal });
  }
}

export async function runQa(scenario: QaScenario, driver: QaDriver, routing: Routing, options: {
  id?: string;
  signal?: AbortSignal;
  onStep?: (step: QaStep, receipt: QaReceipt) => Promise<void>;
  assertionWaitMs?: number;
  onAssertion?: (receipt: QaReceipt) => Promise<void>;
} = {}): Promise<QaReceipt> {
  if (scenario.surface !== driver.surface || scenario.goals.length === 0 || scenario.maxSteps < 1 || scenario.maxSteps > 3000 ||
      scenario.maxDurationMs < 100 || scenario.maxDurationMs > 600000 || !Number.isFinite(scenario.maxCostUsd) || scenario.maxCostUsd <= 0 ||
      (options.assertionWaitMs !== undefined && (!Number.isSafeInteger(options.assertionWaitMs) || options.assertionWaitMs < 0 || options.assertionWaitMs > 600000))) throw new Error("Invalid QA scenario or driver.");
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
  let stage = "setup";
  try {
    await driver.start(signal);
    stage = "initial evidence capture";
    receipt.artifacts.push(await driver.capture("before"));
    if (options.assertionWaitMs !== undefined) {
      stage = "assertions";
      const onAssertion = options.onAssertion && (async (current: QaReceipt) => {
        stage = "progress storage";
        await options.onAssertion!(current);
        stage = "assertions";
      });
      await waitForAssertions(scenario, driver, receipt, signal, options.assertionWaitMs, onAssertion);
    } else {
      for (let index = 0; index < scenario.maxSteps; index++) {
        signal.throwIfAborted();
        stage = "assertions";
        receipt.goals = await driver.assert(scenario.goals, signal);
        if (receipt.goals.length === scenario.goals.length && receipt.goals.every(goal => goal.passed)) {
          receipt.status = "passed"; receipt.stopReason = "assertions-passed"; break;
        }
        stage = "observation";
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
          step.error = message(error, "QA action or decision failed.");
          if (error instanceof DecisionError) step.calls.push(...error.calls.map(safeCall));
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
        stage = "progress storage";
        await options.onStep?.(step, receipt);
        if (receipt.status === "blocked" || receipt.status === "cancelled") break;
      }
      if (!signal.aborted && receipt.status !== "blocked" && receipt.status !== "cancelled") {
        stage = "assertions";
        receipt.goals = await driver.assert(scenario.goals, signal);
        if (receipt.goals.length === scenario.goals.length && receipt.goals.every(goal => goal.passed)) {
          receipt.status = "passed"; receipt.stopReason = "assertions-passed";
        }
      }
    }
  } catch (error) {
    receipt.status = options.signal?.aborted ? "cancelled" : "blocked";
    receipt.stopReason = signal.aborted ? deadline.aborted && !options.signal?.aborted ? "time-budget" : "cancelled" : message(error, `QA ${stage} failed.`);
    receipt.errors.push(signal.aborted ? "QA stopped before completion." : message(error, `QA ${stage} failed.`));
  } finally {
    try { receipt.artifacts.push(await driver.capture(receipt.status === "passed" ? "after" : "failure")); }
    catch { receipt.errors.push("Final evidence capture failed. Check the browser or app and retry."); }
    try { receipt.artifacts.push(...await driver.close()); }
    catch { receipt.errors.push("QA runner cleanup failed. Check the browser or app and retry."); }
    if (options.assertionWaitMs !== undefined && signal.aborted) {
      receipt.status = options.signal?.aborted ? "cancelled" : "blocked";
      receipt.stopReason = options.signal?.aborted ? "cancelled" : "time-budget";
    }
    if (receipt.status === "passed" && receipt.errors.length) { receipt.status = "blocked"; receipt.stopReason = "evidence-incomplete"; }
    receipt.endedAt = new Date().toISOString();
    receipt.totals.durationMs = Date.now() - started;
  }
  return receipt;
}
