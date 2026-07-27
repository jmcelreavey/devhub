import { describe, expect, it } from "vitest";
import { notConfigured } from "@/lib/api-utils";

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
