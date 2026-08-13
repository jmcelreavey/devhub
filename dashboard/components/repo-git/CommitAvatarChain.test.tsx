/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommitAvatar } from "./CommitAvatar";

/**
 * Covers the ordering of the avatar chain and its fallbacks. The chain is the
 * part with real behaviour — which source wins, and what happens when one
 * fails — and it is the part a browser pass caught a bug in.
 */

function avatarImg(): HTMLImageElement | null {
  return document.querySelector<HTMLImageElement>(".repo-git-avatar-img");
}

beforeEach(() => {
  // jsdom has no SubtleCrypto. Stub a fixed digest so the Gravatar candidate is
  // built deterministically rather than silently skipped.
  vi.stubGlobal("crypto", {
    subtle: {
      digest: async () => new Uint8Array(32).fill(0xab).buffer,
    },
  });
});

describe("CommitAvatar source chain", () => {
  it("prefers GitHub's own attribution over anything derived locally", async () => {
    render(
      <CommitAvatar
        author="Dave McIlhagga"
        email="dmcilhagga@insider.com"
        resolvedUrl="https://avatars.githubusercontent.com/u/310578580?v=4"
      />,
    );
    // A private work address has no Gravatar, so without the resolved URL this
    // author could only ever be initials.
    await waitFor(() => expect(avatarImg()?.src).toContain("avatars.githubusercontent.com/u/310578580"));
  });

  it("asks GitHub for the size it renders at", async () => {
    render(
      <CommitAvatar
        author="A"
        email="a@example.com"
        size={18}
        resolvedUrl="https://avatars.githubusercontent.com/u/1?v=4"
      />,
    );
    await waitFor(() => expect(avatarImg()?.src).toContain("s=36"));
  });

  it("derives the avatar from a GitHub noreply address with no resolved map", async () => {
    render(<CommitAvatar author="" email="68432290+Svetlana-Leonova@users.noreply.github.com" />);
    await waitFor(() => expect(avatarImg()?.src).toContain("avatars.githubusercontent.com/u/68432290"));
  });

  it("falls back to Gravatar for an ordinary address", async () => {
    render(<CommitAvatar author="John McElreavey" email="j.mcelreavey@gmail.com" />);
    await waitFor(() => expect(avatarImg()?.src).toContain("gravatar.com/avatar/"));
    // d=404 keeps a third-party placeholder from masquerading as a real avatar.
    expect(avatarImg()?.src).toContain("d=404");
  });

  it("steps to the next candidate when one fails, then to initials", async () => {
    render(
      <CommitAvatar
        author="Scott Fischer"
        email="scott-fischer@users.noreply.github.com"
        resolvedUrl="https://avatars.githubusercontent.com/u/8835133?v=4"
      />,
    );
    await waitFor(() => expect(avatarImg()).not.toBeNull());

    // First candidate fails — the derived noreply URL should take over. The
    // login arrives lowercased because the log parser lowercases the whole
    // address; GitHub's profile URLs are case-insensitive, so it still resolves.
    avatarImg()!.dispatchEvent(new Event("error"));
    await waitFor(() => expect(avatarImg()?.src).toContain("github.com/scott-fischer.png"));

    // Exhaust the rest; the disc underneath is what is left.
    for (let i = 0; i < 3 && avatarImg(); i += 1) {
      avatarImg()!.dispatchEvent(new Event("error"));
      await waitFor(() => true);
    }
    await waitFor(() => expect(avatarImg()).toBeNull());
    expect(screen.getByText("SF")).toBeTruthy();
  });

  it("shows initials immediately, before any network result", () => {
    render(<CommitAvatar author="Dawin Camilo Cortés" email="dcamilo@insider.com" />);
    // Rendered synchronously: there is never a frame with an empty circle, which
    // is what keeps the column stable offline.
    expect(screen.getByText("DC")).toBeTruthy();
  });

  it("accepts an Atlassian avatar CDN URL", async () => {
    render(
      <CommitAvatar
        author="Ada"
        email="ada@example.com"
        resolvedUrl="https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/N48x48/ada.png"
      />,
    );
    await waitFor(() => expect(avatarImg()?.src).toContain("atl-paas.net"));
  });

  it("ignores a resolved URL that is not on a trusted avatar CDN", async () => {
    render(
      <CommitAvatar author="A" email="a@example.com" resolvedUrl="https://evil.test/a.png" />,
    );
    await waitFor(() => expect(avatarImg()).not.toBeNull());
    expect(avatarImg()?.src).not.toContain("evil.test");
  });

  it("uses a late-arriving resolved URL even after Gravatar already 404'd", async () => {
    // Graph rows mount before `/git/people`. They try Gravatar, it 404s, then
    // the identity map arrives with a GitHub URL. That miss used to stick, so
    // the list stayed on initials while detail (mounted after the map) showed
    // the photo.
    const { rerender } = render(
      <CommitAvatar author="JustinFerrara" email="justin.p.ferrara@gmail.com" />,
    );
    await waitFor(() => expect(avatarImg()?.src).toContain("gravatar.com/avatar/"));
    avatarImg()!.dispatchEvent(new Event("error"));
    await waitFor(() => expect(avatarImg()).toBeNull());
    expect(screen.getByText("JU")).toBeTruthy();

    rerender(
      <CommitAvatar
        author="JustinFerrara"
        email="justin.p.ferrara@gmail.com"
        resolvedUrl="https://avatars.githubusercontent.com/u/14058449?v=4"
      />,
    );
    await waitFor(() =>
      expect(avatarImg()?.src).toContain("avatars.githubusercontent.com/u/14058449"),
    );
  });

  it("becomes a button when enlargeable and a photo URL resolved", async () => {
    render(
      <CommitAvatar
        author="Ada"
        email="ada@example.com"
        enlargeable
        resolvedUrl="https://avatars.githubusercontent.com/u/1?v=4"
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "View photo of Ada" })).toBeTruthy(),
    );
  });

  it("falls the lightbox back to the thumbnail when full-res 404s", async () => {
    render(
      <CommitAvatar
        author="Ada"
        email="ada@example.com"
        enlargeable
        resolvedUrl="https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/N48x48/ada.png"
      />,
    );
    const button = await waitFor(() => screen.getByRole("button", { name: "View photo of Ada" }));
    button.click();
    const full = await waitFor(() => {
      const img = document.querySelector<HTMLImageElement>(".repo-git-avatar-full");
      expect(img?.src).toContain("/N512x512/");
      return img!;
    });
    full.dispatchEvent(new Event("error"));
    await waitFor(() =>
      expect(document.querySelector<HTMLImageElement>(".repo-git-avatar-full")?.src).toContain(
        "/N48x48/",
      ),
    );
  });

  it("stays a plain disc when enlargeable but only initials are available", () => {
    render(<CommitAvatar author="Ada" email="" enlargeable />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("AD")).toBeTruthy();
  });
});
