import { beforeEach, describe, expect, it, vi } from "vitest";
import { profileHeaders, profileKey } from "../../../../../packages/shared/tasks/profile-scope";

const state = vi.hoisted(() => ({ active: "work" as string | null }));
vi.mock("../../../../../packages/shared/vault/task-profiles.ts", () => ({ resolveActiveProfileId: () => state.active }));
vi.mock("../../lib/notes/dir", () => ({ getTasksDir: () => "/tmp/tasks", getActiveTasksDir: () => "/tmp/tasks/work" }));
import { withErrorHandler } from "../../lib/api-utils";
import { activeTaskProfile } from "./profile-request";
import { scopedTaskDirectory } from "./profile-context";
import { getSidebarCountsCache, setSidebarCountsCache } from "../../lib/activity/sidebar-counts-cache";

beforeEach(() => { state.active = "work"; });

describe("profile-bound reads and actions", () => {
  it("names each SWR identity by profile without losing existing URL parameters", () => {
    expect(profileKey("/api/storyboard?done=all", "work")).toBe("/api/storyboard?done=all&taskProfile=work");
    expect(profileKey("/api/storyboard", "home")).not.toBe(profileKey("/api/storyboard", "work"));
    expect(profileKey("/api/storyboard", undefined)).toBeNull();
    expect(profileHeaders("work")).toEqual({ "X-Devhub-Task-Profile": "work" });
    state.active = null;
    expect(activeTaskProfile()).toBe("legacy");
  });

  it("keeps unscoped existing callers unchanged", async () => {
    const handler = vi.fn(async () => Response.json({ tasks: ["existing"] }));
    const response = await withErrorHandler<[Request]>(handler)(new Request("http://localhost/api/tasks"));
    expect(await response.json()).toEqual({ tasks: ["existing"] });
  });

  it.each(["GET", "POST", "PATCH"])("refuses a stale %s identity before reading or mutating another profile", async (method) => {
    const handler = vi.fn(async () => Response.json({ taskId: "same-id" }));
    const guarded = withErrorHandler<[Request]>(handler);
    const response = await guarded(new Request("http://localhost/api/tasks", { method, headers: profileHeaders("home") }));
    expect(response.status).toBe(409);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects in-flight reads if the profile changes before they settle", async () => {
    const guarded = withErrorHandler<[Request]>(async () => { state.active = "home"; return Response.json({ private: "work" }); });
    const response = await guarded(new Request("http://localhost/api/storyboard?taskProfile=work"));
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("private");
  });

  it("pins a mutation's destination across async profile switches without changing unscoped callers", async () => {
    setSidebarCountsCache({ tasks: 1, tickets: 0, prs: 0, shared: 0, needsYou: 1, signatures: { tickets: "", prs: "" } }, "work");
    const guarded = withErrorHandler<[Request]>(async () => {
      await Promise.resolve();
      state.active = "home";
      await Promise.resolve();
      return Response.json({ destination: scopedTaskDirectory("/tmp/tasks") });
    });
    const response = await guarded(new Request("http://localhost/api/tasks", { method: "PATCH", headers: profileHeaders("work") }));
    expect(await response.json()).toEqual({ destination: "/tmp/tasks/work" });
    expect(scopedTaskDirectory("/tmp/tasks")).toBeUndefined();
    expect(getSidebarCountsCache("work")).toMatchObject({ ts: 0, data: { needsYou: 1 } });
  });

  it("refuses profile-scoped agent attention before reading or reconciling global runs", async () => {
    const runs = [
      { spec: { id: "work", title: "Work", activity: { taskId: "work-task" } }, status: { state: "needs-attention" } },
      { spec: { id: "home", title: "Home", activity: { taskId: "home-task" } }, status: { state: "needs-attention" } },
      { spec: { id: "unlinked", title: "Private context", activity: undefined }, status: { state: "needs-attention" } },
      { spec: { id: "new-wait", title: "New wait", activity: { taskId: "work-task" } }, status: { state: "running" } },
      { spec: { id: "old-wait", title: "Older task", activity: { taskId: "old-task" } }, status: { state: "needs-attention" } },
      { spec: { id: "disconnected", title: "Disconnected", activity: { taskId: "work-task" } }, status: { state: "running" } },
    ];
    const reconcile = vi.fn(async (run: typeof runs[number]) => run);
    const listRuns = vi.fn(() => runs);
    const waitingSummary = vi.fn(() => ({ waiting: 0, incomplete: false }));
    vi.doMock("../../lib/agent-runs/store", () => ({ listAgentRuns: listRuns, readAgentWaitingSummary: waitingSummary, toAgentRunSummary: (run: typeof runs[number]) => ({ id: run.spec.id, title: run.spec.title, activity: run.spec.activity, state: run.status.state, conversationId: null, cwd: "private path" }), isCapacityRun: () => false }));
    vi.doMock("./storage", () => ({ getTasks: () => [{ id: "work-task" }], ensureTasksMigrated: async () => undefined }));
    vi.doMock("../../lib/paseo/lifecycle", () => ({ reconcileManagedRun: reconcile }));
    vi.doMock("../../lib/paseo/providers", () => ({ listPaseoProviders: async () => [] }));
    vi.doMock("../../lib/agent-runs/dispatch", () => ({ AgentDispatchError: class extends Error {}, dispatchAgentRun: vi.fn() }));
    vi.doMock("../../lib/conventions/fresh", () => ({ ensureConventionsFresh: vi.fn() }));
    vi.stubEnv("DEVHUB_API_SECRET", "test-secret");
    try {

      const { GET } = await import("../../http/routes/agent/runs/route");
      const request = (query: string) => new Request(`http://localhost/api/agent/runs?scope=attention${query}`, { headers: { "x-devhub-secret": "test-secret" } });
      for (const suffix of ["", "&summary=1", "&summary=waiting"]) {
        const scoped = await GET(request("&taskProfile=work" + suffix));
        expect(scoped.status).toBe(503);
        expect(scoped.headers.get("cache-control")).toBe("no-store");
      }
      expect(listRuns).not.toHaveBeenCalled();
      expect(waitingSummary).not.toHaveBeenCalled();
      expect(reconcile).not.toHaveBeenCalled();
      const unscoped = await GET(request(""));
      expect((await unscoped.json()).runs.map((run: { id: string }) => run.id)).toEqual(["work", "home", "unlinked", "old-wait"]);
      state.active = "home";
      expect((await GET(request("&taskProfile=work"))).status).toBe(409);
    } finally {
      vi.unstubAllEnvs();
      for (const name of ["../../lib/agent-runs/store", "./storage", "../../lib/paseo/lifecycle", "../../lib/paseo/providers", "../../lib/agent-runs/dispatch", "../../lib/conventions/fresh"]) vi.doUnmock(name);
    }
  });

});
