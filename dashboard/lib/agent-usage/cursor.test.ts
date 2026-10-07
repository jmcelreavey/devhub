import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("@/lib/exec-external", () => ({ execExternal: mocks.exec }));
import { stateDbPath } from "./cursor";
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it("reads the Windows editor profile when the backend is in WSL", async () => {
  vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu");
  mocks.exec.mockResolvedValueOnce({ stdout: "C:\\Users\\AMD Ryzen\\AppData\\Roaming\r\n" }).mockResolvedValueOnce({ stdout: "/mnt/c/Users/AMD Ryzen/AppData/Roaming\n" });
  expect(await stateDbPath()).toBe("/mnt/c/Users/AMD Ryzen/AppData/Roaming/Cursor/User/globalStorage/state.vscdb");
  expect(mocks.exec.mock.calls[1][1]).toEqual(["-u", "C:\\Users\\AMD Ryzen\\AppData\\Roaming"]);
});
it("treats disabled Windows interop as an unavailable profile", async () => {
  vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu");
  mocks.exec.mockRejectedValue(new Error("interop disabled"));
  expect(await stateDbPath()).toBeNull();
});
