import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchScriptRunExitCode } from "./wait-for-script-run";

describe("fetchScriptRunExitCode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns exit code when the run log payload includes it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ runId: "abc", exitCode: 0, lines: [] }),
      }),
    );

    await expect(fetchScriptRunExitCode("abc")).resolves.toBe(0);
    expect(fetch).toHaveBeenCalledWith("/api/scripts/runs/abc");
  });

  it("returns null when the run is still in progress", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ runId: "abc", lines: ["working…"] }),
      }),
    );

    await expect(fetchScriptRunExitCode("abc")).resolves.toBeNull();
  });

  it("returns null when the run log is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      }),
    );

    await expect(fetchScriptRunExitCode("missing")).resolves.toBeNull();
  });
});
