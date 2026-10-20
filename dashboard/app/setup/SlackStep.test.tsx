/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackStatus } from "@/lib/integrations/slack/shared";
import { SlackStep } from "./SlackStep";

const live = vi.hoisted(() => ({ data: undefined as SlackStatus | undefined, error: undefined as Error | undefined, mutate: vi.fn() }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => live }));
const empty: SlackStatus = {
  configured: false, settings: { botToken: "", appToken: "", channelId: "", allowedUserId: "", teamId: "" },
  revision: "a".repeat(64), profile: "work", connection: { state: "not-configured", message: "Not connected. Add the tokens, channel ID and your member ID in Setup." },
};
const configured: SlackStatus = {
  ...empty, configured: true, settings: { botToken: "••••••••", appToken: "••••••••", channelId: "CCHANNEL", allowedUserId: "UOWNER", teamId: "TTEAM" },
  connection: { state: "connected", message: "Connected as @DevHub in CCHANNEL" },
};

beforeEach(() => {
  live.data = structuredClone(empty); live.error = undefined;
  live.mutate.mockReset().mockImplementation(async (next: SlackStatus) => { if (next) live.data = next; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Slack Setup", () => {
  it("shows one manifest link, five settings, an unconfigured status and no automatic sends", () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<SlackStep />);
    const link = screen.getByRole("link", { name: "Create Slack app" });
    expect(JSON.parse(new URL(link.getAttribute("href")!).searchParams.get("manifest_json")!)).toMatchObject({ settings: { socket_mode_enabled: true } });
    for (const label of ["Bot token", "App-level token", "Channel ID", "Your Slack member ID", "Workspace ID (optional)"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByLabelText("Bot token")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Send test" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Not connected");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("saves in place, replaces typed tokens with masks and enables Send test", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(configured)));
    vi.stubGlobal("fetch", fetcher); render(<SlackStep />);
    fireEvent.change(screen.getByLabelText("Bot token"), { target: { value: "xoxb-fake" } });
    fireEvent.change(screen.getByLabelText("App-level token"), { target: { value: "xapp-private-app" } });
    fireEvent.change(screen.getByLabelText("Channel ID"), { target: { value: "CCHANNEL" } });
    fireEvent.change(screen.getByLabelText("Your Slack member ID"), { target: { value: "UOWNER" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Slack settings" }));
    await screen.findByText("Saved. No DevHub restart needed.");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/integrations/slack/settings");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ botToken: "xoxb-fake", channelId: "CCHANNEL" });
    expect(screen.getByLabelText("Bot token")).toHaveValue("••••••••");
    expect(screen.getByRole("button", { name: "Send test" })).toBeEnabled();
    expect(document.body).not.toHaveTextContent("xoxb-fake");
  });
  it("validates before sending settings", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); render(<SlackStep />);
    fireEvent.change(screen.getByLabelText("Bot token"), { target: { value: "xoxp-human" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Slack settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("xoxb-");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("defaults Needs you posting on and saves the toggle in one click without sending draft secrets", async () => {
    live.data = structuredClone(configured);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...configured, settings: { ...configured.settings, postNeedsYou: false } })));
    vi.stubGlobal("fetch", fetcher); render(<SlackStep />);
    fireEvent.change(screen.getByLabelText("Bot token"), { target: { value: "xoxb-new" } });
    const checkbox = screen.getByRole("checkbox", { name: "Post Needs you to Slack" });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    await screen.findByText("Needs you posts are off. Existing threads still work.");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ postNeedsYou: false });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByLabelText("Bot token")).toHaveValue("xoxb-new");
  });
  it("keeps the saved toggle after an error and shows a retryable failure", async () => {
    live.data = { ...configured, settings: { ...configured.settings, postNeedsYou: false } };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Could not save Slack settings.")));
    render(<SlackStep />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Post Needs you to Slack" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save Slack settings.");
    expect(screen.getByRole("checkbox", { name: "Post Needs you to Slack" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Post Needs you to Slack" })).toBeEnabled();
  });
  it("defaults progress on and saves only that preference without sending draft credentials", async () => {
    live.data = structuredClone(configured);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...configured, settings: { ...configured.settings, postProgress: false } })));
    vi.stubGlobal("fetch", fetcher); render(<SlackStep />);
    fireEvent.change(screen.getByLabelText("Bot token"), { target: { value: "xoxb-new" } });
    const checkbox = screen.getByRole("checkbox", { name: "Post agent progress to Slack" });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    await screen.findByText("Agent progress posts are off. Existing threads still work.");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ postProgress: false });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Post Needs you to Slack" })).toBeChecked();
    expect(screen.getByLabelText("Bot token")).toHaveValue("xoxb-new");
  });
  it("keeps the saved progress preference if saving fails", async () => {
    live.data = { ...configured, settings: { ...configured.settings, postProgress: false } };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Could not save Slack settings.")));
    render(<SlackStep />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Post agent progress to Slack" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save Slack settings.");
    expect(screen.getByRole("checkbox", { name: "Post agent progress to Slack" })).not.toBeChecked();
  });
  it("only reveals newly typed tokens and keeps saved tokens blank on focus", () => {
    live.data = structuredClone(configured); render(<SlackStep />);
    fireEvent.focus(screen.getByLabelText("Bot token"));
    expect(screen.getByLabelText("Bot token")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Send test" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Bot token"), { target: { value: "xoxb-new" } });
    fireEvent.click(screen.getByRole("button", { name: "Show Bot token" }));
    expect(screen.getByLabelText("Bot token")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("App-level token")).toHaveValue("••••••••");
  });
  it("sends once on click, with saved settings revision and no secret or recipient overrides", async () => {
    live.data = structuredClone(configured);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ delivery: { state: "sent", detail: "Test sent. Ask “help” in the Slack channel." } })));
    vi.stubGlobal("fetch", fetcher); render(<SlackStep />);
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByRole("button", { name: "Test sent" })).toBeDisabled();
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ revision: configured.revision, requestId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reuses the test request ID after uncertain transport and displays the recorded outcome", async () => {
    live.data = structuredClone(configured);
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(new Response(JSON.stringify({ delivery: { state: "unknown", detail: "Check the channel; this request will not be sent again." } })));
    vi.stubGlobal("fetch", fetcher); render(<SlackStep />);
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "Send test" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await screen.findByRole("button", { name: "Check test outcome" });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).requestId).toBe(JSON.parse(fetcher.mock.calls[1][1].body).requestId);
    expect(screen.getByRole("alert")).toHaveTextContent("Check the channel");
  });
  it("disables tests for unsaved destination changes and does not overwrite a draft on polling", () => {
    live.data = structuredClone(configured);
    const rendered = render(<SlackStep />);
    fireEvent.change(screen.getByLabelText("Channel ID"), { target: { value: "CNEW" } });
    live.data = { ...configured, connection: { state: "reconnecting", message: "Reconnecting to Slack…" } };
    rendered.rerender(<SlackStep />);
    expect(screen.getByLabelText("Channel ID")).toHaveValue("CNEW");
    expect(screen.getByRole("button", { name: "Send test" })).toBeDisabled();
  });
  it("offers explicit disconnect without deleting Slack messages", async () => {
    live.data = structuredClone(configured);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(empty)));
    vi.stubGlobal("fetch", fetcher); render(<SlackStep />);
    fireEvent.click(screen.getByText("Remove connection"));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Slack" }));
    await screen.findByText("Slack disconnected. Saved tokens removed.");
    expect(fetcher.mock.calls[0][1].body).toBe("null");
    expect(screen.getByLabelText("Bot token")).toHaveValue("");
  });
  it("shows content-shaped loading and a retry for failed reads", () => {
    live.data = undefined;
    const rendered = render(<SlackStep />);
    expect(screen.getByRole("region", { name: "Slack setup" })).toHaveAttribute("aria-busy", "true");
    live.error = new Error("offline"); rendered.rerender(<SlackStep />);
    expect(screen.getByText("Could not read Slack settings.")).toBeInTheDocument();
  });
  it("keeps direct as the default and reveals Team Slack without sending credentials", () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); render(<SlackStep />);
    expect(screen.getByRole("button", { name: "Just me (direct)" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Team Slack (gateway)" }));
    expect(screen.getByLabelText("Gateway URL")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bot token")).not.toBeInTheDocument(); expect(fetcher).not.toHaveBeenCalled();
  });
});
