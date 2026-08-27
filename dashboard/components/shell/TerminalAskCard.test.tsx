// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalAskCard } from "./TerminalAskCard";

describe("TerminalAskCard", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows thinking shimmer with the echoed question", () => {
    vi.useFakeTimers();
    render(
      <TerminalAskCard
        state={{
          question: "What is hogging the shell?",
          startedAt: Date.now() - 2_000,
          phase: "thinking",
        }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("What is hogging the shell?")).toBeTruthy();
    expect(screen.getByText(/Agent thinking/)).toBeTruthy();
  });

  it("renders a text answer when the agent returns prose", () => {
    render(
      <TerminalAskCard
        state={{
          question: "Why busy?",
          startedAt: Date.now() - 5_000,
          phase: "answered",
          answer: "The shell is idle — RPROMPT clock was fooling heuristics.",
          endedAt: Date.now(),
        }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/RPROMPT clock/)).toBeTruthy();
  });
});
