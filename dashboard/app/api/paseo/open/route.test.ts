import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mock = vi.hoisted(() => ({ read: vi.fn(), url: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/agent-runs/store", () => ({ readAgentRun: mock.read }));
vi.mock("@/lib/api-utils", () => ({ requireDashboardAuth: mock.auth }));
vi.mock("@/lib/paseo/client", () => ({ paseoAgentWebUrl: mock.url, paseoUrl: () => "ws://127.0.0.1:6767/ws" }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockReturnValue({ ok: true });
  mock.read.mockReturnValue({ spec: { runtime: "paseo" }, status: { conversationId: "agent-one", connectionId: "ws://127.0.0.1:6767/ws" } });
  mock.url.mockResolvedValue("http://127.0.0.1:6767/h/srv_local/workspace/wks_shared?open=agent%3Aagent-one");
});
const request = () => new NextRequest("http://127.0.0.1:1337/api/paseo/open?run=run-one", { headers: { host: "localhost:1337" } });

describe("Paseo conversation redirects", () => {
  it("preserves the browser's login origin and selects the requested chat", async () => {
    const response = await GET(request());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:6767/h/srv_local/workspace/wks_shared?open=agent%3Aagent-one");
  });
  it("does not look up historical runtime ids in Paseo", async () => {
    mock.read.mockReturnValue({ spec: { runtime: "aionui" }, status: { conversationId: "old-id" } });
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain('target="_top">Back to chats');
    expect(mock.url).not.toHaveBeenCalled();
  });
  it("resolves a chat without navigating the frame through an API response", async () => {
    const req = request();
    req.nextUrl.searchParams.set("format", "json");
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "http://localhost:6767/h/srv_local/workspace/wks_shared?open=agent%3Aagent-one" });
  });
  it("does not open an id against a different daemon", async () => {
    mock.read.mockReturnValue({ spec: { runtime: "paseo" }, status: { conversationId: "agent-one", connectionId: "ws://127.0.0.1:9999/ws" } });
    expect((await GET(request())).status).toBe(409);
    expect(mock.url).not.toHaveBeenCalled();
  });
  it("requires dashboard authentication before looking up a run", async () => {
    mock.auth.mockReturnValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await GET(request())).status).toBe(401);
    expect(mock.read).not.toHaveBeenCalled();
  });
});
