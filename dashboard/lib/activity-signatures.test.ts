import { describe, expect, it } from "vitest";
import {
  buildPrActivitySignature,
  buildTicketActivitySignature,
  prActivityItemKey,
  ticketActivityItemKey,
} from "./activity-signatures";

describe("activity signatures", () => {
  it("builds stable ticket signatures regardless of order", () => {
    const a = buildTicketActivitySignature([{ key: "DAD-2" }, { key: "DAD-1" }]);
    const b = buildTicketActivitySignature([{ key: "DAD-1" }, { key: "DAD-2" }]);
    expect(a).toBe(b);
  });

  it("keeps signatures stable when the ticket set is unchanged", () => {
    const before = buildTicketActivitySignature([{ key: "DAD-1" }]);
    const after = buildTicketActivitySignature([{ key: "DAD-1" }]);
    expect(after).toBe(before);
  });

  it("changes ticket signatures when the ticket set changes", () => {
    const before = buildTicketActivitySignature([{ key: "DAD-1" }]);
    const after = buildTicketActivitySignature([{ key: "DAD-1" }, { key: "DAD-2" }]);
    expect(after).not.toBe(before);
  });

  it("builds PR signatures from actionable groups only", () => {
    expect(
      buildPrActivitySignature([
        [{ repo: "owner/a", number: 1, url: "https://github.com/owner/a/pull/1" }],
        [{ repo: "owner/b", number: 2, url: "https://github.com/owner/b/pull/2" }],
      ]),
    ).toBe("https://github.com/owner/a/pull/1\nhttps://github.com/owner/b/pull/2");
  });

  it("uses stable item keys for row-level read status", () => {
    expect(ticketActivityItemKey({ key: "DAD-1" })).toBe("DAD-1");
    expect(prActivityItemKey({ repo: "owner/a", number: 1, url: "" })).toBe("owner/a#1");
  });
});
