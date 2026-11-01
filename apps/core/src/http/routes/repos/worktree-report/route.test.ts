import { expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ read: vi.fn(() => ({ worktrees: [] })) }));
vi.mock("../../../../lib/repos/worktree-report", () => ({ readWorktreeReport: mocks.read }));

it("requires dashboard authentication before reading the report", async () => {
  const url = "http://localhost:1447/api/repos/worktree-report";
  expect([401, 403]).toContain((await GET(new Request(url))).status);
  expect(mocks.read).not.toHaveBeenCalled();
  const headers = { origin: "http://localhost:1447", host: "localhost:1447" };
  expect(await (await GET(new Request(url, { headers }))).json()).toEqual({ report: { worktrees: [] } });
});
