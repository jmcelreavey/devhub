import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  desktop: false,
  authenticated: false,
  issueTicket: vi.fn(() => "test-ticket"),
}));
vi.mock("@/lib/desktop/bootstrap-auth", () => ({
  isDesktopSession: () => auth.desktop,
  isAuthenticatedDesktopRequest: () => auth.authenticated,
  issueTerminalTicket: auth.issueTicket,
}));

const { GET } = await import("./route");
const request = () => new NextRequest("http://localhost:1400/api/desktop/terminal-ticket");

beforeEach(() => {
  auth.desktop = false;
  auth.authenticated = false;
  auth.issueTicket.mockClear();
  vi.stubEnv("TERMINAL_PORT", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("terminal connection metadata", () => {
  it("lets an ordinary browser discover the default peer without a desktop ticket", async () => {
    const response = await GET(request());
    expect(await response.json()).toEqual({ ticket: null, desktop: false, port: 1339 });
    expect(auth.issueTicket).not.toHaveBeenCalled();
  });

  it("reports the running instance's peer port", async () => {
    vi.stubEnv("TERMINAL_PORT", "1402");
    expect(await (await GET(request())).json()).toEqual({ ticket: null, desktop: false, port: 1402 });
  });

  it("still refuses unauthenticated requests in desktop mode", async () => {
    auth.desktop = true;
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(auth.issueTicket).not.toHaveBeenCalled();
  });

  it("returns a desktop ticket and the runtime port after authentication", async () => {
    auth.desktop = true;
    auth.authenticated = true;
    vi.stubEnv("TERMINAL_PORT", "1402");
    expect(await (await GET(request())).json()).toEqual({ ticket: "test-ticket", desktop: true, port: 1402 });
    expect(auth.issueTicket).toHaveBeenCalledOnce();
  });
});
