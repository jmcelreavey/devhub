/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TeamSlackSettings } from "./TeamSlackSettings";
import type { SlackStatus } from "@/lib/integrations/slack/shared";

const pending: SlackStatus = {
  configured: true, settings: { mode: "gateway", gatewayUrl: "https://gateway.test", botToken: "", appToken: "", channelId: "", teamId: "", allowedUserId: "" },
  revision: "pending", profile: "work", connection: { state: "connecting", message: "Confirm in Setup" },
  gateway: { deviceId: "device-one", url: "https://gateway.test", revoked: false, pending: true, binding: { deviceId: "device-one", userId: "U1", userName: "one", teamId: "T1", dmChannelId: "D1" } },
};
const status: SlackStatus = { configured: false, revision: "revision", profile: "work", settings: { mode: "gateway", gatewayUrl: "https://gateway.test", botToken: "", appToken: "", teamId: "", allowedUserId: "", channelId: "" }, connection: { state: "connecting", message: "Connecting" } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("connects in one click without requesting or submitting any Slack credentials", async () => {
  const changed = vi.fn(async () => {});
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(status))); vi.stubGlobal("fetch", fetcher);
  render(<TeamSlackSettings status={status} changed={changed} persist={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect to team Slack" }));
  await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(status));
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ action: "connect", url: "https://gateway.test" });
  expect(screen.queryByLabelText("Bot token")).not.toBeInTheDocument();
});
it("shows the one-time DM instruction, expiry and revoked states", () => {
  const props = { changed: vi.fn(async () => {}), persist: vi.fn() };
  const view = render(<TeamSlackSettings {...props} status={{ ...status, gateway: { deviceId: "device", url: "https://gateway.test", code: "ABCD2345", expiresAt: Date.now() + 600000, revoked: false } }} />);
  expect(screen.getByText("link ABCD2345")).toBeInTheDocument();
  expect(screen.getByText(/Waiting for you to link/)).toBeInTheDocument();
  view.rerender(<TeamSlackSettings {...props} status={{ ...status, gateway: { deviceId: "device", url: "https://gateway.test", expiresAt: 1, revoked: false } }} />);
  expect(screen.getByText(/That link code expired/)).toBeInTheDocument();
  view.rerender(<TeamSlackSettings {...props} status={{ ...status, gateway: { deviceId: "device", url: "https://gateway.test", revoked: true } }} />);
  expect(screen.getByText(/This device is unlinked/)).toBeInTheDocument();
});
it("shows linked identity, reconnecting status and one-click unlink", async () => {
  const linked: SlackStatus = { ...status, configured: true, connection: { state: "reconnecting", message: "Reconnecting" }, gateway: { deviceId: "device", url: "https://gateway.test", revoked: false, pending: false, binding: { deviceId: "device", teamId: "T1", userId: "U1", userName: "one", dmChannelId: "D1" } } };
  const changed = vi.fn(async () => {}); const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(status))); vi.stubGlobal("fetch", fetcher);
  const persist = vi.fn(async () => {});
  render(<TeamSlackSettings status={linked} changed={changed} persist={persist} />);
  expect(screen.getByText(/Linked as @one. Reconnecting/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Post agent progress to Slack" }));
  await vi.waitFor(() => expect(persist).toHaveBeenCalledWith({ postProgress: false }));
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "Unlink" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
  await vi.waitFor(() => expect(changed).toHaveBeenCalled());
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ action: "unlink" });
});
it("shows a retryable error instead of pretending an uncertain connection succeeded", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Gateway offline" }), { status: 502 })));
  const changed = vi.fn(async () => {});
  render(<TeamSlackSettings status={status} changed={changed} persist={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect to team Slack" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Gateway offline"); expect(changed).not.toHaveBeenCalled();
});

it.each([['Yes, that\'s me (@one)', "confirm"], ["Not me — unlink", "unlink"]])("%s sends exactly one local action", async (label, action) => {
  const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(pending), { status: 200 })); vi.stubGlobal("fetch", request);
  render(<TeamSlackSettings status={pending} changed={vi.fn(async () => {})} persist={vi.fn(async () => {})} />);
  expect(screen.getByRole("status").textContent).toContain("Slack messages stay blocked");
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(JSON.parse(request.mock.calls[0]?.[1]?.body as string)).toEqual(action === "confirm" ? { action, deviceId: "device-one", userId: "U1" } : { action });
});
