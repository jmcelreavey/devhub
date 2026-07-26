import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { apiPost, apiGet, ApiError, isApiError, formatIssues } from "@/lib/api-client";

const Schema = z.object({ name: z.string().min(1), count: z.number().int() });

function mockFetch(res: Partial<Response> & { bodyText?: string }) {
  const fn = vi.fn().mockResolvedValue({
    ok: res.ok ?? true,
    status: res.status ?? 200,
    text: async () => res.bodyText ?? "",
  } as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("apiPost", () => {
  it("sends validated JSON and returns the parsed payload", async () => {
    const fetchFn = mockFetch({ bodyText: JSON.stringify({ ok: true }) });
    const out = await apiPost("/api/thing", Schema, { name: "a", count: 1 });

    expect(out).toEqual({ ok: true });
    const [path, init] = fetchFn.mock.calls[0];
    expect(path).toBe("/api/thing");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ name: "a", count: 1 });
  });

  it("rejects an invalid body without hitting the network", async () => {
    // The whole point: a bad body is caught here, not as a mystery 400.
    const fetchFn = mockFetch({});
    await expect(apiPost("/api/thing", Schema, { name: "", count: 1 })).rejects.toThrow(
      /Invalid request body/,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("names the offending field in the validation error", async () => {
    mockFetch({});
    await expect(
      apiPost("/api/thing", Schema, { name: "a", count: 1.5 }),
    ).rejects.toThrow(/count/);
  });

  it("surfaces the server's error message", async () => {
    mockFetch({ ok: false, status: 400, bodyText: JSON.stringify({ error: "nope" }) });
    await expect(apiPost("/api/thing", Schema, { name: "a", count: 1 })).rejects.toThrow("nope");
  });

  it("falls back to a status message when the server sends no error field", async () => {
    mockFetch({ ok: false, status: 500, bodyText: "{}" });
    await expect(apiPost("/api/thing", Schema, { name: "a", count: 1 })).rejects.toThrow(/500/);
  });

  it("survives a non-JSON error body", async () => {
    // Proxies and crash pages return HTML; this must not throw a parse error.
    mockFetch({ ok: false, status: 502, bodyText: "<html>Bad Gateway</html>" });
    await expect(apiPost("/api/thing", Schema, { name: "a", count: 1 })).rejects.toThrow(/502/);
  });

  it("handles an empty response body", async () => {
    mockFetch({ bodyText: "" });
    await expect(apiPost("/api/thing", Schema, { name: "a", count: 1 })).resolves.toBeNull();
  });

  it("exposes status and body on the thrown error", async () => {
    mockFetch({ ok: false, status: 404, bodyText: JSON.stringify({ error: "gone" }) });
    try {
      await apiPost("/api/thing", Schema, { name: "a", count: 1 });
      expect.unreachable();
    } catch (e) {
      expect(isApiError(e)).toBe(true);
      expect((e as ApiError).status).toBe(404);
      expect((e as ApiError).body).toEqual({ error: "gone" });
    }
  });

  it("applies schema transforms before sending", async () => {
    const Trimmed = z.object({ name: z.string().trim() });
    const fetchFn = mockFetch({ bodyText: "{}" });
    await apiPost("/api/thing", Trimmed, { name: "  padded  " });
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ name: "padded" });
  });
});

describe("apiGet", () => {
  it("returns the parsed payload", async () => {
    mockFetch({ bodyText: JSON.stringify({ items: [1, 2] }) });
    await expect(apiGet("/api/list")).resolves.toEqual({ items: [1, 2] });
  });

  it("throws ApiError on a failure status", async () => {
    mockFetch({ ok: false, status: 503, bodyText: JSON.stringify({ error: "offline" }) });
    await expect(apiGet("/api/list")).rejects.toThrow("offline");
  });
});

describe("formatIssues", () => {
  it("renders one line per issue with the field path", () => {
    const result = Schema.safeParse({ name: "", count: "x" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const text = formatIssues(result.error);
    expect(text).toContain("name:");
    expect(text).toContain("count:");
    expect(text).not.toContain("\n"); // single line - it goes in a toast
  });

  it("labels a whole-body issue as 'body'", () => {
    const result = z.object({ a: z.string() }).safeParse("not an object");
    if (result.success) return;
    expect(formatIssues(result.error)).toMatch(/^body:/);
  });
});
