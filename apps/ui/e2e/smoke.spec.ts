import { test, expect } from "@playwright/test";

test.describe("api guards", () => {
  test("a mutating request with no Origin is rejected", async ({ request }) => {
    // The core server enforces this globally. If this ever returns 2xx, the guard has
    // been lost — which is the whole reason it is asserted here rather than
    // trusted from a code read.
    const res = await request.post("/api/repos/clone", {
      data: { fullName: "octocat/hello-world" },
      headers: { origin: "" },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("a malformed body is a 400, not a 500", async ({ request, baseURL }) => {
    const res = await request.post("/api/repos/clone", {
      data: { fullName: { not: "a string" } },
      headers: { origin: baseURL ?? "" },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });
});
