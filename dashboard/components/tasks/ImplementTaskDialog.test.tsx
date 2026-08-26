// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImplementTaskDialog } from "./ImplementTaskDialog";

const mocks = vi.hoisted(() => ({
  taskImplementationCommand: vi.fn(),
  proposeTerminalRun: vi.fn(),
  launchChamber: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  writeText: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/components/shell/ModalShell", () => ({
  ModalShell: ({ open, children, footer }: { open: boolean; children: React.ReactNode; footer?: React.ReactNode }) =>
    open ? <div>{children}{footer}</div> : null,
}));
vi.mock("@/lib/terminal-launch", () => ({
  taskImplementationCommand: mocks.taskImplementationCommand,
}));
vi.mock("@/lib/terminal-inject", () => ({ proposeTerminalRun: mocks.proposeTerminalRun }));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: mocks.success, error: mocks.error }),
}));
vi.mock("@/lib/launch/chamber", () => ({ useLaunchChamberDesktop: () => mocks.launchChamber }));

const task = {
  id: "task-1",
  text: "Implement article footer #mobile",
  done: false,
  createdAt: "2026-08-25T10:00:00.000Z",
  links: [{ kind: "repo" as const, id: "businessinsider/app-poc", label: "app-poc" }],
};

describe("ImplementTaskDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ repoPath: "/repos/app-poc" }),
    });
    mocks.taskImplementationCommand.mockResolvedValue({
      command: "cursor-agent prompt",
      label: "Cursor",
      provider: "cursor",
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("launches the selected CLI with a model override", async () => {
    render(<ImplementTaskDialog open task={task} date="2026-08-25" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("radio", { name: /Cursor/ }));
    fireEvent.change(screen.getByLabelText("Model override"), { target: { value: "cursor-model" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));

    await waitFor(() => {
      expect(mocks.taskImplementationCommand).toHaveBeenCalledWith(
        "cursor",
        expect.stringContaining("devhub-implement-task"),
        "cursor-model",
      );
    });
    expect(mocks.proposeTerminalRun).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "agent",
        mode: "interactive",
        preferAgentTab: true,
        forceNewTab: true,
        cwd: "/repos/app-poc",
      }),
    );
  });

  it("copies the same plan-url prompt without launching", async () => {
    render(<ImplementTaskDialog open task={task} date="2026-08-25" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));

    await waitFor(() => {
      expect(mocks.writeText).toHaveBeenCalledWith(
        expect.stringContaining("/api/tasks/implement/plan?taskId=task-1&date=2026-08-25"),
      );
    });
    expect(mocks.taskImplementationCommand).not.toHaveBeenCalled();
  });

  it("copies the prompt and opens OpenChamber", async () => {
    render(<ImplementTaskDialog open task={task} date="2026-08-25" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("radio", { name: /OpenChamber/ }));
    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));

    await waitFor(() => expect(mocks.launchChamber).toHaveBeenCalled());
    expect(mocks.writeText).toHaveBeenCalled();
    expect(mocks.taskImplementationCommand).not.toHaveBeenCalled();
  });

  it("leaves repo selection to the skill when multiple repos are linked", async () => {
    const multiRepoTask = {
      ...task,
      links: [
        ...task.links,
        { kind: "repo" as const, id: "businessinsider/mobile-app", label: "mobile-app" },
      ],
    };
    render(<ImplementTaskDialog open task={multiRepoTask} date="2026-08-25" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));

    await waitFor(() => expect(mocks.taskImplementationCommand).toHaveBeenCalled());
    const prompt = mocks.taskImplementationCommand.mock.calls[0]?.[1] as string;
    expect(prompt).not.toContain(" in the businessinsider/");
  });
});
