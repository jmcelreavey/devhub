import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { pidsListeningOnPort } from "./port-probe";

const directories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")("keeps the dashboard responsive while identifying port listeners", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-port-probe-"));
  directories.push(directory);
  const ready = path.join(directory, "ready");
  fs.writeFileSync(path.join(directory, "lsof"), [
    "#!/bin/sh",
    "attempt=0",
    'while [ ! -f "$PORT_PROBE_TEST_READY" ] && [ "$attempt" -lt 100 ]; do',
    "  sleep 0.01",
    "  attempt=$((attempt + 1))",
    "done",
    '[ -f "$PORT_PROBE_TEST_READY" ] || exit 1',
    'printf "412\\n"',
    "",
  ].join("\n"), { mode: 0o700 });
  vi.stubEnv("PATH", `${directory}:${process.env.PATH ?? ""}`);
  vi.stubEnv("PORT_PROBE_TEST_READY", ready);
  const timer = setTimeout(() => fs.writeFileSync(ready, "ready"), 30);
  try {
    expect(await pidsListeningOnPort(31876)).toEqual([412]);
  } finally {
    clearTimeout(timer);
  }
});

it.skipIf(process.platform === "win32")("does not use partial listener results from a failed probe", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-port-probe-"));
  directories.push(directory);
  fs.writeFileSync(path.join(directory, "lsof"), "#!/bin/sh\nprintf '412\\n'\nexit 1\n", { mode: 0o700 });
  vi.stubEnv("PATH", `${directory}:${process.env.PATH ?? ""}`);
  expect(await pidsListeningOnPort(31876)).toEqual([]);
});
