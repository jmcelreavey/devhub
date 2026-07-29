import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
const write = vi.hoisted(() => vi.fn());

vi.mock("@/lib/vault/vault-registry", () => ({
  getVaultStorage: vi.fn(() => ({ read, write })),
  getVault: vi.fn(() => ({ revalidatePaths: [] })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createVaultRoutes } from "./create-vault-routes";

describe("conditional note writes", () => {
  const { PUT } = createVaultRoutes("notes");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an autosave based on an older note version", async () => {
    read.mockReturnValue({ modified: 200 });
    const request = new NextRequest("http://test/api/notes/daily/test", {
      method: "PUT",
      body: JSON.stringify({ content: [], expectedModified: 100 }),
    });

    const response = await PUT(request, {
      params: Promise.resolve({ path: ["daily", "test"] }),
    });

    expect(response.status).toBe(409);
    expect(write).not.toHaveBeenCalled();
  });

  it("writes when the expected note version is current", async () => {
    read.mockReturnValue({ modified: 200 });
    write.mockReturnValue({ content: [], modified: 201 });
    const request = new NextRequest("http://test/api/notes/daily/test", {
      method: "PUT",
      body: JSON.stringify({ content: [], expectedModified: 200 }),
    });

    const response = await PUT(request, {
      params: Promise.resolve({ path: ["daily", "test"] }),
    });

    expect(response.status).toBe(200);
    expect(write).toHaveBeenCalledWith("daily/test", []);
  });

  it("rejects deleting a note whose version changed", async () => {
    read.mockReturnValue({ modified: 300 });
    const { DELETE } = createVaultRoutes("notes");
    const request = new NextRequest(
      "http://test/api/notes/daily/test?expectedModified=200",
      { method: "DELETE" },
    );

    const response = await DELETE(request, {
      params: Promise.resolve({ path: ["daily", "test"] }),
    });

    expect(response.status).toBe(409);
  });
});
