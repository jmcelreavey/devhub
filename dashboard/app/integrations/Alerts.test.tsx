/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Alerts from "./Alerts";
import type { Destination } from "@/lib/integrations/alert-types";
const mutate = vi.fn(async () => undefined);
let destinations: Omit<Destination, "credentialHash">[];
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => ({ data: { profile: "work", destinations, outbox: [] }, mutate }) }));
beforeEach(() => { mutate.mockClear(); destinations = [{ id: "11111111-1111-4111-8111-111111111111", label: "Work chat", provider: "telegram", credentialRef: "DEVHUB_TELEGRAM_TOKEN", chatId: "7", workProfile: "work", events: ["approval-ready"], enabled: true, revision: 1, consentAt: "2026-10-10T10:00:00Z" }]; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("alert test controls", () => {
  it.each(["telegram", "slack"] as const)("shows an explicit %s test send and success without sending on render", async (provider) => {
    destinations[0].provider = provider;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ delivery: { state: "sent", detail: "Accepted." } })));
    vi.stubGlobal("fetch", fetcher); render(<Alerts />);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send test message" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Test message sent to Work chat");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ action: "test", id: destinations[0].id, revision: 1 });
    expect(fetcher.mock.calls[0][1].body).not.toContain("credentialRef"); expect(mutate).toHaveBeenCalledTimes(1);
  });
  it("disables repeated clicks while the test is sending", async () => {
    let finish: (response: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }))); render(<Alerts />);
    fireEvent.click(screen.getByRole("button", { name: "Send test message" }));
    expect(screen.getByRole("button", { name: "Sending test…" })).toBeDisabled();
    finish(new Response(JSON.stringify({ delivery: { state: "sent" } })));
    await screen.findByRole("status");
  });
  it("shows uncertainty and refreshes the durable delivery result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ delivery: { state: "unknown", detail: "Check the channel before retrying; a duplicate is possible." } })))); render(<Alerts />);
    fireEvent.click(screen.getByRole("button", { name: "Send test message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Work chat: Check the channel");
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  });
  it("reuses the request ID after uncertain transport instead of creating another send", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("Connection interrupted. Check recent deliveries.")).mockResolvedValueOnce(new Response(JSON.stringify({ delivery: { state: "sent" } })));
    vi.stubGlobal("fetch", fetcher); render(<Alerts />);
    fireEvent.click(screen.getByRole("button", { name: "Send test message" })); await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "Send test message" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Send test message" })); await screen.findByRole("status");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).requestId).toBe(JSON.parse(fetcher.mock.calls[1][1].body).requestId);
  });
  it("does not offer test sends for revoked consent", () => {
    destinations[0].enabled = false; render(<Alerts />);
    expect(screen.queryByRole("button", { name: "Send test message" })).toBeNull();
  });
});
