import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@/lib/vault/vault-registry", () => ({
  parseVaultId: (v: string | null) => (v === "docs" ? "docs" : "notes"),
  getVaultStorage: vi.fn(),
}));

import { getVaultStorage } from "@/lib/vault/vault-registry";

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.mocked(getVaultStorage).mockReturnValue({
      search: () => [],
    } as unknown as ReturnType<typeof getVaultStorage>);
  });

  it("groups docs vault results by path (one file entry per doc)", async () => {
    vi.mocked(getVaultStorage).mockReturnValue({
      search: () => [
        {
          path: "architecture/electron-wrapper",
          line: 1,
          text: "# Architecture",
          score: 10,
        },
        {
          path: "architecture/electron-wrapper",
          line: 12,
          text: "Electron Architecture",
          score: 8,
        },
        { path: "README", line: 3, text: "Architecture overview", score: 5 },
      ],
    } as unknown as ReturnType<typeof getVaultStorage>);

    const req = new NextRequest("http://test/api/search?vault=docs&q=Architecture");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.files).toHaveLength(2);
    const electron = data.files.find(
      (f: { path: string }) => f.path === "architecture/electron-wrapper",
    );
    expect(electron.matches).toHaveLength(2);
    expect(electron.matches[0]).toEqual({
      line: 1,
      text: "# Architecture",
    });
  });
});
