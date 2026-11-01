import { expect, it, vi } from "vitest";

const { getVaultTree } = vi.hoisted(() => ({ getVaultTree: vi.fn() }));

vi.mock("../../../lib/vault/create-vault-routes", () => ({ getVaultTree }));

import { GET } from "./route";

it("reports a tree failure instead of returning an empty success", async () => {
  getVaultTree.mockRejectedValueOnce(new Error("Synthetic tree failure"));
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual([]);
    expect(getVaultTree).toHaveBeenCalledWith("notes");
  } finally {
    consoleError.mockRestore();
  }
});
