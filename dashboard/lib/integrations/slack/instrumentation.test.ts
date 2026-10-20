import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "../../../instrumentation";
import { startSlackBot } from "./runtime";
import { writeDashboardRuntime } from "@/lib/dashboard-runtime";

vi.mock("./runtime", () => ({ startSlackBot: vi.fn() }));
vi.mock("@/lib/tasks/storage", () => ({ ensureTasksMigrated: vi.fn(async () => {}) }));
vi.mock("@/lib/dashboard-runtime", () => ({ writeDashboardRuntime: vi.fn() }));
vi.mock("@/lib/paseo/lifecycle", () => ({ startAgentReconciliation: vi.fn() }));
vi.mock("@/lib/paseo/agent-cli-updates", () => ({ startAgentCliUpdates: vi.fn() }));
vi.mock("@/lib/paseo/pending-restart", () => ({ startPendingPaseoRestart: vi.fn() }));
vi.mock("@/lib/scheduler", () => ({ startScheduler: vi.fn() }));
vi.mock("@/lib/tasks/task-pr-watch", () => ({ startTaskPrWatcher: vi.fn() }));
vi.mock("@/lib/integrations/alert-worker", () => ({ startAlertWorker: vi.fn() }));
vi.mock("@/lib/github/auto-pr-review-poller", () => ({ startAutoPrReviewPoller: vi.fn() }));
vi.mock("@/lib/storyboard/auto-ticker", () => ({ startStoryboardAutoTicker: vi.fn() }));
vi.mock("@/lib/share/share-expiry", () => ({ startShareExpiry: vi.fn() }));
vi.mock("@/lib/scheduler-log", () => ({ appendSchedulerLog: vi.fn() }));
vi.mock("@/lib/mcp-http-peer", () => ({ startMcpHttpPeer: vi.fn(async () => {}) }));

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-instrumentation-"));
  vi.clearAllMocks();
  vi.stubEnv("DEVHUB_ENV_FILE", path.join(root, ".env.local"));
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("DEVHUB_SCHEDULER", "1");
  for (const key of ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_CHANNEL_ID", "SLACK_ALLOWED_USER_ID", "SLACK_TEAM_ID"]) vi.stubEnv(key, "");
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
function configured() {
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test"); vi.stubEnv("SLACK_APP_TOKEN", "xapp-test");
  vi.stubEnv("SLACK_CHANNEL_ID", "CCHANNEL"); vi.stubEnv("SLACK_ALLOWED_USER_ID", "UOWNER");
}

describe("Slack instrumentation ownership", () => {
  it("does not start Slack or advertise a secondary dashboard", async () => {
    configured(); vi.stubEnv("DEVHUB_SCHEDULER", "0");
    await register();
    expect(startSlackBot).not.toHaveBeenCalled();
    expect(writeDashboardRuntime).not.toHaveBeenCalled();
  });
  it("does not start Slack without tokens", async () => {
    await register();
    expect(startSlackBot).not.toHaveBeenCalled();
  });
  it("starts Slack only in the configured primary Node process", async () => {
    configured(); await register();
    expect(startSlackBot).toHaveBeenCalledTimes(1);
  });
  it("never starts Slack in the edge runtime", async () => {
    configured(); vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(startSlackBot).not.toHaveBeenCalled();
  });
});
