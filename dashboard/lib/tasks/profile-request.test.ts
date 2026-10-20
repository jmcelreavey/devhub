import { beforeEach, describe, expect, it, vi } from "vitest";
import { profileHeaders, profileKey } from "./profile-scope";

const state = vi.hoisted(() => ({ active: "work" as string | null }));
vi.mock("@shared/vault/task-profiles.ts", () => ({ resolveActiveProfileId: () => state.active }));
vi.mock("@/lib/notes/dir", () => ({ getTasksDir: () => "/tmp/tasks" }));
import { withErrorHandler } from "@/lib/api-utils";
import { activeTaskProfile } from "./profile-request";
import { scopedTaskDirectory } from "./profile-context";
import { getSidebarCountsCache, setSidebarCountsCache } from "@/lib/sidebar-counts-cache";

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
});
