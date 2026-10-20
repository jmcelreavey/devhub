import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/tasks/capture", () => ({ captureDraftTask: mocks.capture }));
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "draft-capture-route-"));
  vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
  vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
  vi.stubEnv("DEVHUB_PROFILE", "work");
  fs.mkdirSync(path.join(root, "tasks", "work"), { recursive: true });
  mocks.capture.mockResolvedValue({ task: { id: "captured", stage: "draft" }, date: "2026-10-18", notePath: "task-notes/captured", context: {} });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

function capture(body: unknown) {
  return POST(new NextRequest("http://localhost:1337/api/tasks/capture", { method: "POST", headers: { origin: "http://localhost:1337", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

describe("draft capture compatibility", () => {
  it("keeps ordinary callers on the existing capture operation and response", async () => {
    const response = await capture({ text: "An idea" });
    expect(response.status).toBe(201);
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith({ text: "An idea" });
    expect(await response.json()).toMatchObject({ task: { id: "captured", stage: "draft" } });
  });
  it("accepts the current destination and rejects a stale profile without capturing", async () => {
    expect((await capture({ text: "An idea", profile: "home" })).status).toBe(409);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect((await capture({ text: "An idea", profile: "work" })).status).toBe(201);
    expect(mocks.capture).toHaveBeenCalledOnce();
  });
});
