import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("../../../../lib/repos/index", () => ({ initLocalRepo: mocks.init }));
beforeEach(() => vi.resetAllMocks());

it("keeps init validation, trimmed names and conflict responses", async () => {
  const base = "http://localhost:1447/api/repos/init";
  const request = (name: string) => new Request(base, { method: "POST", body: JSON.stringify({ name }) });
  expect((await POST(request("  "))).status).toBe(400);
  expect(mocks.init).not.toHaveBeenCalled();
  mocks.init.mockResolvedValueOnce({ name: "example" });
  expect(await (await POST(request(" example "))).json()).toEqual({ ok: true, repo: { name: "example" } });
  expect(mocks.init).toHaveBeenCalledWith("example");
  mocks.init.mockRejectedValueOnce(new Error("Repository already exists"));
  expect((await POST(request("example"))).status).toBe(409);
});
