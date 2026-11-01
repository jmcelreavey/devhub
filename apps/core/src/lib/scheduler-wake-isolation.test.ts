import net from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { cancelWake, scheduleWake, wakeHelperStatus } from "../domains/scheduler/wake-helper";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("keeps an opted-in checkout scheduler away from the installed wake helper", async () => {
  vi.stubEnv("DEVHUB_CHECKOUT_DEV", "1");
  vi.stubEnv("DEVHUB_SCHEDULER", "1");
  const connect = vi.spyOn(net, "createConnection");
  for (const request of [wakeHelperStatus(), scheduleWake(Date.now() + 60_000), cancelWake()]) {
    await expect(request).rejects.toThrow("unavailable in checkout dev");
  }
  expect(connect).not.toHaveBeenCalled();
});
