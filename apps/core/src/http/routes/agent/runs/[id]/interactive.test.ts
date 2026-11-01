import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../../../../../lib/agent-runs/store", () => ({
  readAgentRun: vi.fn(),
  appendInteractiveAgentNote: vi.fn(),
  finishInteractiveAgentRun: vi.fn(),
  toAgentRunSummary: vi.fn(),
}));

import { appendInteractiveAgentNote, finishInteractiveAgentRun, readAgentRun, toAgentRunSummary } from "../../../../../lib/agent-runs/store";
import { POST as note } from "./note/route";
import { POST as finish } from "./finish/route";

const runId = "run-fixture-00000001";
const params = { params: Promise.resolve({ id: runId }) };
const request = (suffix: string, body: object) => new Request(`http://localhost:1447/api/agent/runs/${runId}/${suffix}`, {
  method: "POST", headers: { host: "localhost:1447", origin: "http://localhost:1447", "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => vi.resetAllMocks());

it("refuses interactive mutations on non-interactive runs", async () => {
  vi.mocked(readAgentRun).mockReturnValue({ spec: { id: runId, bin: "paseo" } } as never);
  expect((await note(request("note", { text: "fixture" }), params)).status).toBe(400);
  expect((await finish(request("finish", { ok: true }), params)).status).toBe(400);
  expect(appendInteractiveAgentNote).not.toHaveBeenCalled();
  expect(finishInteractiveAgentRun).not.toHaveBeenCalled();
});

it("keeps interactive note and finish inputs validated and trimmed", async () => {
  const run = { spec: { id: runId, bin: "interactive" } } as never;
  vi.mocked(readAgentRun).mockReturnValue(run);
  vi.mocked(appendInteractiveAgentNote).mockReturnValue(run);
  vi.mocked(finishInteractiveAgentRun).mockReturnValue(run);
  vi.mocked(toAgentRunSummary).mockReturnValue({ id: runId } as never);
  expect((await note(request("note", { text: "  " }), params)).status).toBe(400);
  expect((await note(request("note", { text: " fixture " }), params)).status).toBe(200);
  expect(appendInteractiveAgentNote).toHaveBeenCalledWith(run, "fixture");
  expect((await finish(request("finish", { ok: false, error: " failed " }), params)).status).toBe(200);
  expect(finishInteractiveAgentRun).toHaveBeenCalledWith(run, expect.objectContaining({ ok: false, error: "failed" }));
});
