import { expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { POST as composeUp } from "./compose-up/route";
import { POST as openGitkraken } from "./open-gitkraken/route";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("../../../../lib/repos/index", () => ({ getReposScanDir: () => "/fixture/repos" }));

it("rejects paths outside the repo scan directory before launching anything", async () => {
  const params = { params: Promise.resolve({ name: "../other" }) };
  const request = new Request("http://localhost:1447/api/repos/test", { method: "POST" });
  expect((await composeUp(request, params)).status).toBe(404);
  expect((await openGitkraken(request, params)).status).toBe(404);
  expect(spawn).not.toHaveBeenCalled();
});
