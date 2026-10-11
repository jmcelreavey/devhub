// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobsManager } from "./JobsManager";
import { WORKTREE_CLEANUP_JOB } from "@/lib/scheduled-job-presets";

const mocks = vi.hoisted(() => ({ live: vi.fn(), mutate: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: mocks.live }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock("@/components/shell/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/lib/desktop/bridge", () => ({
  isDesktop: () => false, loginItemStatus: async () => "unsupported", setLoginItem: vi.fn(), installWakeHelper: vi.fn(), uninstallWakeHelper: vi.fn(),
}));
const response = (jobs: unknown[] = []) => ({ jobs, scripts: ["worktree_cleanup_scan", "worktree_cleanup"], providers: [], wake: { helper: "unsupported", scheduledAt: null } });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.live.mockReturnValue({ data: response(), mutate: mocks.mutate, isLoading: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("weekly worktree cleanup preset", () => {
  it("creates the enabled Sunday 03:17 local job in one click, without waking the Mac", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "cleanup" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<JobsManager />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule weekly cleanup" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/jobs", expect.objectContaining({ method: "POST", body: JSON.stringify({ ...WORKTREE_CLEANUP_JOB, source: "ui" }) }));
    expect(mocks.mutate).toHaveBeenCalled();
  });
  it("prevents duplicates, including when an existing cleanup job is disabled", () => {
    mocks.live.mockReturnValue({ data: response([{ id: "cleanup", ...WORKTREE_CLEANUP_JOB, enabled: false, kind: "script", createdAt: 1, scheduleValid: true, nextRunAt: null }]), mutate: mocks.mutate, isLoading: false });
    render(<JobsManager />);
    expect((screen.getByRole("button", { name: "Cleanup scheduled" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows the request failure and allows a retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Could not save job" }, { status: 500 })));
    render(<JobsManager />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule weekly cleanup" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Could not save job"));
    expect((screen.getByRole("button", { name: "Schedule weekly cleanup" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("does not offer a destructive preset before the script catalog has loaded", () => {
    mocks.live.mockReturnValue({ data: undefined, mutate: mocks.mutate, isLoading: true });
    render(<JobsManager />);
    expect(screen.queryByRole("button", { name: "Schedule weekly cleanup" })).toBeNull();
  });
});
