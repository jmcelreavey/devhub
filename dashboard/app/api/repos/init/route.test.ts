import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/repos", () => ({
  initLocalRepo: vi.fn(async (name: string) => ({ name, path: `/tmp/${name}` })),
}));

import { initLocalRepo } from "@/lib/repos";
import { POST } from "./route";

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://test/api/repos/init", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/repos/init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inits a folder in the scan dir", async () => {
    const response = await POST(request({ name: "fresh" }));
    expect(response.status).toBe(200);
    expect(initLocalRepo).toHaveBeenCalledWith("fresh");
  });

  it("rejects an empty name", async () => {
    const response = await POST(request({ name: "  " }));
    expect(response.status).toBe(400);
    expect(initLocalRepo).not.toHaveBeenCalled();
  });
});
