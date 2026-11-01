import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const source = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./runtime-service-surface-reads", () => ({ serviceSurfaceRead: source.read }));
import { runtimeServiceTaskOperation } from "./runtime-service-tasks";

let root = "";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); if (root) fs.rmSync(root, { recursive: true, force: true }); });

it("requires a reviewed grant and the active profile for service surface reads", async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-surface-"));
  fs.mkdirSync(path.join(root, "work"));
  fs.mkdirSync(path.join(root, "home"));
  vi.stubEnv("TASKS_DIR", root);
  vi.stubEnv("DEVHUB_PROFILE", "work");
  source.read.mockImplementation(async (_request, current: () => boolean) => {
    if (!current()) throw new Error("Service authorisation or active task profile changed");
    return { state: "not-configured" };
  });
  const request = { operation: "calendar-week", profile: "work" };
  await expect(runtimeServiceTaskOperation([], request)).rejects.toThrow(/not reviewed/);
  expect(await runtimeServiceTaskOperation(["calendar-week"], request)).toEqual({ state: "not-configured" });
  vi.stubEnv("DEVHUB_PROFILE", "home");
  await expect(runtimeServiceTaskOperation(["calendar-week"], request)).rejects.toThrow(/profile/);
  await expect(runtimeServiceTaskOperation(["calendar-week"], { ...request, profile: "home" }, () => false)).rejects.toThrow(/authorised/);
});
