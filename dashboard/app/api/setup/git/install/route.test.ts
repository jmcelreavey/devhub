import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/setup/git-install", () => ({
  startMacGitInstall: vi.fn(async () => ({ status: 200, body: { ok: true, message: "ok" } })),
}));

import { GET, POST } from "./route";
import { startMacGitInstall } from "@/lib/setup/git-install";

beforeEach(() => {
  vi.mocked(startMacGitInstall).mockClear();
});

describe("Install Git route", () => {
  it("does not start the installer on GET", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(startMacGitInstall).not.toHaveBeenCalled();
  });

  it("POST delegates with the process platform and never any other argv", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(startMacGitInstall).toHaveBeenCalledTimes(1);
    expect(startMacGitInstall).toHaveBeenCalledWith({ platform: process.platform, method: "POST" });
  });
});
