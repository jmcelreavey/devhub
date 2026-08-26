import { describe, expect, it } from "vitest";
import { prRowStatus } from "./pr-row-status";

describe("prRowStatus", () => {
  it("returns null when neither approved nor merged", () => {
    expect(prRowStatus({})).toBeNull();
    expect(prRowStatus({ approved: false, prState: "open" })).toBeNull();
    expect(prRowStatus({ prState: "closed" })).toBeNull();
  });

  it("returns approved for open approved PRs", () => {
    expect(prRowStatus({ approved: true })).toBe("approved");
    expect(prRowStatus({ approved: true, prState: "open" })).toBe("approved");
  });

  it("prefers merged over approved", () => {
    expect(prRowStatus({ approved: true, prState: "merged" })).toBe("merged");
    expect(prRowStatus({ prState: "merged" })).toBe("merged");
  });
});
