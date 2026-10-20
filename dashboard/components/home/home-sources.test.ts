import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ active: "work", calendar: vi.fn(), tickets: vi.fn(), cleanup: vi.fn(), owned: vi.fn() }));
vi.mock("@shared/vault/task-profiles.ts", () => ({ resolveActiveProfileId: () => state.active }));
vi.mock("@/lib/notes/dir", () => ({ getTasksDir: () => "/tmp/home-test-tasks" }));
vi.mock("@/lib/calendar-cache", () => ({ getTodayCalendarCache: () => null, setTodayCalendarCache: vi.fn(), CALENDAR_TODAY_TTL_MS: 1000 }));
vi.mock("@/lib/google-calendar", () => ({ getTodayEvents: state.calendar, isGoogleCalendarAuthError: () => false }));
vi.mock("@/lib/integrations/screen-data", () => ({ jiraScreen: { tickets: state.tickets } }));
vi.mock("@/lib/jira/env", () => ({ getResolvedJiraEnv: () => ({}) }));
vi.mock("@/lib/jira/tickets-cache", () => ({ getJiraTicketsCache: () => null, setJiraTicketsCache: vi.fn(), JIRA_TICKETS_TTL_MS: 1000 }));
vi.mock("@/lib/repos/worktree-cleanup", () => ({ listWorktreeCleanup: state.cleanup, removeWorktreeAt: vi.fn(), removeWorktrees: vi.fn(), worktreeRemovalBlocker: vi.fn() }));
vi.mock("@/lib/paseo/workspaces", () => ({ sweepPaseoWorkspacesQuietly: vi.fn() }));
vi.mock("@/lib/scanned-repo", () => ({ resolveScannedRepo: vi.fn() }));
vi.mock("@/lib/ownership/owned-repos", () => ({ resolveOwnedRepos: state.owned }));
vi.mock("@/lib/ownership/service", () => ({ loadPrRadar: vi.fn() }));
import { GET as calendar } from "@/app/api/calendar/route";
import { GET as tickets } from "@/app/api/jira/tickets/route";
import { GET as cleanup } from "@/app/api/repos/worktree-cleanup/route";
import { GET as owned } from "@/app/api/github/prs/owned/route";
beforeEach(() => {
  vi.clearAllMocks(); state.active = "work";
  state.calendar.mockResolvedValue([]); state.tickets.mockResolvedValue([]);
  state.cleanup.mockResolvedValue({ rows: [], failedRepos: [], kept: 0 }); state.owned.mockResolvedValue([]);
});
describe("Home source profile guards", () => {
  it.each([["calendar", calendar, state.calendar], ["tickets", tickets, state.tickets], ["worktrees", cleanup, state.cleanup], ["owned", owned, state.owned]] as const)("rejects stale-profile %s reads before calling the source", async (_, get, source) => {
    const response = await get(new Request("http://localhost/api/source?taskProfile=home"));
    expect(response.status).toBe(409);
    expect(source).not.toHaveBeenCalled();
  });
  it("rejects an in-flight calendar read after the active profile changes", async () => {
    state.calendar.mockImplementation(async () => { state.active = "home"; return []; });
    expect((await calendar(new Request("http://localhost/api/calendar?taskProfile=work"))).status).toBe(409);
  });
  it("preserves unscoped caller response shapes", async () => {
    expect(await (await calendar()).json()).toEqual({ events: [], cached: false });
    expect(await (await tickets()).json()).toEqual({ tickets: [], cached: false, configured: true });
    expect(await (await cleanup()).json()).toEqual({ rows: [], kept: 0, failedRepos: [] });
  });
});
