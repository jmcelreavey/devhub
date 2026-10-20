// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => ({ data: live.data }) }));
const { DigestBanners, digestBanner } = await import("./DigestBanners");

const newest = {
  id: "2026-10-12",
  createdAt: "2026-10-12T07:00:53.970Z",
  headline: "This week: +AppsFlyer · +Expo - 8 arch shifts",
  counts: { added: 40, spread: 23, removed: 2 },
  markdown: "# This week: +AppsFlyer · +Expo - 8 arch shifts\n\n60 repos scanned · Mon, 12 Oct 2026 07:00:53 GMT\n\n## New\n\n- **AppsFlyer** (observability)",
};
const older = { ...newest, id: "2026-10-05", createdAt: "2026-10-05T07:01:54.112Z", headline: "This week: +node-config" };

beforeEach(() => { localStorage.clear(); live.data = { latest: newest, digests: [newest, older] }; });
afterEach(cleanup);

describe("DigestBanners", () => {
  it("shows only the newest digest as plain text, with a dated title and counts", () => {
    render(<DigestBanners />);
    expect(screen.getByText("Capability digest · 12 Oct")).toBeInTheDocument();
    expect(screen.getByText("This week: +AppsFlyer · +Expo - 8 arch shifts")).toBeInTheDocument();
    expect(screen.getByText("40 new · 23 spreading · 2 removed")).toBeInTheDocument();
    expect(screen.queryByText(/node-config/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/\*\*|GMT/);
    expect(screen.getByRole("link", { name: "Open digest" })).toHaveAttribute("href", "/radar#this-week");
  });

  it("does not resurface last week's digest after the newest is dismissed", () => {
    render(<DigestBanners />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss digest" }));
    expect(screen.queryByText(/Capability digest/)).toBeNull();
  });

  it("falls back to the markdown heading without its marks", () => {
    expect(digestBanner({ digests: [{ id: "x", markdown: "# **Big** week\n\nbody" }] }, new Set())).toMatchObject({ headline: "Big week", date: "", counts: "" });
  });
});
