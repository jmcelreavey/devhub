import { expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), index: vi.fn() }));
vi.mock("../../../../../lib/repos/scanned-repo", () => ({ resolveScannedRepo: mocks.resolve }));
vi.mock("../../../../../lib/recall/store", () => ({ loadIndex: mocks.index }));

it("resolves the repository before exposing its notes", async () => {
  const request = new Request("http://localhost:1447/api/repos/demo/notes");
  const params = { params: Promise.resolve({ name: "demo" }) };
  mocks.resolve.mockReturnValueOnce(null);
  expect((await GET(request, params)).status).toBe(404);
  expect(mocks.index).not.toHaveBeenCalled();
  mocks.resolve.mockReturnValueOnce("/fixture/demo");
  mocks.index.mockReturnValueOnce(null);
  expect(await (await GET(request, params)).json()).toEqual({ notes: [] });
});
