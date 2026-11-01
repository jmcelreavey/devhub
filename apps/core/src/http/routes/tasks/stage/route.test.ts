import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../../../../domains/tasks/storage", () => ({ getTasks: vi.fn(), updateTask: vi.fn(), ensureTasksMigrated: vi.fn() }));
vi.mock("../../../../domains/tasks/implement-ready-gather", () => ({ checkTaskImplementReady: vi.fn() }));

import { checkTaskImplementReady } from "../../../../domains/tasks/implement-ready-gather";
import { ensureTasksMigrated, getTasks, updateTask } from "../../../../domains/tasks/storage";
import { POST } from "./route";

const task = { id: "fixture-task", text: "Fixture", stage: "draft" };
const request = (body: object) => new Request("http://localhost:1447/api/tasks/stage", {
  method: "POST", headers: { host: "localhost:1447", origin: "http://localhost:1447", "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ensureTasksMigrated).mockResolvedValue(undefined);
  vi.mocked(getTasks).mockReturnValue([task] as never);
  vi.mocked(updateTask).mockResolvedValue({ ...task, stage: "ready" } as never);
});

it("keeps the readiness gate unless force is explicitly true", async () => {
  vi.mocked(checkTaskImplementReady).mockResolvedValue({ ok: false, items: [{ ok: false, label: "Plan" }] } as never);
  const input = { taskId: task.id, date: "2026-10-29", stage: "ready" };
  const rejected = await POST(request(input));
  expect(rejected.status).toBe(409);
  expect((await rejected.json()).error).toContain("Plan");
  expect(updateTask).not.toHaveBeenCalled();
  expect((await POST(request({ ...input, force: true }))).status).toBe(200);
  expect(updateTask).toHaveBeenCalledWith(task.id, { stage: "ready" }, input.date);
  expect(checkTaskImplementReady).toHaveBeenCalledTimes(1);
});
