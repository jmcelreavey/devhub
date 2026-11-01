import { expect, it, vi } from "vitest";
import { removeTerminalSession, upsertTerminalSession } from "../../../../lib/terminal/sessions-registry";
import { POST } from "./route";

vi.mock("../../../../lib/terminal/sessions-registry", () => ({
  listRegisteredTerminalSessions: vi.fn(() => []),
  removeTerminalSession: vi.fn(),
  upsertTerminalSession: vi.fn(),
}));

it("keeps dock heartbeat validation, defaults and removal", async () => {
  const request = (body: object) => new Request("http://localhost:1447/api/terminal/sessions", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  });
  expect((await POST(request({ tabId: 1 }))).status).toBe(400);
  expect(upsertTerminalSession).not.toHaveBeenCalled();
  expect((await POST(request({ tabId: 1, label: "  fixture  " }))).status).toBe(200);
  expect(upsertTerminalSession).toHaveBeenCalledWith(expect.objectContaining({
    tabId: 1, label: "fixture", sessionId: null, status: "connecting", busy: false,
  }));
  expect((await POST(request({ tabId: 1, remove: true }))).status).toBe(200);
  expect(removeTerminalSession).toHaveBeenCalledExactlyOnceWith(1);
});
