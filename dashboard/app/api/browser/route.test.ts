import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ playwright: false, tasks: false }));

vi.mock("playwright-core", () => ({
  get chromium() {
    if (gate.playwright) throw new Error("Cannot find module '/pkg/playwright-core/browsers.json'");
    return { connectOverCDP: vi.fn() };
  },
}));

vi.mock("@shared/tasks/store", () => ({
  readItems: () => {
    if (gate.tasks) throw new Error("tasks unreadable");
    return [];
  },
  findTask: () => undefined,
}));

import { GET, POST } from "./route";

function authedGet() {
  return new NextRequest("http://127.0.0.1:1348/api/browser", {
    headers: { referer: "http://127.0.0.1:1348/browser", host: "127.0.0.1:1348" },
  });
}

describe("browser route failures", () => {
  beforeEach(() => {
    gate.playwright = false;
    gate.tasks = false;
    delete process.env.DEVHUB_API_SECRET;
  });

  it("returns JSON when the caller is not signed in", async () => {
    const response = await GET(new NextRequest("http://127.0.0.1:1348/api/browser"));
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("returns a JSON error when status gathering throws", async () => {
    gate.tasks = true;
    const response = await GET(authedGet());
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "tasks unreadable" });
  });

  it("returns JSON when Playwright fails to load instead of an empty failure", async () => {
    gate.playwright = true;
    const response = await POST(new NextRequest("http://127.0.0.1:1348/api/browser", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:1348", host: "127.0.0.1:1348", "content-type": "application/json" },
      body: JSON.stringify({
        action: "start",
        config: { taskId: "task", runId: "run", origins: ["https://example.com"], persistent: false, consent: true },
      }),
    }));
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: "Playwright could not load because browsers.json is missing. Reinstall DevHub.",
    });
  });
});
