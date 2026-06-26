import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DashboardClient,
  DashboardHttpError,
  DashboardUnreachableError,
  withDashboardErrors,
} from "./dashboard-client.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = vi.fn(impl as typeof fetch);
}

describe("DashboardClient.request", () => {
  it("builds URL with query params and parses JSON", async () => {
    let seenUrl = "";
    mockFetch((url) => {
      seenUrl = url;
      return new Response(JSON.stringify({ ok: true, n: 1 }), { status: 200 });
    });
    const client = new DashboardClient("http://localhost:1337");
    const out = await client.get<{ ok: boolean; n: number }>("/api/x", { a: "1", b: undefined, c: 2 });
    expect(out).toEqual({ ok: true, n: 1 });
    expect(seenUrl).toContain("http://localhost:1337/api/x?");
    expect(seenUrl).toContain("a=1");
    expect(seenUrl).toContain("c=2");
    expect(seenUrl).not.toContain("b=");
  });

  it("throws DashboardHttpError with the payload error message on non-2xx", async () => {
    mockFetch(() => new Response(JSON.stringify({ error: "boom" }), { status: 409 }));
    const client = new DashboardClient("http://localhost:1337");
    await expect(client.post("/api/x", { y: 1 })).rejects.toMatchObject({
      name: "DashboardHttpError",
      status: 409,
    });
    try {
      await client.post("/api/x", {});
    } catch (e) {
      expect(e).toBeInstanceOf(DashboardHttpError);
      expect((e as Error).message).toContain("boom");
    }
  });

  it("throws DashboardUnreachableError when fetch rejects", async () => {
    mockFetch(() => Promise.reject(new Error("ECONNREFUSED")));
    const client = new DashboardClient("http://localhost:1337");
    await expect(client.get("/api/x")).rejects.toBeInstanceOf(DashboardUnreachableError);
  });
});

describe("withDashboardErrors", () => {
  it("passes through a successful result", async () => {
    const res = await withDashboardErrors(async () => ({ content: [{ type: "text" as const, text: "ok" }] }));
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toBe("ok");
  });

  it("maps DashboardUnreachableError to a clean isError result", async () => {
    const res = await withDashboardErrors(async () => {
      throw new DashboardUnreachableError("http://localhost:1337", new Error("x"));
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Could not reach the DevHub dashboard");
  });

  it("maps DashboardHttpError to a clean isError result", async () => {
    const res = await withDashboardErrors(async () => {
      throw new DashboardHttpError(500, { error: "nope" }, "Dashboard GET /api/x failed (500): nope");
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("500");
  });

  it("maps unexpected errors", async () => {
    const res = await withDashboardErrors(async () => {
      throw new Error("weird");
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("weird");
  });
});
