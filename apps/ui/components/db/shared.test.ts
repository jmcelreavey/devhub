import { afterEach, expect, it, vi } from "vitest";
import { postDbAction } from "./shared";

afterEach(() => vi.unstubAllGlobals());

it("keeps runtime remedy failures renderable alongside database errors", async () => {
  for (const [body, kind, message] of [
    [{ error: { code: "RUNTIME_FAILED", message: "Plugin request failed.", retryable: true } }, "error", "Plugin request failed."],
    [{ error: "Read-only connection", code: "read_only" }, "read-only", "Read-only connection"],
    [{ error: { unexpected: true } }, "error", '{"error":{"unexpected":true}}'],
  ] as const) {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status: 502 })));
    const result = await postDbAction("/api/plugins/runtime/bi", {});
    expect(result).toMatchObject({ ok: false, kind, message });
  }
});
