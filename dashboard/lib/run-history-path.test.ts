import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppDataDir } from "@/lib/desktop/runtime-paths";
import { runHistoryFile } from "@/lib/run-history-path";
import { listRecentRuns } from "@/lib/run-history";
import { writeAuditLog } from "@/lib/scripts-runner";
import { GET } from "@/app/api/scripts/history/route";

describe("profile run history", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-runs-"));
    for (const key of ["DEVHUB_PROFILE", "DEVHUB_DESKTOP", "DEVHUB_APP_DATA", "XDG_STATE_HOME", "XDG_DATA_HOME"]) {
      vi.stubEnv(key, "");
    }
    vi.stubEnv("HOME", home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("keeps the default and default desktop profile on the legacy file", () => {
    const legacy = path.join(home, ".local/state/devhub/runs.jsonl");
    expect(runHistoryFile()).toBe(legacy);
    vi.stubEnv("DEVHUB_DESKTOP", "1");
    vi.stubEnv("DEVHUB_APP_DATA", defaultAppDataDir(home));
    expect(runHistoryFile()).toBe(legacy);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify({ runId: "old-scratch", script: "sync", startedAt: 1 }) + "\n");
    expect(listRecentRuns().map((run) => run.runId)).toEqual(["old-scratch"]);
  });

  it("ignores the task profile and XDG state so live history stays visible", () => {
    const legacy = path.join(home, ".local/state/devhub/runs.jsonl");
    expect(runHistoryFile({ HOME: home, DEVHUB_PROFILE: "work" })).toBe(legacy);
    expect(runHistoryFile({ HOME: home, XDG_STATE_HOME: path.join(home, "state") })).toBe(legacy);
  });

  it("keeps a scratch desktop's history under its own app data", () => {
    const env = { HOME: home, DEVHUB_DESKTOP: "1", DEVHUB_APP_DATA: path.join(home, "scratch-app") };
    expect(runHistoryFile(env)).toBe(path.join(env.DEVHUB_APP_DATA, "logs/runs.jsonl"));
    expect(runHistoryFile({ ...env, DEVHUB_DESKTOP: "0" })).toBe(runHistoryFile({ HOME: home }));
  });

  it("both readers isolate a scratch desktop profile without changing live history", async () => {
    writeAuditLog({ runId: "live", script: "sync_skills", startedAt: 1, exitCode: 0 });
    const legacy = runHistoryFile();
    const saved = fs.readFileSync(legacy, "utf8");
    vi.stubEnv("DEVHUB_DESKTOP", "1");
    vi.stubEnv("DEVHUB_APP_DATA", path.join(home, "scratch-app"));
    expect(listRecentRuns()).toEqual([]);
    writeAuditLog({ runId: "scratch", script: "sync_agents", startedAt: 2, exitCode: 1 });
    expect(listRecentRuns().map((run) => run.runId)).toEqual(["scratch"]);
    expect((await (await GET()).json()).map((run: { runId: string }) => run.runId)).toEqual(["scratch"]);
    vi.stubEnv("DEVHUB_DESKTOP", "");
    vi.stubEnv("DEVHUB_APP_DATA", "");
    expect(listRecentRuns().map((run) => run.runId)).toEqual(["live"]);
    expect((await (await GET()).json()).map((run: { runId: string }) => run.runId)).toEqual(["live"]);
    expect(fs.readFileSync(legacy, "utf8")).toBe(saved);
  });
});
