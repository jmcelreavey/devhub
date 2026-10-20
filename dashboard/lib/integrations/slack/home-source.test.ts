import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSlackSnapshot } from "./answers";
import { loadSlackNeedsSnapshot } from "./needs-you-source";
import { loadSlackPrs } from "./pr-source";
import { buildSlackHome, loadSlackHome } from "./home-source";
import { slackThreadItemId } from "./thread-store";

vi.mock("./answers", () => ({ loadSlackSnapshot: vi.fn() }));
vi.mock("./needs-you-source", async (importOriginal) => ({ ...await importOriginal<typeof import("./needs-you-source")>(), loadSlackNeedsSnapshot: vi.fn() }));
vi.mock("./pr-source", () => ({ loadSlackPrs: vi.fn() }));
const audience = { teamId: "TTEAM", userId: "UOWNER", channel: "CCHANNEL" };
const now = Date.parse("2026-10-18T12:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadSlackSnapshot).mockReturnValue({ cards: [], items: [], todayTaskIds: [], errors: [] });
  vi.mocked(loadSlackNeedsSnapshot).mockResolvedValue({ items: [], peersKnown: true });
  vi.mocked(loadSlackPrs).mockResolvedValue({ configured: true, authored: [], reviews: [], owned: [], ownedFailed: [], stale: false });
});

describe("live Home sources", () => {
  it("uses Home/PRs actionable rules rather than all open PR inventory", async () => {
    const pr = (number: number, repo = "acme/app") => ({ repo, number, title: `PR ${number}`, url: `https://github.com/${repo}/pull/${number}`, prState: "open" as const });
    vi.mocked(loadSlackPrs).mockResolvedValue({ configured: true, authored: [pr(1), { ...pr(2), checks: "failing" }], reviews: [pr(3), pr(4, "outside/repo"), pr(3)], ownedRepos: ["ACME/APP"], owned: Array.from({ length: 77 }, (_, index) => pr(index + 100)), ownedFailed: [], stale: false });
    expect((await loadSlackHome(audience, "work", now)).prs?.actionableCount).toBe(2);
    const rendered = JSON.stringify(await buildSlackHome(audience, "work", now));
    expect(rendered).toContain("2 PRs need attention"); expect(rendered).not.toContain("77 open PRs");
  });
  it("shares the board snapshot and binds Home buttons to the audience's need IDs", async () => {
    const need = { profile: "work", entityId: "task:t1", taskId: "t1", title: "Task", needed: "Pick up", href: "/work", action: "open" as const, itemKey: "k" };
    vi.mocked(loadSlackNeedsSnapshot).mockResolvedValue({ items: [need], peersKnown: true });
    const input = await loadSlackHome(audience, "work", now);
    expect(loadSlackSnapshot).toHaveBeenCalledExactlyOnceWith("work");
    expect(loadSlackNeedsSnapshot).toHaveBeenCalledWith("work", loadSlackSnapshot("work"));
    expect(input).toMatchObject({ needs: [{ id: slackThreadItemId(need, audience), need }], tasks: [], prs: { configured: true }, now });
    expect(JSON.stringify(await buildSlackHome(audience, "work", now))).toContain("devhub_need_plan");
  });

  it("keeps PRs available when task sources fail", async () => {
    vi.mocked(loadSlackSnapshot).mockImplementation(() => { throw new Error("unavailable"); });
    const input = await loadSlackHome(audience, "work", now);
    expect(input.needs).toBeUndefined();
    expect(input.tasks).toBeUndefined();
    expect(input.prs?.configured).toBe(true);
    expect(loadSlackNeedsSnapshot).not.toHaveBeenCalled();
  });

  it("keeps tasks available when Needs-you and PR sources fail", async () => {
    vi.mocked(loadSlackNeedsSnapshot).mockRejectedValue(new Error("unavailable"));
    vi.mocked(loadSlackPrs).mockRejectedValue(new Error("unavailable"));
    const input = await loadSlackHome(audience, "work", now);
    expect(input.needs).toBeUndefined();
    expect(input.prs).toBeUndefined();
    expect(input.tasks).toEqual([]);
  });
});
