import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it.skipIf(process.platform === "win32")("keeps the event loop responsive and shares a pending Cursor-agent lookup", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-cursor-agent-"));
  roots.push(root);
  const shell = path.join(root, "login-shell");
  const binary = path.join(root, "cursor-agent");
  const calls = path.join(root, "calls");
  fs.writeFileSync(binary, "");
  fs.writeFileSync(shell, "#!/bin/sh\nprintf x >> \"$DEVHUB_TEST_CURSOR_CALLS\"\n/bin/sleep 1\nprintf '%s\\n' \"$DEVHUB_TEST_CURSOR_BIN\"\n", { mode: 0o755 });
  vi.stubEnv("SHELL", shell);
  vi.stubEnv("DEVHUB_TEST_CURSOR_BIN", binary);
  vi.stubEnv("DEVHUB_TEST_CURSOR_CALLS", calls);

  const { resolveCursorAgentBin, isCursorAgentInstalled } = await import("./cli-env");
  let timerFired = false;
  const timer = setTimeout(() => { timerFired = true; }, 50);
  try {
    expect(await Promise.all([resolveCursorAgentBin(), resolveCursorAgentBin()])).toEqual([binary, binary]);
    expect(timerFired).toBe(true);
    expect(await isCursorAgentInstalled()).toBe(true);
    expect(fs.readFileSync(calls, "utf8")).toBe("x");
  } finally {
    clearTimeout(timer);
  }
}, 15_000);
