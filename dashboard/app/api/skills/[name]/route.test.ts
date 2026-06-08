import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/skills/[name]", () => {
  it("returns 400 for invalid slug", async () => {
    const res = await GET(new Request("http://test"), {
      params: Promise.resolve({ name: "../etc/passwd" }),
    });
    expect(res.status).toBe(400);
  });
});
