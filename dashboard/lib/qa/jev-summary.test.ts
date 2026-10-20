import { describe, expect, it } from "vitest";
import type { QaReceipt } from "@devhub/qa";
import { jevInfoByTask, qaBugCount } from "./jev-summary";
import type { QaRunRecord } from "./store";

const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";
const BASE = "33333333-3333-4333-8333-333333333333";

function receipt(artifacts: QaReceipt["artifacts"], patch: Partial<QaReceipt> = {}): QaReceipt {
  return {
    schemaVersion: 1, id: "r", scenarioId: "s", title: "Smoke", surface: "dom", startedAt: "2026-10-17T09:00:00Z", endedAt: "2026-10-17T09:05:00Z",
    status: "failed", stopReason: "", goals: [{ id: "g1", passed: true }, { id: "g2", passed: false }] as unknown as QaReceipt["goals"], steps: [], artifacts, errors: ["boom"],
    totals: { durationMs: 1, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, unknownCostCalls: 0 }, ...patch,
  };
}
const run = (id: string, createdAt: string, r: QaReceipt, extra: Partial<QaRunRecord> = {}): QaRunRecord => ({ id, requestId: id, scenarioId: "s", taskId: "t1", createdAt, state: "finished", receipt: r, ...extra });
const art = (file: string, kind: "image" | "video", phase: "before" | "after" | "failure") => ({ file, kind, phase, sha256: "0".repeat(64) });

describe("jevInfoByTask", () => {
  it("counts failed goals plus runner errors as bugs", () => {
    expect(qaBugCount(run(RUN_A, "2026-10-17T09:00:00Z", receipt([])))).toBe(2);
    expect(qaBugCount({ ...run(RUN_A, "2026-10-17T09:00:00Z", receipt([])), receipt: undefined })).toBe(0);
  });

  it("takes the newest run, the baseline video as before, and the receipt link", () => {
    const info = jevInfoByTask([
      run(BASE, "2026-10-16T09:00:00Z", receipt([art("base.webm", "video", "after")]), { baseline: true }),
      run(RUN_A, "2026-10-17T08:00:00Z", receipt([art("old.png", "image", "after")])),
      run(RUN_B, "2026-10-17T09:00:00Z", receipt([art("b.png", "image", "before"), art("a.png", "image", "failure"), art("run.webm", "video", "after")])),
    ]).get("t1")!;
    expect(info).toMatchObject({ runId: RUN_B, bugCount: 2, goalsPassed: 1, goalsTotal: 2, receiptHref: `/qa?run=${RUN_B}&task=t1` });
    expect(info.beforeVideo).toBe(`/api/qa/runs/${BASE}/media/base.webm`);
    expect(info.afterVideo).toBe(`/api/qa/runs/${RUN_B}/media/run.webm`);
    expect(info.screenshot).toEqual({ url: `/api/qa/runs/${RUN_B}/media/a.png`, phase: "after" });
  });

  it("falls back to a before screenshot and ignores runs with no task or receipt", () => {
    const map = jevInfoByTask([
      run(RUN_A, "2026-10-17T09:00:00Z", receipt([art("b.png", "image", "before")])),
      run(RUN_B, "2026-10-17T10:00:00Z", receipt([]), { taskId: undefined }),
      { ...run(BASE, "2026-10-17T11:00:00Z", receipt([])), receipt: undefined, state: "running" },
    ]);
    expect(map.size).toBe(1);
    expect(map.get("t1")?.screenshot).toEqual({ url: `/api/qa/runs/${RUN_A}/media/b.png`, phase: "before" });
  });
});
