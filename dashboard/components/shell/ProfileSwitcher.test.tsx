/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";

const ui = vi.hoisted(() => ({
  data: null as TaskProfileOverview | null,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  refresh: vi.fn(),
  mutateAll: vi.fn(async () => undefined),
  mutateProfile: vi.fn(async () => undefined),
}));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => ({ data: ui.data, error: undefined, mutate: ui.mutateProfile }) }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ui.toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: ui.refresh }) }));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: ui.mutateAll }) }));

import { ProfileSwitcher } from "./ProfileSwitcher";

const fetchMock = vi.fn();
const overview = (patch: Partial<TaskProfileOverview> = {}): TaskProfileOverview => ({
  mode: "profiles",
  active: "work",
  profiles: ["personal", "side", "work"],
  legacyFiles: 0,
  overlay: [],
  defaultProfile: "work",
  counts: { personal: { open: 6, total: 10 }, side: { open: 0, total: 0 }, work: { open: 25, total: 276 } },
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  ui.data = overview();
  fetchMock.mockResolvedValue(Response.json({}));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openPicker() {
  render(<ProfileSwitcher />);
  fireEvent.click(screen.getByRole("button", { name: /Task profile: work/ }));
  return screen.getByRole("dialog", { name: "Task profiles" });
}

describe("ProfileSwitcher", () => {
  it("names the active profile on the button and lists each profile with its open count", () => {
    const dialog = openPicker();
    expect(screen.getByRole("button", { name: /Task profile: work/ })).toHaveTextContent("Work");
    const work = within(dialog).getByRole("button", { name: /^Work/ });
    expect(work).toHaveAttribute("aria-pressed", "true");
    expect(work).toHaveTextContent("25 open");
    expect(within(dialog).getByRole("button", { name: /^Personal/ })).toHaveTextContent("6 open");
  });

  it("switches on a click even when the click blurs with no relatedTarget (WebKit), then refetches everything", async () => {
    const dialog = openPicker();
    const personal = within(dialog).getByRole("button", { name: /^Personal/ });
    // WebKit doesn't focus a clicked button: the panel sees a blur to nowhere first. It used to close on that.
    fireEvent.blur(within(dialog).getByRole("button", { name: /^Work/ }), { relatedTarget: null });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => fireEvent.click(personal));
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ action: "switch", id: "personal" });
    await waitFor(() => expect(ui.toast.success).toHaveBeenCalledWith("Switched to personal"));
    expect(ui.mutateAll).toHaveBeenCalled();
    expect(ui.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the API's reason when a switch is refused", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "No profile named \"personal\"." }, { status: 404 }));
    const dialog = openPicker();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: /^Personal/ })));
    expect(ui.toast.error).toHaveBeenCalledWith("No profile named \"personal\".");
    expect(ui.refresh).not.toHaveBeenCalled();
  });

  it("re-scopes the profile cache before refreshing cards and counts", async () => {
    const personal = overview({ active: "personal" });
    fetchMock.mockResolvedValueOnce(Response.json(personal));
    const dialog = openPicker();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: /^Personal/ })));
    expect(ui.mutateProfile).toHaveBeenCalledWith(personal, { revalidate: false });
    expect(ui.mutateProfile.mock.invocationCallOrder[0]).toBeLessThan(ui.mutateAll.mock.invocationCallOrder[0]);
  });

  it("hides New profile behind a link, with the help text only while creating", () => {
    const dialog = openPicker();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).queryByText(/Lowercase letters/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "New profile" }));
    expect(within(dialog).getByRole("textbox", { name: "New profile" })).toBeInTheDocument();
    expect(within(dialog).getByText(/Lowercase letters/)).toBeInTheDocument();
  });

  it("never offers to delete the active or default profile", () => {
    ui.data = overview({ active: "personal", defaultProfile: "work" });
    render(<ProfileSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Task profile: personal/ }));
    expect(screen.getByRole("button", { name: "Delete personal" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete work" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete side" })).toBeEnabled();
  });

  it("moves a non-empty profile's tasks to the active profile before deleting it", async () => {
    ui.data = overview({ defaultProfile: "side" });
    const dialog = openPicker();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete personal" }));
    const confirm = within(dialog).getByRole("button", { name: "Move 10 tasks to work and delete" });
    await act(async () => fireEvent.click(confirm));
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ action: "delete", id: "personal", moveTo: "work" });
    await waitFor(() => expect(ui.toast.success).toHaveBeenCalledWith("Moved personal’s tasks to work and deleted it"));
  });

  it("deletes an empty profile with a plain confirm, and Cancel backs out", async () => {
    const dialog = openPicker();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete side" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete side" }));
    expect(within(dialog).getByText("Delete side? It has no tasks.")).toBeInTheDocument();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Delete" })));
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ action: "delete", id: "side" });
  });
});
