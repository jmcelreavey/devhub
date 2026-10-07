import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./managed", () => ({ readPaseoManaged: () => ({ version: "0.8.0" }) }));
vi.mock("./client", () => ({ withPaseo: (fn: (session: unknown) => unknown) => fn({ api: { agents: { list: mock.list } } }) }));
vi.mock("@/lib/exec-external", () => ({ execExternal: vi.fn().mockResolvedValue({ stdout: '"0.9.0"' }) }));
import { checkPaseoUpdate, hasActivePaseoWork, newerVersion } from "./update";
import { execExternal } from "@/lib/exec-external";
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());
describe("Paseo updates", () => {
  it("compares numeric versions and rejects prereleases", () => {
    expect(newerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(newerVersion("0.8.0", "0.8.0")).toBe(false);
    expect(newerVersion("0.7.0", "0.8.0")).toBe(false);
    expect(newerVersion("1.0.0-beta.1", "0.8.0")).toBe(false);
  });
  it("caches release checks but permits an explicit refresh", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: "0.9.0" }) }));
    expect(await checkPaseoUpdate(true)).toMatchObject({ available: true, latest: "0.9.0", installable: "0.9.0", canUpdate: true });
    await checkPaseoUpdate();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("reads the version when Safe-Chain adds notices to stdout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: "0.9.2" }) }));
    vi.mocked(execExternal).mockResolvedValueOnce({
      stdout: 'ℹ Safe-chain: Checking package metadata.\n"0.8.0"\nℹ Safe-chain: Some package versions were suppressed due to minimum age requirement.\n',
      stderr: "",
    });
    expect(await checkPaseoUpdate(true)).toMatchObject({ available: true, latest: "0.9.2", installable: "0.8.0", canUpdate: false });
  });
  it.each(['{"version":"0.9.0"}', '"0.9.0"\n"0.10.0"', '"0.9.0-beta.1"', 'Notice: "0.9.0"'])("rejects invalid or ambiguous version output: %s", async (stdout) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: "0.9.0" }) }));
    vi.mocked(execExternal).mockResolvedValueOnce({ stdout, stderr: "" });
    expect(await checkPaseoUpdate(true)).toMatchObject({ canUpdate: false, error: expect.any(String) });
  });
  it("announces a published release while its safety window prevents installing it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: "0.9.0" }) }));
    vi.mocked(execExternal).mockResolvedValueOnce({ stdout: '"0.8.0"', stderr: "" });
    expect(await checkPaseoUpdate(true)).toMatchObject({ available: true, latest: "0.9.0", installable: "0.8.0", canUpdate: false });
  });
  it("waits when a published release has a dependency held by Safe-Chain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: "0.9.0" }) }));
    vi.mocked(execExternal).mockResolvedValueOnce({ stdout: '"0.9.0"', stderr: "" });
    vi.mocked(execExternal).mockRejectedValueOnce(Object.assign(new Error("Not installable"), { stderr: "npm error code ETARGET" }));
    expect(await checkPaseoUpdate(true)).toMatchObject({ available: true, latest: "0.9.0", canUpdate: false });
  });
  it("reports an offline check rather than claiming the installed version is current", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    expect(await checkPaseoUpdate(true)).toMatchObject({ available: false, latest: null, error: expect.any(String) });
  });
  it("checks later pages before allowing an update to stop agents", async () => {
    mock.list.mockResolvedValueOnce({ entries: [], pageInfo: { hasMore: true, nextCursor: "later" } });
    mock.list.mockResolvedValueOnce({ entries: [{ agent: { status: "running", pendingPermissions: [] } }], pageInfo: { hasMore: false } });
    expect(await hasActivePaseoWork()).toBe(true);
    expect(mock.list).toHaveBeenLastCalledWith({ scope: "active", page: { limit: 200, cursor: "later" } });
  });
  it("refuses an incomplete or repeated page cursor", async () => {
    mock.list.mockResolvedValue({ entries: [], pageInfo: { hasMore: true, nextCursor: "same" } });
    await expect(hasActivePaseoWork()).rejects.toThrow("verify");
  });
});
