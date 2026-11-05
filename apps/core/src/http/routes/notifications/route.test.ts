import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sources: vi.fn(), save: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../domains/tasks/profile-request", () => ({ activeTaskProfile: () => "work", requestedTaskProfile: () => null, taskProfileConflict: () => null }));
vi.mock("../../../domains/notifications/sources", () => ({ readNotificationSources: mocks.sources, readNotifications: vi.fn() }));
vi.mock("../../../domains/notifications/state", () => ({ updateNotificationState: mocks.save, writeNeedsYouOwnedReposOnly: vi.fn(), writeNotificationSourcePrefs: vi.fn().mockResolvedValue({}) }));
vi.mock("../../../lib/api-utils", async importOriginal => ({
  ...await importOriginal<typeof import("../../../lib/api-utils")>(),
  requireDashboardAuth: () => ({ ok: true }),
}));
import { POST } from "./route";

it("dismisses the displayed version without waiting for external sources", async () => {
  const versions = [{ id: "pr:example", version: "displayed-version" }];
  const response = await POST(new Request("http://localhost/api/notifications?profile=work", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: ["pr:example"], action: "dismiss", versions }),
  }));
  expect(response.status).toBe(200);
  expect(mocks.sources).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledWith("work", versions, ["pr:example"], "dismiss");
});
