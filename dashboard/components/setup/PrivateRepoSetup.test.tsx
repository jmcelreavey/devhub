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

const gitPresent = { present: true, version: "git version 2.43.0", where: "Ubuntu (WSL terminal)", installCommand: null, installUrl: "https://git-scm.com/downloads" };
const gitMissing = { present: false, version: null, where: "Ubuntu (WSL terminal)", installCommand: "sudo apt-get update && sudo apt-get install -y git", installUrl: "https://git-scm.com/downloads" };
let git: typeof gitPresent | typeof gitMissing;
let repoStatus: Record<string, unknown>;
let post: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

beforeEach(() => {
  git = gitPresent;
  repoStatus = { directory: "/code/devhub-private", linked: false };
  post = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return post(url, init);
    const body = url === "/api/setup/git" ? git : repoStatus;
    return { ok: true, json: async () => body } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
/** The leading action, not the same-named choices inside the alternatives disclosure. */
const primary = (name: string | RegExp) => screen.queryAllByRole("button", { name }).filter((button) => !button.closest("details"))[0] ?? null;
const openAlternatives = () => fireEvent.click(screen.getByText(/Use a different name or folder/));

describe("private repository onboarding", () => {
  it("is optional and says DevHub works without it, even before signing in", async () => {
    renderRepo(<PrivateRepoSetup connected={false} onLinked={vi.fn()} />);
    expect(screen.getByText("Optional")).toBeTruthy();
    expect(screen.getByText(/works fully on this PC without it/)).toBeTruthy();
    expect(screen.getByText(/Sign in with GitHub above to connect a private repo/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create my private DevHub repo" })).toBeNull();
    expect(fetch).not.toHaveBeenCalledWith("/api/setup/private-repo");
  });
  it("lets the user step away with Do this later", async () => {
    const onLater = vi.fn();
    renderRepo(<PrivateRepoSetup connected={false} onLinked={vi.fn()} onLater={onLater} />);
    fireEvent.click(screen.getByRole("button", { name: "Do this later" }));
    expect(onLater).toHaveBeenCalledOnce();
  });
  it("creates the private repo with one click using the defaults", async () => {
    const onLinked = vi.fn();
    post.mockResolvedValue({ ok: true, json: async () => ({ directory: "/code/devhub-private", url: "https://github.com/test-user/devhub-private" }) } as Response);
    renderRepo(<PrivateRepoSetup connected onLinked={onLinked} />);
    const create = await screen.findByRole("button", { name: "Create my private DevHub repo" });
    await waitFor(() => expect(create).not.toBeDisabled());
    expect(screen.getByText(/a fork of a public repo would/)).toBeTruthy();
    fireEvent.click(create);
    await screen.findByText(/Quit and reopen DevHub/);
    expect(onLinked).toHaveBeenCalledOnce();
    expect(JSON.parse(String(post.mock.calls[0][1].body))).toEqual({ action: "create", name: "devhub-private", directory: "/code/devhub-private" });
  });
  it("offers cloning an existing private GitHub repo for a new machine", async () => {
    renderRepo(<PrivateRepoSetup connected onLinked={vi.fn()} />);
    await screen.findByRole("button", { name: "Create my private DevHub repo" });
    openAlternatives();
    fireEvent.click(screen.getByRole("button", { name: "Clone my private repo" }));
    expect(screen.getByLabelText("Private GitHub repository")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clone and connect" })).toBeDisabled();
  });
  it("keeps the options available and shows an error when privacy validation fails", async () => {
    repoStatus = { directory: "/code/existing", existing: true, folderExists: true, linked: false };
    post.mockResolvedValue({ ok: false, json: async () => ({ error: "This repository is public." }) } as Response);
    const onLinked = vi.fn();
    renderRepo(<PrivateRepoSetup connected onLinked={onLinked} />);
    const link = await screen.findByRole("button", { name: "Link my existing checkout" });
    await waitFor(() => expect(link).not.toBeDisabled());
    fireEvent.click(link);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "This repository is public.");
    expect(onLinked).not.toHaveBeenCalled();
    expect(JSON.parse(String(post.mock.calls[0][1].body))).toEqual({ action: "link", directory: "/code/existing" });
  });
});

describe("when the defaults are already taken", () => {
  const remote = { repository: "test-user/devhub-private", exists: true, isPrivate: true, empty: false };
  const suggestion = { name: "devhub-private-2", directory: "/code/devhub-private-2" };

  it("makes cloning the primary action, pre-filled, when the repo exists on GitHub", async () => {
    repoStatus = { directory: "/code/devhub-private", linked: false, folderExists: false, existing: false, remote, suggestion };
    post.mockResolvedValue({ ok: true, json: async () => ({ directory: "/code/devhub-private", url: "https://github.com/test-user/devhub-private" }) } as Response);
    renderRepo(<PrivateRepoSetup connected onLinked={vi.fn()} />);
    await waitFor(() => expect(primary("Clone my private repo")).not.toBeNull());
    const clone = primary("Clone my private repo")!;
    expect(screen.queryByRole("button", { name: "Create my private DevHub repo" })).toBeNull();
    expect(screen.getByText(/You already have/)).toBeTruthy();
    fireEvent.click(clone);
    await screen.findByText(/Quit and reopen DevHub/);
    expect(JSON.parse(String(post.mock.calls[0][1].body))).toEqual({ action: "clone", directory: "/code/devhub-private", repository: "test-user/devhub-private" });
  });
  it("pre-selects the clone form in the alternatives too", async () => {
    repoStatus = { directory: "/code/devhub-private", linked: false, remote, suggestion };
    renderRepo(<PrivateRepoSetup connected onLinked={vi.fn()} />);
    await waitFor(() => expect(primary("Clone my private repo")).not.toBeNull());
    openAlternatives();
    expect((screen.getByLabelText("Private GitHub repository") as HTMLInputElement).value).toBe("test-user/devhub-private");
  });
  it("offers a free name that creates a new repo in its own folder", async () => {
    repoStatus = { directory: "/code/devhub-private", linked: false, remote, suggestion };
    post.mockResolvedValue({ ok: true, json: async () => ({ directory: suggestion.directory, url: "https://github.com/test-user/devhub-private-2" }) } as Response);
    renderRepo(<PrivateRepoSetup connected onLinked={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create a new private repo named devhub-private-2 instead" }));
    await screen.findByText(/Quit and reopen DevHub/);
    expect(JSON.parse(String(post.mock.calls[0][1].body))).toEqual({ action: "create", directory: suggestion.directory, name: "devhub-private-2" });
  });
  it("hides the one-click create when a folder is in the way, and says why", async () => {
    repoStatus = { directory: "/code/devhub-private", linked: false, folderExists: true, existing: false, remote: { ...remote, exists: false }, suggestion };
    renderRepo(<PrivateRepoSetup connected onLinked={vi.fn()} />);
    expect((await screen.findByRole("status")).textContent).toMatch(/folder already exists at \/code\/devhub-private/);
    expect(screen.queryByRole("button", { name: "Create my private DevHub repo" })).toBeNull();
    expect(primary("Clone my private repo")).toBeNull();
    expect(screen.getByRole("button", { name: /named devhub-private-2 instead/ })).toBeTruthy();
  });
  it("leads with Link when a checkout exists, even if the repo is also on GitHub", async () => {
    repoStatus = { directory: "/code/devhub-private", linked: false, folderExists: true, existing: true, remote, suggestion };
    renderRepo(<PrivateRepoSetup connected onLinked={vi.fn()} />);
    await screen.findByRole("button", { name: "Link my existing checkout" });
    expect(screen.queryByRole("button", { name: "Create my private DevHub repo" })).toBeNull();
    expect(primary("Clone my private repo")).toBeNull();
  });
  it("switches the primary action after Re-check sees the repo", async () => {
    repoStatus = { directory: "/code/devhub-private", linked: false };
    renderRepo(<PrivateRepoSetup connected onLinked={vi.fn()} />);
    await screen.findByRole("button", { name: "Create my private DevHub repo" });
    repoStatus = { directory: "/code/devhub-private", linked: false, remote };
    openAlternatives();
    fireEvent.click(screen.getByRole("button", { name: /Re-check$/ }));
    await waitFor(() => expect(primary("Clone my private repo")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Create my private DevHub repo" })).toBeNull();
  });
  it("treats an empty private repo as free, so the one-click create still works", async () => {
    repoStatus = { directory: "/code/devhub-private", linked: false, remote: { ...remote, empty: true } };
    renderRepo(<PrivateRepoSetup connected onLinked={vi.fn()} />);
    await screen.findByRole("button", { name: "Create my private DevHub repo" });
  });
});

describe("without Git", () => {
  it("shows the install command with a copy button and a re-check instead of the create action", async () => {
    git = gitMissing;
    renderRepo(<PrivateRepoSetup connected onLinked={vi.fn()} />);
    expect(await screen.findByText("Git isn't installed yet")).toBeTruthy();
    expect(screen.getByText(gitMissing.installCommand)).toBeTruthy();
    expect(screen.getByText(/Run this in Ubuntu \(WSL terminal\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copy install command/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create my private DevHub repo" })).toBeNull();
    // Installed in a terminal, then re-checked.
    git = gitPresent;
    fireEvent.click(screen.getByRole("button", { name: /Re-check Git/ }));
    expect(await screen.findByRole("button", { name: "Create my private DevHub repo" })).toBeTruthy();
  });
  it("points to the download page where no command fits", async () => {
    git = { ...gitMissing, installCommand: null } as unknown as typeof gitMissing;
    renderRepo(<PrivateRepoSetup connected={false} onLinked={vi.fn()} />);
    expect((await screen.findByText(/Install it from/)).textContent).toContain("git-scm.com/downloads");
  });
});
