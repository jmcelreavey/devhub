import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")("keeps the dashboard responsive while resolving Cursor", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-cursor-"));
  temporaryDirectories.push(directory);
  const shell = path.join(directory, "shell");
  const cursor = path.join(directory, "cursor");
  const ready = path.join(directory, "ready");
  fs.writeFileSync(cursor, "", { mode: 0o700 });
  fs.writeFileSync(shell, [
    "#!/bin/sh",
    "attempt=0",
    'while [ ! -f "$CURSOR_TEST_READY" ] && [ "$attempt" -lt 100 ]; do',
    "  sleep 0.01",
    "  attempt=$((attempt + 1))",
    "done",
    '[ -f "$CURSOR_TEST_READY" ] || exit 1',
    'printf "%s\\n" "$CURSOR_TEST_BIN"',
    "",
  ].join("\n"), { mode: 0o700 });
  vi.stubEnv("SHELL", shell);
  vi.stubEnv("CURSOR_TEST_READY", ready);
  vi.stubEnv("CURSOR_TEST_BIN", cursor);
  vi.resetModules();
  const { resolveCursorBin } = await import("./cursor-open");
  const timer = setTimeout(() => fs.writeFileSync(ready, "ready"), 30);
  try {
    expect(await resolveCursorBin()).toBe(cursor);
  } finally {
    clearTimeout(timer);
  }
});
