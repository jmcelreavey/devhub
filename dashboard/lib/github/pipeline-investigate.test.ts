import { describe, expect, it } from "vitest";
import { selectFailedRunIds } from "./pipeline-investigate";

describe("selectFailedRunIds", () => {
  it("picks failed conclusions and respects the cap", () => {
    expect(
      selectFailedRunIds(
        [
          { databaseId: 1, conclusion: "failure" },
          { databaseId: 2, conclusion: "success" },
          { databaseId: 3, conclusion: "timed_out" },
          { databaseId: 4, conclusion: "cancelled" },
          { databaseId: 5, conclusion: "failure" },
          { databaseId: 6, conclusion: "failure" },
        ],
        3,
      ),
    ).toEqual([1, 3, 4]);
  });

  it("skips rows without ids", () => {
    expect(selectFailedRunIds([{ conclusion: "failure" }, { databaseId: 9, conclusion: "failure" }])).toEqual([
      9,
    ]);
  });
});
