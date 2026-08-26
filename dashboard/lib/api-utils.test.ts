import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { notConfigured, requireDashboardAuth } from "@/lib/api-utils";
import { DESKTOP_COOKIE, DESKTOP_TOKEN_HEADER } from "@/lib/desktop/bootstrap-auth";

describe("notConfigured", () => {
  /**
   * The status code is the point of this helper, so it is worth pinning.
   *
   * These routes answered 400 for two years, which reads as "the caller sent
   * something wrong". A missing API token is not the caller's doing, and the
   * smoke suite only tolerates console noise from status codes that mean the
   * environment is at fault — so the wrong code here turns every credential-less
   * CI run red for a reason that has nothing to do with the change under test.
   */
  it("answers 503, not 400 — the request was fine, the server is not", async () => {
    const res = notConfigured("Jira");
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "Jira is not configured.",
      code: "not_configured",
    });
  });

  it("names the integration so the message is actionable", async () => {
    await expect(notConfigured("Calendar").json()).resolves.toMatchObject({
      error: "Calendar is not configured.",
    });
  });
});

describe("requireDashboardAuth", () => {
  const TOKEN = "a".repeat(64);
  let savedSecret: string | undefined;
  let savedToken: string | undefined;

  beforeEach(() => {
    savedSecret = process.env.DEVHUB_API_SECRET;
    savedToken = process.env.DEVHUB_BOOTSTRAP_TOKEN;
    delete process.env.DEVHUB_API_SECRET;
    process.env.DEVHUB_BOOTSTRAP_TOKEN = TOKEN;
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.DEVHUB_API_SECRET;
    else process.env.DEVHUB_API_SECRET = savedSecret;
    if (savedToken === undefined) delete process.env.DEVHUB_BOOTSTRAP_TOKEN;
    else process.env.DEVHUB_BOOTSTRAP_TOKEN = savedToken;
  });

  function request(headers: Record<string, string>): NextRequest {
    return new NextRequest("http://localhost:1337/api/opencode/listen", { headers });
  }

  it("rejects a GET with neither Origin, Referer, nor a desktop session", async () => {
    const result = requireDashboardAuth(request({ host: "localhost:1337" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
  });

  it("accepts a matching Referer when Origin is omitted — that is the browser GET", () => {
    const result = requireDashboardAuth(
      request({ host: "localhost:1337", referer: "http://localhost:1337/opencode" }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a cross-origin Referer", () => {
    const result = requireDashboardAuth(
      request({ host: "localhost:1337", referer: "https://evil.example/opencode" }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts the desktop bootstrap cookie when Origin is missing", () => {
    const result = requireDashboardAuth(
      request({ host: "localhost:1337", cookie: `${DESKTOP_COOKIE}=${TOKEN}` }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts the desktop token header when Origin is missing", () => {
    const result = requireDashboardAuth(
      request({ host: "localhost:1337", [DESKTOP_TOKEN_HEADER]: TOKEN }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a matching Origin without a desktop session", () => {
    const result = requireDashboardAuth(
      request({ host: "localhost:1337", origin: "http://localhost:1337" }),
    );
    expect(result.ok).toBe(true);
  });
});
