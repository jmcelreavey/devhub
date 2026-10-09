import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStatusRows } from "./status-data";

const healthy: Record<string, unknown> = {
  "/api/status/services": { agents: { active: true, uptime: null } },
  "/api/status/git": { branch: "main", dirtyCount: 0, ahead: 0, behind: 0 },
  "/api/status/mcp": { servers: [] },
  "/api/status/lan": { addresses: ["192.168.1.2", null, 42, ""] },
};

afterEach(() => vi.unstubAllGlobals());

describe("status checks", () => {
  it("keeps successful checks when another endpoint fails, and reports the failure as unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
      JSON.stringify(url.endsWith("/git") ? { error: "Unavailable" } : healthy[url]),
      { status: url.endsWith("/git") ? 503 : 200 },
    )));
    const snapshot = await fetchStatusRows();
    expect(snapshot.git).toBeNull();
    expect(snapshot.services?.agents.active).toBe(true);
    expect(snapshot.mcp).toEqual([]);
    expect(snapshot.lan).toEqual(["192.168.1.2"]);
    expect(snapshot.unavailable).toEqual(["Repository"]);
  });

  it("reports every unavailable check after network failures instead of inventing healthy empty data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Network error"); }));
    const snapshot = await fetchStatusRows();
    expect(snapshot.unavailable).toEqual(["Agent connection", "Repository", "MCP servers", "Local network"]);
    expect(snapshot.services).toBeNull();
    expect(snapshot.git).toBeNull();
    expect(snapshot.mcp).toBeNull();
  });

  it("treats a missing checkout as optional instead of a failed repository check", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
      JSON.stringify(url.endsWith("/git") ? { available: false, reason: "no-checkout" } : healthy[url]),
      { status: 200 },
    )));
    const snapshot = await fetchStatusRows();
    expect(snapshot.git).toBeNull();
    expect(snapshot.unavailable).not.toContain("Repository");
    expect(snapshot.notices.some((notice) => notice.includes("No linked checkout"))).toBe(true);
  });

  it("treats malformed successful responses as unavailable and attaches a timeout to every request", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = await fetchStatusRows();
    expect(snapshot.unavailable).toHaveLength(4);
    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[1].signal).toBeInstanceOf(AbortSignal);
    }
  });
});
