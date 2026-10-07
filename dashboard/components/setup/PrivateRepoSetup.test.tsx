/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateRepoSetup } from "./PrivateRepoSetup";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
const renderRepo = (ui: ReactNode) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>,
);

vi.mock("@/lib/desktop/bridge", () => ({ isDesktop: () => false, pickFolder: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ directory: "/code/devhub-private", linked: false }),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("private repository onboarding", () => {
  it("explains prerequisites without offering a creation action before sign-in", () => {
    renderRepo(<PrivateRepoSetup connected={false} onLinked={vi.fn()} />);
    expect(screen.getByText(/Sign in above to connect your private repo/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create and connect" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("shows the private-copy action and asks for an explicit click before creating anything", async () => {
    renderRepo(<PrivateRepoSetup connected onLinked={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("New local folder")).toHaveProperty("value", "/code/devhub-private"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/setup/private-repo");
    expect(screen.getByText(/a GitHub fork of a public repo would stay public/)).toBeTruthy();
  });
  it("offers cloning an existing private GitHub repo for a new machine", async () => {
    renderRepo(<PrivateRepoSetup connected onLinked={vi.fn()} />);
    await screen.findByRole("button", { name: "Clone my private repo" });
    fireEvent.click(screen.getByRole("button", { name: "Clone my private repo" }));
    expect(screen.getByLabelText("Private GitHub repository")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clone and connect" })).toBeDisabled();
  });
  it("shows the restart instruction after a successful create request", async () => {
    const onLinked = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, json: async () => ({ directory: "/code/devhub-private", linked: false }),
    } as Response).mockResolvedValueOnce({
      ok: true, json: async () => ({ directory: "/code/devhub-private", url: "https://github.com/test-user/devhub-private" }),
    } as Response);
    renderRepo(<PrivateRepoSetup connected onLinked={onLinked} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create and connect" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Create and connect" }));
    await screen.findByText(/Quit and reopen DevHub/);
    expect(onLinked).toHaveBeenCalledOnce();
    const [, options] = vi.mocked(fetch).mock.calls[1];
    expect(JSON.parse(String(options?.body))).toEqual({ action: "create", name: "devhub-private", directory: "/code/devhub-private" });
  });
  it("keeps the form available and shows an error when privacy validation fails", async () => {
    const onLinked = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, json: async () => ({ directory: "/code/existing", existing: true, linked: false }),
    } as Response).mockResolvedValueOnce({
      ok: false, json: async () => ({ error: "This repository is public." }),
    } as Response);
    renderRepo(<PrivateRepoSetup connected onLinked={onLinked} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect private repo" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Connect private repo" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "This repository is public.");
    expect(onLinked).not.toHaveBeenCalled();
  });
});
