import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppDataDir } from "@/lib/desktop/runtime-paths";
import { runHistoryFile } from "@/lib/run-history-path";
import { listRecentRuns } from "@/lib/run-history";
import { getRunLogPayload, persistRunLogToDisk, writeAuditLog } from "@/lib/scripts-runner";
import { profileConfigDir, runLogsDir, stateProfileId } from "@/lib/profile-state";
import { GET } from "@/app/api/scripts/history/route";

describe("profile run history", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-runs-"));
    for (const key of ["DEVHUB_PROFILE", "DEVHUB_DESKTOP", "DEVHUB_APP_DATA", "DEVHUB_STATE_PROFILE", "XDG_STATE_HOME", "XDG_DATA_HOME"]) {
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

// Windows: the shell runs the dashboard inside WSL, where EVERY profile's app data is the
// default ~/.local/share/devhub. Only DEVHUB_STATE_PROFILE tells a scratch profile apart.
describe("Windows/WSL scratch profile (DEVHUB_STATE_PROFILE on the default app data)", () => {
  const ID = "0123456789abcdef";
  let home: string;
  const live = () => path.join(home, ".local/state/devhub");
  const scoped = () => path.join(live(), "profiles", ID);
  const asWslProfile = (id: string | undefined = ID) => {
    vi.stubEnv("DEVHUB_DESKTOP", "1");
    // ~/.local/share/devhub inside WSL (Linux). defaultAppDataDir keeps this the *default*
    // app data on whichever OS runs the test, which is the point: r6 saw nothing odd here.
    vi.stubEnv("DEVHUB_APP_DATA", defaultAppDataDir(home));
    vi.stubEnv("DEVHUB_STATE_PROFILE", id ?? "");
  };
  const ids = async () => (await (await GET()).json()).map((run: { runId: string }) => run.runId);

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-wsl-runs-"));
    for (const key of ["DEVHUB_PROFILE", "DEVHUB_DESKTOP", "DEVHUB_APP_DATA", "DEVHUB_STATE_PROFILE", "XDG_STATE_HOME", "XDG_DATA_HOME"]) {
      vi.stubEnv(key, "");
    }
    vi.stubEnv("HOME", home);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("sends history, both readers and run logs to the profile dir and leaves the live bytes alone", async () => {
    writeAuditLog({ runId: "live", script: "sync_skills", startedAt: 1, exitCode: 0 });
    persistRunLogToDisk({ runId: "live", script: "sync_skills", startedAt: 1, exitCode: 0, lines: ["live line"] });
    const liveFiles = [path.join(live(), "runs.jsonl"), path.join(live(), "run-logs", "live.json")];
    const saved = liveFiles.map((file) => fs.readFileSync(file, "utf8"));

    asWslProfile();
    expect(runHistoryFile()).toBe(path.join(scoped(), "runs.jsonl"));
    expect(runLogsDir()).toBe(path.join(scoped(), "run-logs"));
    // The scratch profile starts empty: it does not show the live Recent runs.
    expect(listRecentRuns()).toEqual([]);
    expect(await ids()).toEqual([]);
    expect(getRunLogPayload("live")).toBeNull();

    writeAuditLog({ runId: "scratch", script: "dry_run_scoped_sync", startedAt: 2, exitCode: 1 });
    persistRunLogToDisk({ runId: "scratch", script: "dry_run_scoped_sync", startedAt: 2, exitCode: 1, lines: ["No linked git checkout"] });
    expect(listRecentRuns().map((run) => run.runId)).toEqual(["scratch"]);
    expect(await ids()).toEqual(["scratch"]);
    expect(getRunLogPayload("scratch")?.lines).toEqual(["No linked git checkout"]);
    expect(fs.existsSync(path.join(scoped(), "run-logs", "scratch.json"))).toBe(true);

    expect(liveFiles.map((file) => fs.readFileSync(file, "utf8"))).toEqual(saved);
    expect(fs.existsSync(path.join(live(), "run-logs", "scratch.json"))).toBe(false);

    vi.stubEnv("DEVHUB_STATE_PROFILE", "");
    expect(listRecentRuns().map((run) => run.runId)).toEqual(["live"]);
    expect(await ids()).toEqual(["live"]);
    expect(getRunLogPayload("live")?.lines).toEqual(["live line"]);
    expect(getRunLogPayload("scratch")).toBeNull();
  });

  it.each(["", "short", "ABCDEF0123456789", "../../etc/passwd0123456789", `${"a".repeat(65)}`, "0123456789abcdeg", " 0123456789abcdef/x"])(
    "ignores the invalid id %j and keeps the live paths",
    async (bad) => {
      asWslProfile(bad);
      expect(stateProfileId()).toBeNull();
      writeAuditLog({ runId: "r", script: "sync_skills", startedAt: 1, exitCode: 0 });
      persistRunLogToDisk({ runId: "r", script: "sync_skills", startedAt: 1, exitCode: 0, lines: ["x"] });
      expect(runHistoryFile()).toBe(path.join(live(), "runs.jsonl"));
      expect(fs.existsSync(path.join(live(), "run-logs", "r.json"))).toBe(true);
      expect(fs.existsSync(path.join(live(), "profiles"))).toBe(false);
      expect(await ids()).toEqual(["r"]);
    },
  );

  it("accepts 16 to 64 lowercase hex characters", () => {
    for (const id of ["a".repeat(16), "0123456789abcdef".repeat(4)]) {
      expect(stateProfileId({ DEVHUB_DESKTOP: "1", DEVHUB_STATE_PROFILE: id })).toBe(id);
    }
  });

  it("is a desktop-shell setting: a stray variable in a dev shell moves nothing", () => {
    vi.stubEnv("DEVHUB_STATE_PROFILE", ID);
    expect(runHistoryFile()).toBe(path.join(live(), "runs.jsonl"));
    expect(runLogsDir()).toBe(path.join(live(), "run-logs"));
  });

  it("does not let the task profile or XDG_STATE_HOME move the scoped paths either", () => {
    asWslProfile();
    vi.stubEnv("DEVHUB_PROFILE", "work");
    vi.stubEnv("XDG_STATE_HOME", path.join(home, "state"));
    expect(runHistoryFile()).toBe(path.join(scoped(), "runs.jsonl"));
    expect(runLogsDir()).toBe(path.join(scoped(), "run-logs"));
  });

  it("takes precedence over a non-default app data, whose r6 behaviour stays without the id", () => {
    vi.stubEnv("DEVHUB_DESKTOP", "1");
    vi.stubEnv("DEVHUB_APP_DATA", path.join(home, "scratch-app"));
    expect(runHistoryFile()).toBe(path.join(home, "scratch-app", "logs/runs.jsonl"));
    expect(runLogsDir()).toBe(path.join(live(), "run-logs"));
    vi.stubEnv("DEVHUB_STATE_PROFILE", ID);
    expect(runHistoryFile()).toBe(path.join(scoped(), "runs.jsonl"));
  });

  it("scopes the config dir the same way", () => {
    expect(profileConfigDir()).toBe(path.join(home, ".config/devhub"));
    asWslProfile();
    expect(profileConfigDir()).toBe(path.join(home, ".config/devhub/profiles", ID));
  });
});

