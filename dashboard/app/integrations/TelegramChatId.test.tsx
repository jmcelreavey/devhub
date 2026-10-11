/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TelegramChatId from "./TelegramChatId";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Telegram setup helpers", () => {
  it("links to setup and fetches IDs only after an explicit click, then lets the user choose", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ chats: [{ chatId: "7", type: "private", userId: "7" }, { chatId: "-100123", type: "supergroup" }] })));
    vi.stubGlobal("fetch", fetcher); const onChange = vi.fn();
    render(<TelegramChatId credentialRef="DEVHUB_TELEGRAM_TOKEN" chatId="" onChange={onChange} disabled={false} />);
    expect(screen.getByRole("link", { name: "How to set up Telegram" })).toHaveAttribute("href", "/docs/guides/integrations#telegram-setup");
    expect(fetcher).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Find my chat ID" }));
    const select = await screen.findByRole("combobox", { name: "Chats found" });
    expect(onChange).not.toHaveBeenCalled(); fireEvent.change(select, { target: { value: "-100123" } }); expect(onChange).toHaveBeenCalledWith("-100123");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ credentialRef: "DEVHUB_TELEGRAM_TOKEN" });
  });
  it("explains an empty update queue without changing the entered ID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"chats":[]}'))); const onChange = vi.fn();
    render(<TelegramChatId credentialRef="BOT" chatId="7" onChange={onChange} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Find my chat ID" }));
    expect(await screen.findByRole("status")).toHaveTextContent("No chats found"); expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: /Telegram chat ID/ })).toHaveValue("7");
  });
  it("shows active-webhook errors while keeping manual entry available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"A Telegram webhook is already active. Enter the chat ID manually."}', { status: 409 })));
    render(<TelegramChatId credentialRef="BOT" chatId="" onChange={vi.fn()} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Find my chat ID" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("webhook is already active");
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Telegram chat ID/ })).not.toBeDisabled());
  });
  it("cannot fetch using a pasted token instead of a variable name", () => {
    render(<TelegramChatId credentialRef="123456:abcdefghijklmnopqrstuvwxyz" chatId="" onChange={vi.fn()} disabled={false} />);
    expect(screen.getByRole("button", { name: "Find my chat ID" })).toBeDisabled();
  });
});
