import { beforeEach, expect, it, vi } from "vitest";
import { DELETE, GET } from "./route";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), read: vi.fn(), remove: vi.fn() }));
vi.mock("../../../../lib/repos/scanned-repo", () => ({ resolveScannedRepo: mocks.resolve }));
vi.mock("../../../../lib/repos/index", () => ({ readRepoInfo: mocks.read, deleteLocalRepo: mocks.remove }));
beforeEach(() => vi.resetAllMocks());

it("preserves repository lookup and destructive-operation rejection", async () => {
  const request = new Request("http://localhost:1447/api/repos/demo");
  const params = { params: Promise.resolve({ name: "demo" }) };
  mocks.resolve.mockReturnValueOnce(null);
  expect((await GET(request, params)).status).toBe(404);
  mocks.resolve.mockReturnValueOnce("/fixture/demo");
  mocks.read.mockResolvedValueOnce({ name: "demo" });
  expect(await (await GET(request, params)).json()).toEqual({ repo: { name: "demo" } });
  mocks.remove.mockImplementationOnce(() => { throw new Error("Refusing to delete current devhub repo"); });
  expect((await DELETE(request, params)).status).toBe(400);
});
