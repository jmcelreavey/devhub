import { expect, it } from "vitest";
import { GET } from "./route";

it.each([
  { path: ["fixture"], message: "Unsupported asset type" },
  { path: ["..", "fixture.png"], message: "Path traversal blocked" },
])("rejects invalid asset paths with a client error", async ({ path, message }) => {
  const response = await GET(new Request("http://localhost/api/notes-assets/fixture"), { params: Promise.resolve({ path }) });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: expect.stringContaining(message) });
});
