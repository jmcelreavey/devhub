import { describe, expect, it } from "vitest";
import { RuntimeStream } from "./runtime-host";
import { runtimeSchema, runtimeInventory, permissionChanges } from "./runtime-contract";
import template from "../../../templates/runtime-plugin/devhub-plugin.json";

describe("runtime streaming", () => {
  it("decodes split UTF-8 records and keeps progress separate from the result", () => {
    const events: unknown[] = [];
    const stream = new RuntimeStream(event => events.push(event));
    const bytes = Buffer.from(JSON.stringify({ type: "output", text: "café ☕" }) + "\n" + JSON.stringify({ type: "result", result: { ok: true } }) + "\n");
    for (const byte of bytes) stream.push(Buffer.from([byte]));
    expect(events).toEqual([{ type: "output", text: "café ☕" }]);
    expect(stream.finish()).toEqual({ ok: true });
  });
  it("rejects missing results, malformed records, excess output and records after completion", () => {
    expect(() => new RuntimeStream().finish()).toThrow();
    expect(() => new RuntimeStream().push(Buffer.from('{"type":"output","text":42}\n'))).toThrow();
    expect(() => new RuntimeStream().push(Buffer.alloc(256 * 1024 + 1, 120))).toThrow();
    const stream = new RuntimeStream();
    stream.push(Buffer.from('{"type":"result","result":null}\n'));
    expect(() => stream.push(Buffer.from('{"type":"output","text":"late"}\n'))).toThrow();
  });
  it("bounds deadlines and includes live output and time limits in reviewed permissions", () => {
    const base = runtimeSchema.parse(template.runtime);
    const runtime = { ...base, routes: [{ path: "/run", method: "POST" as const, stream: true, timeoutSeconds: 660 }] };
    expect(runtimeSchema.safeParse(runtime).success).toBe(true);
    expect(runtimeInventory(runtime).find(row => row.kind === "API routes")?.entries).toContain("POST /run · live output · 660s limit");
    expect(permissionChanges(base, runtime)).toContain("routes");
    expect(runtimeSchema.safeParse({ ...runtime, routes: [{ ...runtime.routes[0], timeoutSeconds: 901 }] }).success).toBe(false);
  });
});
