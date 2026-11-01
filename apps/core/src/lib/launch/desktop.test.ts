import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const launch = vi.hoisted(() => vi.fn(() => ({ unref: vi.fn() })));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: launch,
}));

const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it.skipIf(process.platform !== "darwin")("keeps the dashboard responsive while checking for an existing app", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-desktop-probe-"));
  roots.push(root);
  const macos = path.join(root, "Applications", "SlimCoreProbe.app", "Contents", "MacOS");
  fs.mkdirSync(macos, { recursive: true });
  fs.writeFileSync(path.join(macos, "SlimCoreProbe"), "");
  const calls = path.join(root, "calls");
  fs.writeFileSync(path.join(root, "pgrep"), "#!/bin/sh\nprintf x >> \"$DEVHUB_TEST_PGREP_CALLS\"\n/bin/sleep 1\nexit 0\n", { mode: 0o755 });
  vi.stubEnv("HOME", root);
  vi.stubEnv("PATH", root);
  vi.stubEnv("DEVHUB_TEST_PGREP_CALLS", calls);
  const { launchDesktopApp } = await import("./desktop");

  let timerFired = false;
  const timer = setTimeout(() => { timerFired = true; }, 50);
  try {
    const config = {
      appName: "SlimCoreProbe",
      macAppName: "SlimCoreProbe",
      linuxBinName: "slim-core-probe",
      releasesUrl: "https://example.invalid/releases",
    };
    const [first, second] = await Promise.all([launchDesktopApp(config), launchDesktopApp(config)]);
    expect(timerFired).toBe(true);
    expect(first).toMatchObject({ ok: true, focusedExisting: true });
    expect(second).toEqual(first);
    expect(fs.readFileSync(calls, "utf8")).toBe("x");
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith("open", ["-a", "SlimCoreProbe"], { detached: true, stdio: "ignore" });
  } finally {
    clearTimeout(timer);
  }
}, 15_000);
