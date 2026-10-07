/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { ContentRepoReminder } from "./ContentRepoReminder";

let reminder: boolean;
let post: ReturnType<typeof vi.fn<() => Promise<Response>>>;
beforeEach(() => {
  reminder = true;
  post = vi.fn(async () => { reminder = false; return { ok: true, json: async () => ({}) } as Response; });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
    ? post()
    : ({ ok: true, json: async () => ({ contentRepoReminder: reminder }) } as Response)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const renderReminder = () => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><ContentRepoReminder /></SWRConfig>);

describe("ContentRepoReminder", () => {
  it("offers the optional private repo and links straight to that setup step", async () => {
    renderReminder();
    const link = await screen.findByRole("link", { name: "Set up private repo" });
    expect(link.getAttribute("href")).toBe("/setup?step=github");
    expect(screen.getByText(/It's optional/)).toBeTruthy();
  });
  it("goes away after Not now, and records that on the server", async () => {
    renderReminder();
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Set up private repo" })).toBeNull());
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body))).toEqual({ contentRepoReminderDismissed: true });
  });
  it("renders nothing when the server says not to remind", async () => {
    reminder = false;
    const { container } = renderReminder();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
