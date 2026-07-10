import { afterEach, describe, expect, it } from "vitest";
import { getOpenCodeRecap, OpenCodeRecapError, redactRecapSecrets } from "./opencode-recap";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function api(data: Record<string, unknown>, unavailable = false): typeof fetch {
  return (async input => {
    if (unavailable) throw new Error("connection refused");
    const path = new URL(String(input)).pathname;
    const value = data[path];
    if (value === undefined) return new Response(null, { status: 404 });
    return Response.json(value);
  }) as typeof fetch;
}

describe("redactRecapSecrets", () => {
  it("recursively redacts secret keys, headers, URLs, and env values", () => {
    expect(
      redactRecapSecrets({
        headers: { Authorization: "Bearer abc", Accept: "json" },
        url: "https://user:pass@example.com/a?token=abc&ok=yes",
        env: { SAFE: "visible", API_KEY: "secret" },
        nested: [{ password: "secret" }],
      }),
    ).toEqual({
      headers: { Authorization: "[REDACTED]", Accept: "json" },
      url: "https://%5BREDACTED%5D:%5BREDACTED%5D@example.com/a?token=%5BREDACTED%5D&ok=yes",
      env: { SAFE: "visible", API_KEY: "[REDACTED]" },
      nested: [{ password: "[REDACTED]" }],
    });
  });
});

describe("getOpenCodeRecap", () => {
  it("prefers the busy root and returns only operational activity", async () => {
    const recap = await getOpenCodeRecap(
      {},
      api({
        "/session": [
          { id: "latest", title: "Latest", time: { updated: 20 } },
          { id: "busy", title: "Busy", time: { updated: 10 } },
        ],
        "/session/status": { busy: { type: "busy" } },
        "/session/busy/message": [
          {
            parts: [
              { type: "text", text: "assistant prose" },
              { type: "reasoning", text: "hidden reasoning" },
              {
                type: "tool",
                tool: "bash",
                state: { status: "completed", input: { command: "TOKEN=secret npm test", cwd: "/repo" } },
              },
              {
                type: "tool",
                tool: "apply_patch",
                state: {
                  status: "completed",
                  input: { patchText: "*** Update File: a.ts\n" },
                  metadata: { files: [{ relativePath: "a.ts", type: "update", patch: "secret contents" }] },
                },
              },
              {
                type: "tool",
                tool: "devhub_tasks_create",
                state: { status: "completed", input: { text: "ship it", headers: { authorization: "secret" } } },
              },
            ],
          },
        ],
      }),
    );

    expect(recap.sessions).toEqual([
      expect.objectContaining({
        id: "busy",
        commands: [{ command: "TOKEN=[REDACTED] npm test", cwd: "/repo", status: "completed" }],
        fileChanges: [{ path: "a.ts", operation: "update" }],
        mcpCalls: [
          {
            tool: "devhub_tasks_create",
            input: { text: "ship it", headers: { authorization: "[REDACTED]" } },
            status: "completed",
          },
        ],
        mutations: [expect.objectContaining({ tool: "devhub_tasks_create" })],
      }),
    ]);
    expect(JSON.stringify(recap)).not.toContain("assistant prose");
    expect(JSON.stringify(recap)).not.toContain("hidden reasoning");
    expect(JSON.stringify(recap)).not.toContain("secret contents");
  });

  it("uses an explicit session and optionally includes descendants", async () => {
    const recap = await getOpenCodeRecap(
      { sessionId: "root", includeChildren: true },
      api({
        "/session/root": { id: "root" },
        "/session/status": { newer: { type: "busy" } },
        "/session/root/children": [{ id: "child", parentID: "root" }],
        "/session/child/children": [],
        "/session/root/message": [],
        "/session/child/message": [],
      }),
    );

    expect(recap.sessions.map(session => session.id)).toEqual(["root", "child"]);
  });

  it("falls back to the latest root session", async () => {
    const recap = await getOpenCodeRecap(
      {},
      api({
        "/session": [
          { id: "older", time: { updated: 10 } },
          { id: "child", parentID: "older", time: { updated: 30 } },
          { id: "latest", time: { updated: 20 } },
        ],
        "/session/status": {},
        "/session/latest/message": [],
      }),
    );

    expect(recap.sessions[0].id).toBe("latest");
  });

  it("reports ambiguous busy roots with 409", async () => {
    await expect(
      getOpenCodeRecap(
        {},
        api({
          "/session": [{ id: "one" }, { id: "two" }],
          "/session/status": { one: { type: "busy" }, two: { type: "busy" } },
        }),
      ),
    ).rejects.toEqual(expect.objectContaining<Partial<OpenCodeRecapError>>({ status: 409 }));
  });

  it("reports an unavailable OpenCode server with 503", async () => {
    await expect(getOpenCodeRecap({}, api({}, true))).rejects.toEqual(
      expect.objectContaining<Partial<OpenCodeRecapError>>({ status: 503 }),
    );
  });
});
