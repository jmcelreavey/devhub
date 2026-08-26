/** @vitest-environment jsdom */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TodayRepSignal } from "@/components/today/TodayRepSignal";
import type { RepsApiPayload } from "@/lib/reps-shared";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const payloads = new Map<string, RepsApiPayload>();

vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: (key: string) => ({ data: payloads.get(key), error: undefined }),
}));

function setPayload(payload: RepsApiPayload) {
  payloads.set("/api/reps", payload);
}

afterEach(cleanup);

describe("TodayRepSignal", () => {
  it("invites a start when no rep exists yet", () => {
    setPayload({ rep: null, stats: { streak: 0, completedCount: 0, recent: [] } });
    render(<TodayRepSignal />);
    const chip = screen.getByRole("link", { name: /start today's rep/i });
    expect(chip.getAttribute("href")).toBe("/review/rep");
  });

  it("teases the in-progress rep with kind-specific copy", () => {
    setPayload({
      rep: {
        date: "2026-08-26",
        attempt: 0,
        startedAt: "2026-08-26T09:00:00Z",
        kind: "cold-read",
        material: {
          kind: "cold-read",
          repo: "org/service",
          sha: "abc123",
          committedAt: "2026-08-25T10:00:00Z",
          additions: 20,
          deletions: 4,
          filesChanged: 1,
        },
      },
      stats: { streak: 2, completedCount: 5, recent: [] },
    });
    render(<TodayRepSignal />);
    const chip = screen.getByRole("link", { name: /cold read: service @ abc123/i });
    expect(chip.textContent).toContain("2d");
  });

  it("shows done state after completion", () => {
    setPayload({
      rep: {
        date: "2026-08-26",
        attempt: 0,
        startedAt: "2026-08-26T09:00:00Z",
        completedAt: "2026-08-26T09:10:00Z",
        kind: "recall",
        material: { kind: "recall", diagramPath: "diagrams/x", title: "X" },
      },
      stats: { streak: 3, completedCount: 6, recent: [] },
    });
    render(<TodayRepSignal />);
    expect(screen.getByRole("link", { name: /rep done, 3 day streak/i })).toBeTruthy();
  });
});
