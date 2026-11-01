import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reapOrphanOpenCodeServers } from "./listen";

const temporaryRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-opencode-scan-"));
  temporaryRoots.push(root);
  return root;
}

describe("OpenCode orphan cleanup", () => {
  it.skipIf(process.platform === "win32")("only selects matching orphan processes and protects reserved ports", async () => {
    const root = temporaryRoot();
    const processLines = [
      "91001 1 /usr/bin/opencode serve --port 41234 --hostname 127.0.0.1",
      `91002 ${process.pid} /usr/bin/opencode serve --port 41235 --hostname 127.0.0.1`,
      "91003 1 /usr/bin/opencode serve --port 1338 --hostname 127.0.0.1",
      "91004 1 /usr/bin/opencode serve --port 41236 --hostname 127.0.0.1",
      `91005 ${process.pid + 1} /usr/bin/opencode serve --port 41237 --hostname 127.0.0.1`,
      "91006 1 /usr/bin/other-opencode serve --port 41238 --hostname 127.0.0.1",
      "91007 1 /usr/bin/opencode serve --port 4096 --hostname 127.0.0.1",
    ];
    const argumentsText = processLines.map((line) => `'${line}'`).join(" ");
    fs.writeFileSync(path.join(root, "ps"), `#!/bin/sh\nprintf '%s\\n' ${argumentsText}\n`, { mode: 0o755 });
    vi.stubEnv("PATH", root);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);

    expect(await reapOrphanOpenCodeServers(undefined, 41236)).toEqual([91001, 91002]);
    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenCalledWith(91001, "SIGKILL");
    expect(kill).toHaveBeenCalledWith(91002, "SIGKILL");
  });

  it.skipIf(process.platform === "win32")("does not kill anything when the process scan fails", async () => {
    vi.stubEnv("PATH", temporaryRoot());
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);

    expect(await reapOrphanOpenCodeServers()).toEqual([]);
    expect(kill).not.toHaveBeenCalled();
  });
});
