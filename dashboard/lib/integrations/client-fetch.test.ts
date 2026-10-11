import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { integrationFetch } from "./client-fetch";
import { openWriteReview } from "@/components/integrations/WriteReview";
import type { WriteProposal } from "./write-types";

vi.mock("@/components/integrations/WriteReview", () => ({ openWriteReview: vi.fn() }));
const proposal: WriteProposal = {
  id: "proposal", profile: "work", source: "DevHub", state: "requested",
  createdAt: "2026-10-10T12:00:00Z", expiresAt: "2026-10-10T12:15:00Z",
  input: { action: "issue.transition", provider: "jira", account: "default",
    ref: { provider: "jira", account: "default", kind: "issue", id: "APP-1" }, transitionId: "31" },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ proposal }, {
    status: 202, headers: { "x-devhub-confirmation": "required" },
  })));
});
afterEach(() => vi.unstubAllGlobals());

it("distinguishes user cancellation from success and provider failure", async () => {
  vi.mocked(openWriteReview).mockResolvedValueOnce(null);
  expect(await integrationFetch("/api/jira/ticket/APP-1/transition", { method: "POST" })).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps an unknown write outcome as a failed response for legacy callers", async () => {
  vi.mocked(openWriteReview).mockResolvedValueOnce({ ...proposal, state: "unknown", detail: "Check Jira before retrying." });
  const response = await integrationFetch("/api/jira/ticket/APP-1/transition", { method: "POST" });
  expect(response?.status).toBe(409);
  expect(await response?.json()).toEqual({ error: "Check Jira before retrying." });
});

it("preserves the legacy successful transition response after confirmation", async () => {
  vi.mocked(openWriteReview).mockResolvedValueOnce({ ...proposal, state: "succeeded" });
  const response = await integrationFetch("/api/jira/ticket/APP-1/transition", { method: "POST" });
  expect(response?.ok).toBe(true);
  expect(await response?.json()).toEqual({ key: "APP-1", ok: true });
});
