import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let notesDir: string;

vi.mock("@/lib/notes/dir", () => ({ getNotesDir: () => notesDir }));
vi.mock("@/lib/api-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-utils")>()),
  requireDashboardAuth: () => ({ ok: true }),
}));

const { GET, PUT } = await import("./route");

const url = "http://127.0.0.1:1337/api/tasks/implement/review-settings";
const put = (body: Record<string, unknown>) =>
  PUT(new NextRequest(url, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

beforeEach(() => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-review-settings-"));
});
afterEach(() => {
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("/api/tasks/implement/review-settings", () => {
  it("starts with the implementing agent reviewing its own work", async () => {
    expect(await (await GET(new NextRequest(url))).json()).toEqual({ provider: "", model: "" });
  });

  it("saves and returns the assigned reviewer", async () => {
    const response = await put({ provider: "codex", model: "gpt-6-astra" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ provider: "codex", model: "gpt-6-astra" });
    expect(await (await GET(new NextRequest(url))).json()).toEqual({ provider: "codex", model: "gpt-6-astra" });
  });

  it("switches back off with a blank provider", async () => {
    await put({ provider: "codex", model: "gpt-6-astra" });
    expect(await (await put({ provider: "" })).json()).toEqual({ provider: "", model: "" });
  });

  it("rejects an empty body and a provider that is not an id", async () => {
    expect((await put({})).status).toBe(400);
    expect((await put({ provider: "codex; rm -rf /" })).status).toBe(400);
    expect((await put({ provider: "../x" })).status).toBe(400);
  });
});
