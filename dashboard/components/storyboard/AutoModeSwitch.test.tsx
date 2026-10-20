/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ post: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("./orchestrate-client", () => ({ postOrchestrate: mocks.post }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/components/agents/WorkingFolderField", () => ({
  WorkingFolderField: ({ onPick }: { onPick: (choice: { name: string; path: string }) => void }) => (
    <button type="button" onClick={() => onPick({ name: "org/app", path: "/Users/j/Developer/app" })}>pick app</button>
  ),
}));

import { AutoModeSwitch } from "./AutoModeSwitch";
import { RepoAnswer } from "./RepoAnswer";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("AutoModeSwitch", () => {
  it("switches a running task to Manual in one click, no confirm", async () => {
    mocks.post.mockResolvedValue({ ok: true, cancelled: "signalled" });
    render(<AutoModeSwitch summary={{ taskId: "t1", status: "running", runCount: 1 }} />);
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith({ action: "mode", taskId: "t1", mode: "manual" }));
    expect(mocks.toast.success).toHaveBeenCalledWith("Manual: the active run was stopped");
  });

  it("resumes Auto from Manual", async () => {
    mocks.post.mockResolvedValue({ ok: true, runId: "run-2" });
    render(<AutoModeSwitch summary={{ taskId: "t1", status: "paused-manual", runCount: 1 }} />);
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.textContent).toContain("Manual");
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith({ action: "mode", taskId: "t1", mode: "auto" }));
  });

  it("says so when Auto could not resume", async () => {
    mocks.post.mockResolvedValue({ ok: true, runId: null, dispatchError: "Paseo is offline" });
    render(<AutoModeSwitch summary={{ taskId: "t1", status: "paused-manual", runCount: 1 }} />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Couldn't resume auto: Paseo is offline"));
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("does not claim a run stopped when it could not be", async () => {
    mocks.post.mockResolvedValue({ ok: true, cancelled: "failed: runtime offline" });
    render(<AutoModeSwitch summary={{ taskId: "t1", status: "running", runCount: 1 }} />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Manual, but the run did not stop: runtime offline"));
  });

  it("is hidden once the task is finished", () => {
    const { container } = render(<AutoModeSwitch summary={{ taskId: "t1", status: "pr-created", runCount: 1 }} />);
    expect(container.innerHTML).toBe("");
  });

  it("is hidden while the task has no runs yet, even on needs-you", () => {
    const { container } = render(<AutoModeSwitch summary={{ taskId: "t1", status: "needs-you", runCount: 0 }} />);
    expect(container.innerHTML).toBe("");
  });

  it("reports a refused switch", async () => {
    mocks.post.mockResolvedValue({ ok: false, error: "nope" });
    render(<AutoModeSwitch summary={{ taskId: "t1", status: "running", runCount: 1 }} />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("nope"));
  });
});

describe("RepoAnswer", () => {
  it("sends only the folder, not the picker's display name, and resumes auto in one click", async () => {
    mocks.post.mockResolvedValue({ ok: true, summary: { status: "running", repoName: "org/app" } });
    render(<RepoAnswer taskId="t1" taskDate="2026-10-15" />);
    fireEvent.click(screen.getByRole("button", { name: "pick app" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith({ action: "answer-repo", taskId: "t1", taskDate: "2026-10-15", cwd: "/Users/j/Developer/app" }));
    expect(mocks.post.mock.calls[0][0]).not.toHaveProperty("repoName");
    expect(mocks.toast.success).toHaveBeenCalledWith("Linked org/app; planning resumed");
  });

  it("reports a link whose plan run failed to start, using the server's resolved name", async () => {
    mocks.post.mockResolvedValue({ ok: true, summary: { status: "paused", repoName: "org/app" }, dispatchError: "capacity full" });
    render(<RepoAnswer taskId="t1" taskDate="2026-10-15" />);
    fireEvent.click(screen.getByRole("button", { name: "pick app" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Linked org/app, but planning didn't start: capacity full"));
  });

  it("falls back to the picker's name when the server didn't resolve one", async () => {
    mocks.post.mockResolvedValue({ ok: false, error: "That folder isn't a repo DevHub recognises. Pick one from the list." });
    render(<RepoAnswer taskId="t1" taskDate="2026-10-15" />);
    fireEvent.click(screen.getByRole("button", { name: "pick app" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("That folder isn't a repo DevHub recognises. Pick one from the list."));
  });
});
