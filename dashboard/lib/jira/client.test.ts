import { afterEach, describe, expect, it, vi } from "vitest";
import { getMyTickets } from "./client";
import { getResolvedJiraEnv } from "@/lib/jira/env";

vi.mock("@/lib/jira/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jira/env")>();
  return {
    ...actual,
    getResolvedJiraEnv: vi.fn(),
  };
});

const env = { domain: "example.atlassian.net", email: "dev@example.com", apiToken: "tok" };

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(getResolvedJiraEnv).mockReset();
});

describe("getMyTickets", () => {
  it("returns [] when Jira is not configured", async () => {
    vi.mocked(getResolvedJiraEnv).mockReturnValue(null);
    await expect(getMyTickets()).resolves.toEqual([]);
  });

  it("throws when search is empty and /myself is 401", async () => {
    vi.mocked(getResolvedJiraEnv).mockReturnValue(env);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/search/jql")) return jsonRes(200, { issues: [], isLast: true });
      if (url.endsWith("/myself")) return jsonRes(401, { errorMessages: ["unauthenticated"] });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMyTickets()).rejects.toThrow(/Jira authentication failed \(401\)/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns [] when search is empty and /myself succeeds", async () => {
    vi.mocked(getResolvedJiraEnv).mockReturnValue(env);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/search/jql")) return jsonRes(200, { issues: [], isLast: true });
      if (url.endsWith("/myself")) return jsonRes(200, { accountId: "abc", displayName: "Dev" });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMyTickets()).resolves.toEqual([]);
  });

  it("maps issues without calling /myself", async () => {
    vi.mocked(getResolvedJiraEnv).mockReturnValue(env);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/search/jql")) {
        return jsonRes(200, {
          issues: [
            {
              key: "PTF-1",
              fields: {
                summary: "Native share",
                status: { name: "Open" },
                priority: { name: "Medium" },
                issuetype: { name: "Task" },
                project: { name: "Platform", key: "PTF" },
                updated: "2026-08-27T00:00:00.000Z",
                assignee: { displayName: "Dev", emailAddress: "dev@example.com" },
              },
            },
          ],
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tickets = await getMyTickets();
    expect(tickets).toEqual([
      expect.objectContaining({ key: "PTF-1", summary: "Native share", status: "Open" }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
