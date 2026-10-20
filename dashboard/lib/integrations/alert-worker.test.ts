import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/tasks/profiles", () => ({ getTaskProfileOverview: () => ({ active: "work" }) }));
vi.mock("@/lib/tasks/task-index", () => ({ loadTaskIndex: () => ({}), currentTaskNode: () => ({ task: { id: "t1" } }) }));
vi.mock("@/lib/workflows/store", () => ({ listWorkflows: () => [{ taskId: "t1", events: [{ id: "legacy", at: "2026-10-20T12:00:00Z", summary: "review run: completed" }], reviews: [] }] }));
vi.mock("@/lib/agent-runs/store", () => ({ readAgentRun: vi.fn() }));
vi.mock("@/lib/github/auto-pr-review-state", () => ({ listAutoPrReviewRecords: () => [] }));
vi.mock("@/lib/github/prs", () => ({ readGithubPrsListCache: vi.fn() }));
vi.mock("@/lib/github/prs-list", () => ({ loadGithubPrsList: vi.fn() }));
vi.mock("@/lib/storyboard/notes-board", () => ({ readNotesBoard: () => ({ cards: [], errors: [] }) }));
vi.mock("./pr-alert-events", () => ({ prAlertEvents: vi.fn() }));
vi.mock("./alert-store", async (original) => {
  const actual = await original<typeof import("./alert-store")>();
  return { ...actual, readAlerts: vi.fn(), processAlerts: vi.fn() };
});
import { readAlerts, processAlerts } from "./alert-store";
import { readGithubPrsListCache } from "@/lib/github/prs";
import { loadGithubPrsList } from "@/lib/github/prs-list";
import { prAlertEvents } from "./pr-alert-events";
import { runAlertTick } from "./alert-worker";

const cache = { configured: true, authored: [], reviews: [], recentlyReviewed: [] };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readAlerts).mockReturnValue({ version: 1, nextSendAt: 0, outbox: [], destinations: [{ enabled: true, workProfile: "work", events: ["pr-reviewed"] }] as ReturnType<typeof readAlerts>["destinations"] });
  vi.mocked(readGithubPrsListCache).mockReturnValue(null);
  vi.mocked(loadGithubPrsList).mockResolvedValue(cache);
  vi.mocked(prAlertEvents).mockReturnValue([{ id: "pr-review-run", kind: "pr-reviewed", taskId: "", at: "2026-10-20T12:00:00Z" }]);
});

describe("announcement worker wiring", () => {
  it("refreshes metadata without a page visit and queues announcements alongside legacy review-ready", async () => {
    await runAlertTick();
    expect(loadGithubPrsList).toHaveBeenCalledOnce();
    expect(prAlertEvents).toHaveBeenCalledWith(expect.objectContaining({ profile: "work", cards: [], prs: [] }));
    expect(processAlerts).toHaveBeenCalledWith([
      expect.objectContaining({ id: "legacy", kind: "review-ready" }),
      expect.objectContaining({ id: "pr-review-run", kind: "pr-reviewed" }),
    ], "work", { deferPrAlerts: false });
    vi.mocked(readGithubPrsListCache).mockReturnValue(cache);
    await runAlertTick();
    expect(loadGithubPrsList).toHaveBeenCalledOnce();
  });
  it("does not fetch PR data for existing destinations without the new event opt-in", async () => {
    vi.mocked(readAlerts).mockReturnValue({ version: 1, nextSendAt: 0, outbox: [], destinations: [{ enabled: true, workProfile: "work", events: ["review-ready"] }] as ReturnType<typeof readAlerts>["destinations"] });
    await runAlertTick();
    expect(loadGithubPrsList).not.toHaveBeenCalled();
    expect(prAlertEvents).not.toHaveBeenCalled();
    expect(processAlerts).toHaveBeenCalledWith([expect.objectContaining({ kind: "review-ready" })], "work", { deferPrAlerts: false });
  });
  it("defers unavailable PR sources without blocking ordinary alerts or leaking errors", async () => {
    vi.mocked(loadGithubPrsList).mockRejectedValueOnce(new Error("private token"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(runAlertTick()).resolves.toBeUndefined();
      expect(processAlerts).toHaveBeenCalledWith([expect.objectContaining({ kind: "review-ready" })], "work", { deferPrAlerts: true });
      expect(JSON.stringify(log.mock.calls)).not.toContain("private token");
    } finally { log.mockRestore(); }
  });
});
