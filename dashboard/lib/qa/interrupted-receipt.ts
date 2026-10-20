import type { QaReceipt } from "@devhub/qa";
import type { QaRunRecord } from "./store";
export function interruptedReceipt(run: QaRunRecord): QaReceipt {
  return { schemaVersion: 1, id: run.id, scenarioId: run.scenarioId, title: run.scenarioId, surface: "dom", startedAt: run.createdAt, endedAt: new Date().toISOString(), status: "blocked", stopReason: "QA interrupted before evidence was recorded.", goals: [], steps: [], artifacts: [], errors: [], totals: { durationMs: Date.now() - Date.parse(run.createdAt), inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, unknownCostCalls: 0 } };
}
