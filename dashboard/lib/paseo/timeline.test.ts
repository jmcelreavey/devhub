import { describe, expect, it, vi } from "vitest";
import type { PaseoSession } from "./client";
import { turnEntries } from "./lifecycle";

describe("Paseo timeline pagination", () => {
  it("finds the submitted message beyond the first 500 entries", async () => {
    const answer = { item: { type: "assistant_message", text: "done" }, seqStart: 600 };
    const message = { item: { type: "user_message", text: "do it", clientMessageId: "mine" }, seqStart: 1 };
    const fetchAgentTimeline = vi.fn()
      .mockResolvedValueOnce({ entries: [answer], hasOlder: true, startCursor: { epoch: "one", seq: 600 } })
      .mockResolvedValueOnce({ entries: [message], hasOlder: false });
    expect(await turnEntries({ fetchAgentTimeline } as unknown as PaseoSession["daemon"], "agent", "mine")).toEqual([message, answer]);
    expect(fetchAgentTimeline).toHaveBeenLastCalledWith("agent", expect.objectContaining({ direction: "before", cursor: { epoch: "one", seq: 600 } }));
  });

  it("does not loop on a repeated cursor or accept a stale page", async () => {
    const fetchAgentTimeline = vi.fn().mockResolvedValue({ entries: [], hasOlder: true, startCursor: { epoch: "one", seq: 600 } });
    const daemon = { fetchAgentTimeline } as unknown as PaseoSession["daemon"];
    await expect(turnEntries(daemon, "agent", "missing")).rejects.toThrow("too large");
    expect(fetchAgentTimeline).toHaveBeenCalledTimes(2);
    fetchAgentTimeline.mockResolvedValue({ entries: [], staleCursor: true });
    await expect(turnEntries(daemon, "agent", "missing")).rejects.toThrow("changed");
  });
});
