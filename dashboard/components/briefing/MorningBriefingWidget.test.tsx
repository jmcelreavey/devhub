/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MorningBriefingWidget } from "@/components/briefing/MorningBriefingWidget";
import type { WeatherInfo } from "@/lib/morning-briefing";

const mocks = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: () => ({ data: mocks.data, isLoading: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-grid-size", () => ({ useGridSize: () => "default" }));
vi.mock("@/components/briefing/BriefingPlanStatus", () => ({
  BriefingPlanStatus: () => <div data-testid="plan-status" />,
}));
vi.mock("@/components/briefing/BriefingOwnedReposDigest", () => ({
  BriefingOwnedReposDigest: () => null,
}));

const weather: WeatherInfo = {
  location: "Belfast",
  currentTempC: 13.6,
  windKph: 12,
  sunrise: null,
  sunset: null,
  days: [
    { date: "2026-10-12", label: "Today", code: 2, highC: 16.8, lowC: 9.2, description: "Partly cloudy", precipProbability: 10 },
  ],
};

function briefingWith(w: WeatherInfo | undefined) {
  return { ok: true, generatedAt: "2026-10-12T07:00:00Z", briefing: { weather: w } };
}

afterEach(() => {
  cleanup();
  mocks.data = undefined;
});

describe("MorningBriefingWidget collapsed", () => {
  it("shows a compact weather summary in the header and no body", () => {
    mocks.data = briefingWith(weather);
    render(<MorningBriefingWidget collapsed onToggle={() => undefined} />);

    expect(screen.getByText("14°")).toBeTruthy();
    expect(screen.getByText("Partly cloudy")).toBeTruthy();
    expect(screen.getByText("H:17° L:9°")).toBeTruthy();
    // Screen readers get the place, since the visual chip is icon + numbers.
    expect(screen.getByText(/Weather in Belfast/)).toBeTruthy();
    expect(screen.queryByTestId("plan-status")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand Morning briefing" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("hides the summary quietly when the briefing has no weather", () => {
    mocks.data = briefingWith(undefined);
    render(<MorningBriefingWidget collapsed onToggle={() => undefined} />);

    expect(screen.queryByText(/°/)).toBeNull();
    expect(screen.getByText("Morning briefing")).toBeTruthy();
  });

  it("hides the summary while the briefing is unavailable", () => {
    mocks.data = { ok: false, message: "not configured" };
    render(<MorningBriefingWidget collapsed onToggle={() => undefined} />);

    expect(screen.queryByText(/°/)).toBeNull();
    expect(screen.queryByText("not configured")).toBeNull();
  });

  it("does not repeat the summary in the header once expanded", () => {
    mocks.data = briefingWith(weather);
    const { container } = render(<MorningBriefingWidget onToggle={() => undefined} />);

    expect(container.querySelector(".mbw-wx-inline")).toBeNull();
    expect(screen.getByTestId("plan-status")).toBeTruthy();
  });
});
