import { expect, it } from "vitest";
import { releaseEligibility } from "./update";

it("only permits releases with a verified age of at least 24 hours", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  expect(releaseEligibility("1.2.3", "2026-10-30T12:00:00Z", now)).toEqual({ ageStatus: "eligible", installable: "1.2.3" });
  expect(releaseEligibility("1.2.3", "2026-10-30T12:00:01Z", now)).toEqual({ ageStatus: "too-new" });
  expect(releaseEligibility("1.2.3", "2026-11-01T12:00:00Z", now)).toEqual({ ageStatus: "unknown" });
  expect(releaseEligibility("1.2.3", "invalid", now)).toEqual({ ageStatus: "unknown" });
  expect(releaseEligibility("1.2.3", undefined, now)).toEqual({ ageStatus: "unknown" });
});
