import { afterEach, describe, expect, it, vi } from "vitest";
import { checkJiraConnection } from "./check";
import { getResolvedJiraEnv } from "@/lib/jira/env";

vi.mock("@/lib/jira/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jira/env")>();
  return {
    ...actual,
    getResolvedJiraEnv: vi.fn(),
  };
});

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

describe("checkJiraConnection", () => {
  it("fails closed when no credentials are available", async () => {
    vi.mocked(getResolvedJiraEnv).mockReturnValue(null);
    const result = await checkJiraConnection({});
    expect(result.ok).toBe(false);
    expect(result.code).toBe("missing_credentials");
  });

  it("reports auth_failed when /myself is 401", async () => {
    vi.mocked(getResolvedJiraEnv).mockReturnValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes(401, { errorMessages: ["unauthenticated"] })),
    );

    const result = await checkJiraConnection({
      domain: "example.atlassian.net",
      email: "dev@example.com",
      apiToken: "dead-token",
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: "auth_failed" }),
    );
    expect(result.message).toMatch(/HTTP 401/);
  });

  it("succeeds when /myself is 200", async () => {
    vi.mocked(getResolvedJiraEnv).mockReturnValue({
      domain: "example.atlassian.net",
      email: "dev@example.com",
      apiToken: "saved-token",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes(200, { accountId: "abc", displayName: "Dev" })),
    );

    const result = await checkJiraConnection({});
    expect(result).toEqual({ ok: true, code: "connected", message: "Connected to Jira successfully." });
  });

  it("prefers form token over the saved env", async () => {
    vi.mocked(getResolvedJiraEnv).mockReturnValue({
      domain: "example.atlassian.net",
      email: "dev@example.com",
      apiToken: "saved-token",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      const expected = "Basic " + Buffer.from("dev@example.com:form-token").toString("base64");
      expect(auth).toBe(expected);
      expect(String(input)).toContain("/myself");
      return jsonRes(200, { accountId: "abc" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkJiraConnection({ apiToken: "form-token" });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
