// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderUsage } from "@/lib/agent-usage/types";

const state = vi.hoisted(() => ({ providers: [] as ProviderUsage[] }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => ({ data: { providers: state.providers }, error: undefined, mutate: vi.fn() }) }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ error: vi.fn(), info: vi.fn() }) }));
import Usage from "./usage";

afterEach(cleanup);
const base = { meters: [] as ProviderUsage["meters"], spend: [] as ProviderUsage["spend"] };

describe("unavailable provider cards", () => {
  it("leads with a headline and the one command, with the long text behind Details", () => {
    state.providers = [{ ...base, id: "claude", name: "Claude", status: "unavailable", summary: "Claude's sign-in has expired", command: "claude auth login", message: "Claude Code's sign-in has expired. Run `claude auth login` in DevHub's terminal, then retry." }];
    render(<Usage />);
    const card = screen.getByRole("region", { name: "Claude usage" });
    expect(card.textContent).toContain("Claude's sign-in has expired");
    expect(card.querySelector("code")?.textContent).toBe("claude auth login");
    expect(screen.getByRole("button", { name: "Copy claude auth login" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry Claude usage" })).toBeTruthy();
    const details = card.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain("Run");
    // Backticks never reach the screen as literal characters.
    expect(card.textContent).not.toContain("`");
  });
  it("shows a short reason for a failure behind Details", () => {
    state.providers = [{ ...base, id: "zai", name: "z.ai", status: "error", summary: "Couldn't load z.ai usage", message: "Couldn't load z.ai usage. Try again.", reason: "z.ai rejected the API key (HTTP 401)." }];
    render(<Usage />);
    const details = screen.getByRole("region", { name: "z.ai usage" }).querySelector("details");
    expect(details?.textContent).toContain("z.ai rejected the API key (HTTP 401).");
  });
  it("falls back to the message when a provider has no summary", () => {
    state.providers = [{ ...base, id: "copilot", name: "GitHub Copilot", status: "unavailable", message: "Sign in with `gh auth login`." }];
    render(<Usage />);
    expect(screen.getByRole("region", { name: "GitHub Copilot usage" }).textContent).toContain("Sign in with `gh auth login`.");
  });
});
