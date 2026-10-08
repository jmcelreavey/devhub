import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getResolvedJiraEnv } from "@/lib/jira/env";
import { getJiraMeta, invalidateJiraMetaCache, JIRA_META_TTL_MS } from "./client";

vi.mock("@/lib/jira/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jira/env")>();
  return { ...actual, getResolvedJiraEnv: vi.fn() };
});

const env = { domain: "example.atlassian.net", email: "dev@example.com", apiToken: "tok" };

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

let boardRequests: string[];
let boardFails: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T09:00:00Z"));
  boardRequests = [];
  boardFails = false;
  invalidateJiraMetaCache();
  vi.mocked(getResolvedJiraEnv).mockReturnValue(env);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/rest/agile/1.0/board?")) {
      boardRequests.push(url);
      if (boardFails) throw new Error("Jira unreachable");
      return jsonRes({ values: [] });
    }
    if (url.endsWith("/myself")) return jsonRes({ accountId: "abc", displayName: "Dev" });
    if (url.endsWith("/field")) return jsonRes([]);
    throw new Error(`unexpected ${url}`);
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(getResolvedJiraEnv).mockReset();
});

describe("getJiraMeta cache", () => {
  it("answers a repeat lookup for the same project and reference without asking Jira again", async () => {
    const first = await getJiraMeta("TEST", "TEST-1");
    const second = await getJiraMeta("TEST", "TEST-1");
    expect(second).toEqual(first);
    expect(boardRequests).toHaveLength(1);
  });

  it("keeps a different project or reference separate", async () => {
    await getJiraMeta("TEST", "TEST-1");
    await getJiraMeta("OTHER", "TEST-1");
    await getJiraMeta("TEST", "TEST-2");
    expect(boardRequests).toHaveLength(3);
  });

  it("asks again once the TTL has passed", async () => {
    await getJiraMeta("TEST");
    vi.setSystemTime(Date.now() + JIRA_META_TTL_MS - 1);
    await getJiraMeta("TEST");
    expect(boardRequests).toHaveLength(1);
    vi.setSystemTime(Date.now() + 1);
    await getJiraMeta("TEST");
    expect(boardRequests).toHaveLength(2);
  });

  it("does not cache a failure", async () => {
    boardFails = true;
    await expect(getJiraMeta("TEST")).rejects.toThrow("Jira unreachable");
    boardFails = false;
    await expect(getJiraMeta("TEST")).resolves.toMatchObject({ configured: true, projectKey: "TEST" });
    expect(boardRequests).toHaveLength(2);
  });

  it("can be invalidated explicitly", async () => {
    await getJiraMeta("TEST");
    invalidateJiraMetaCache();
    await getJiraMeta("TEST");
    expect(boardRequests).toHaveLength(2);
  });

  it("does not cache the unconfigured answer", async () => {
    vi.mocked(getResolvedJiraEnv).mockReturnValue(null);
    await expect(getJiraMeta("TEST")).resolves.toMatchObject({ configured: false });
    vi.mocked(getResolvedJiraEnv).mockReturnValue(env);
    await expect(getJiraMeta("TEST")).resolves.toMatchObject({ configured: true });
  });
});
