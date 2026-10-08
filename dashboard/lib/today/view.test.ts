/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTodayView, syncTodayView, writeTodayView } from "./view";

let server: { view: string | null };
let fetchMock: ReturnType<typeof vi.fn>;
const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => JSON.parse(String(init.body)));

beforeEach(() => {
  localStorage.clear();
  server = { view: null };
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") { server = JSON.parse(String(init.body)); return { ok: true, json: async () => server } as Response; }
    return { ok: true, json: async () => server } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Today view across origins", () => {
  it("uses the machine's saved choice on an origin that has never chosen", async () => {
    server.view = "focus";
    await syncTodayView();
    expect(readTodayView()).toBe("focus");
    expect(puts()).toEqual([]);
  });
  it("lets the machine's choice replace a stale one from another port", async () => {
    server.view = "focus";
    localStorage.setItem("devhub:today-view", "dashboard");
    await syncTodayView();
    expect(readTodayView()).toBe("focus");
  });
  it("uploads an existing local choice once when the server has none", async () => {
    localStorage.setItem("devhub:today-view", "focus");
    await syncTodayView();
    expect(puts()).toEqual([{ view: "focus" }]);
    await syncTodayView();
    expect(puts()).toHaveLength(1);
  });
  it("uploads nothing when there is no local choice and no saved one", async () => {
    await syncTodayView();
    expect(puts()).toEqual([]);
    expect(readTodayView()).toBe("dashboard");
  });
  it("saves a choice to the server and the local cache", () => {
    writeTodayView("focus");
    expect(readTodayView()).toBe("focus");
    expect(puts()).toEqual([{ view: "focus" }]);
  });
  it("keeps the local choice when the server is unreachable", async () => {
    localStorage.setItem("devhub:today-view", "focus");
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(syncTodayView()).resolves.toBeUndefined();
    expect(readTodayView()).toBe("focus");
    writeTodayView("dashboard");
    expect(readTodayView()).toBe("dashboard");
  });
});
