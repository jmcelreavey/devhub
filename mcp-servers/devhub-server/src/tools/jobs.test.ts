import { describe, expect, it } from "vitest";
import {
  buildJobConsentRequest,
  formatJob,
  formatSchedulerLog,
  formatWake,
  PREFER_JOBS,
  type JobSummary,
} from "./jobs.ts";
import { SERVER_INSTRUCTIONS } from "../server.ts";

const base: JobSummary = {
  id: "j1",
  name: "Morning triage",
  cron: "0 7 * * 1-5",
  enabled: true,
  kind: "agent",
  agent: { provider: "claude", cwd: "~/Developer/app", prompt: "Triage new issues\nand label them" },
  wake: true,
  approval: "pending",
  nextRunAt: null,
  scheduleValid: true,
};

describe("formatJob", () => {
  it("flags jobs waiting for approval so the model tells the user", () => {
    const text = formatJob(base);
    expect(text).toContain("WAITING FOR APPROVAL");
    expect(text).toContain("agent claude in ~/Developer/app");
    expect(text).toContain("wakes Mac");
    expect(text).not.toContain("Triage new issues");
  });

  it("includes the prompt only in full mode", () => {
    expect(formatJob(base, true)).toContain("    Triage new issues\n    and label them");
  });

  it("shows script jobs and last errors", () => {
    const text = formatJob({ ...base, kind: "script", agent: undefined, script: "validate", approval: undefined, lastError: "boom" });
    expect(text).toContain("script validate");
    expect(text).toContain("last error: boom");
  });
});

describe("formatWake", () => {
  it("tells the model when the helper is missing", () => {
    expect(formatWake({ helper: "unavailable", scheduledAt: null })).toContain("NOT installed");
    expect(formatWake({ helper: "ready", version: "1.0.0", scheduledAt: null })).toContain("no wake scheduled");
    expect(formatWake(undefined)).toContain("not supported");
  });
});

describe("formatSchedulerLog", () => {
  it("shows scheduler lines and the helper log, with clear empty states", () => {
    const text = formatSchedulerLog({
      file: "/home/.local/state/devhub/scheduler.log",
      lines: ["2026-09-14T18:19:09Z INFO  [scheduler] running \"Wake test\" (8664b37a)"],
      helper: { file: "/var/log/com.devhub.wake-helper.log", lines: [] },
    });
    expect(text).toContain("Scheduler log (/home/.local/state/devhub/scheduler.log):");
    expect(text).toContain('running "Wake test"');
    expect(text).toContain("is the wake helper installed?");
    expect(formatSchedulerLog({ file: "f", lines: [], helper: null })).toBe("Scheduler log (f):\n(no entries yet)");
  });
});

describe("buildJobConsentRequest", () => {
  it("spells out that the agent runs with approvals off and requires a boolean", () => {
    const req = buildJobConsentRequest({ name: base.name, cron: base.cron, agent: base.agent! });
    expect(req.message).toContain("approvals OFF");
    expect(req.message).toContain("~/Developer/app");
    expect(req.requestedSchema.required).toEqual(["confirm"]);
  });

  it("clips long prompts", () => {
    const req = buildJobConsentRequest({ name: "x", cron: "* * * * *", agent: { ...base.agent!, prompt: "p".repeat(2_000) } });
    expect(req.message.length).toBeLessThan(700);
  });
});

describe("scheduling preference", () => {
  it("steers harnesses away from their own cron tools", () => {
    expect(PREFER_JOBS).toMatch(/CronCreate/);
    expect(SERVER_INSTRUCTIONS).toMatch(/jobs_create/);
  });
});
