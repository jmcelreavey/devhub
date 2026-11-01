import { expect, it } from "vitest";
import { GET } from "./route";

it("returns a JSON error for a missing run", async () => {
  const response = await GET(new Request("http://localhost/api/scripts/stream/fixture"), {
    params: Promise.resolve({ runId: "fixture" }),
  });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Run not found" });
});
