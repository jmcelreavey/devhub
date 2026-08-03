import { describe, expect, it } from "vitest";
import { summarizeChecks } from "./branch-pr";

describe("summarizeChecks", () => {
  it("reports none when there are no checks", () => {
    expect(summarizeChecks(undefined).checks).toBe("none");
    expect(summarizeChecks([]).checks).toBe("none");
  });

  it("passes when every check succeeded", () => {
    const result = summarizeChecks([{ conclusion: "SUCCESS" }, { conclusion: "SKIPPED" }]);
    expect(result.checks).toBe("passing");
    expect(result.checkCounts).toEqual({ passed: 2, failed: 0, pending: 0 });
  });

  it("lets a failure outrank anything still running", () => {
    // The whole point of the chip: one red check is the headline even while
    // the rest of the matrix is still going.
    const result = summarizeChecks([
      { conclusion: "SUCCESS" },
      { status: "IN_PROGRESS" },
      { conclusion: "FAILURE" },
    ]);
    expect(result.checks).toBe("failing");
    expect(result.checkCounts).toEqual({ passed: 1, failed: 1, pending: 1 });
  });

  it("reports pending while checks are queued but none have failed", () => {
    expect(summarizeChecks([{ conclusion: "SUCCESS" }, { status: "QUEUED" }]).checks).toBe("pending");
  });

  it("understands commit statuses as well as check runs", () => {
    // gh mixes both shapes into statusCheckRollup: check runs carry
    // conclusion+status, legacy commit statuses carry state.
    expect(summarizeChecks([{ state: "SUCCESS" }]).checks).toBe("passing");
    expect(summarizeChecks([{ state: "FAILURE" }]).checks).toBe("failing");
    expect(summarizeChecks([{ state: "PENDING" }]).checks).toBe("pending");
  });

  it("treats cancelled and timed-out runs as failures", () => {
    expect(summarizeChecks([{ conclusion: "CANCELLED" }]).checks).toBe("failing");
    expect(summarizeChecks([{ conclusion: "TIMED_OUT" }]).checks).toBe("failing");
    expect(summarizeChecks([{ conclusion: "ACTION_REQUIRED" }]).checks).toBe("failing");
  });

  it("ignores rows it cannot classify rather than guessing", () => {
    expect(summarizeChecks([{ conclusion: "SOMETHING_NEW" }]).checks).toBe("none");
  });
});
