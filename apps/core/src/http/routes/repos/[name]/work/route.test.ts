import { expect, it, vi } from "vitest";
import { getMyTicketsCached } from "../../../../../lib/jira/client";
import { getEventsInRange } from "../../../../../lib/google-calendar";
import { ensureTasksMigrated } from "../../../../../domains/tasks/storage";
import { GET } from "./route";

vi.mock("../../../../../lib/repos/scanned-repo", () => ({ resolveScannedRepo: (name: string) => name === "demo" ? "/fixture/demo" : null }));
vi.mock("../../../../../lib/repos/index", () => ({ getGithubFullNameForLocalRepo: () => null }));
vi.mock("../../../../../lib/jira/client", () => ({ getMyTicketsCached: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../../../lib/google-calendar", () => ({ getEventsInRange: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../../../lib/github/prs", () => ({ resolveCanonicalRepoFullName: vi.fn(), rowFromSearchItem: vi.fn(), searchIssues: vi.fn() }));
vi.mock("../../../../../domains/tasks/storage", () => ({ getTasks: vi.fn(), isTaskOpen: vi.fn(), listTaskDays: vi.fn(), ensureTasksMigrated: vi.fn() }));
vi.mock("@devhub/core/events/core-events", () => ({ emitCoreEvent: vi.fn() }));

it("keeps external work refresh separate from local task migration", async () => {
  const request = new Request("http://localhost:1447/api/repos/demo/work?scope=external");
  expect(await (await GET(request, { params: Promise.resolve({ name: "demo" }) })).json()).toEqual({ ok: true });
  expect(getMyTicketsCached).toHaveBeenCalledOnce();
  expect(getEventsInRange).toHaveBeenCalledOnce();
  expect(ensureTasksMigrated).not.toHaveBeenCalled();
  expect((await GET(request, { params: Promise.resolve({ name: "missing" }) })).status).toBe(404);
});
