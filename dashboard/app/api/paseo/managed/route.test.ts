import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({ exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }) }));
vi.mock("@/lib/exec-external", () => ({ execExternal: mock.exec }));
vi.mock("@/lib/api-utils", () => ({
  requireDashboardAuth: () => ({ ok: true }),
  parseBody: async (req: NextRequest) => ({ ok: true, data: await req.json() }),
}));
vi.mock("@/lib/content/dirs", () => ({
  getResourceRoot: () => "/app/Resources/resources",
  getRepoRoot: () => "/app-data",
}));
vi.mock("@/lib/paseo/update", () => ({ hasActivePaseoWork: async () => false, checkPaseoUpdate: vi.fn() }));
vi.mock("@/lib/paseo/providers", () => ({ defaultPaseoProvider: vi.fn(), listPaseoProviders: vi.fn() }));
vi.mock("@/lib/paseo/managed", () => ({ PASEO_DAEMON_LABEL: "test", readPaseoManaged: vi.fn() }));
import { POST } from "./route";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("packaged Paseo updates", () => {
  it("runs the bundled installer instead of looking in writable app data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const req = new NextRequest("http://localhost:1337/api/paseo/managed", {
      method: "POST", headers: { host: "localhost:1337", "content-type": "application/json" },
      body: JSON.stringify({ action: "update" }),
    });
    expect((await POST(req)).status).toBe(200);
    expect(mock.exec).toHaveBeenCalledWith(process.execPath, ["/app/Resources/resources/scripts/install-paseo.mjs", "--update"], expect.any(Object));
  });
});
