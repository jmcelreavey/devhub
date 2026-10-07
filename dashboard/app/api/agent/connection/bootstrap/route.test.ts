import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const paseo = vi.hoisted(() => ({ password: "test-secret" as string | undefined }));
vi.mock("@/lib/paseo/client", () => ({ paseoPassword: () => paseo.password, paseoWebOrigin: () => "http://127.0.0.1:6767" }));
import { POST } from "./route";

beforeEach(() => {
  paseo.password = "test-secret";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ serverId: "srv_test" }) })));
});

describe("Paseo bootstrap credentials", () => {
  it("requires a same-origin request", async () => {
    const response = await POST(new NextRequest("http://localhost:1337/api/agent/connection/bootstrap", { method: "POST", headers: { origin: "http://example.com" } }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns the configured password only after checking the local daemon", async () => {
    const response = await POST(new NextRequest("http://localhost:1337/api/agent/connection/bootstrap", { method: "POST", headers: { host: "localhost:1337", origin: "http://localhost:1337" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ serverId: "srv_test", password: "test-secret" });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:6767/api/status", expect.objectContaining({ headers: { Authorization: "Bearer test-secret" } }));
  });
  it("uses Paseo's built-in no-password setup when the env is empty", async () => {
    paseo.password = undefined;
    const response = await POST(new NextRequest("http://localhost:1337/api/agent/connection/bootstrap", { method: "POST", headers: { host: "localhost:1337", origin: "http://localhost:1337" } }));
    expect(response.status).toBe(204);
    expect(fetch).not.toHaveBeenCalled();
  });
});
