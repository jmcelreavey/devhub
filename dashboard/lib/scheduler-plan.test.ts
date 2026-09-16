import { describe, expect, it } from "vitest";
import { dueOccurrence, earliestOccurrence, nextOccurrence } from "./scheduler-plan";

const at = (iso: string) => new Date(iso).getTime();

describe("dueOccurrence", () => {
  it("is due once the occurrence has passed and was not handled", () => {
    const since = at("2026-09-14T06:00:00");
    expect(dueOccurrence("0 7 * * *", since, at("2026-09-14T07:00:10"))).toBe(at("2026-09-14T07:00:00"));
  });

  it("counts an occurrence landing exactly on the tick", () => {
    const since = at("2026-09-14T06:00:00");
    expect(dueOccurrence("0 7 * * *", since, at("2026-09-14T07:00:00"))).toBe(at("2026-09-14T07:00:00"));
  });

  it("is not due before the occurrence", () => {
    expect(dueOccurrence("0 7 * * *", at("2026-09-14T06:00:00"), at("2026-09-14T06:59:59"))).toBeNull();
  });

  it("is not due again once handled", () => {
    const handled = at("2026-09-14T07:00:00");
    expect(dueOccurrence("0 7 * * *", handled, at("2026-09-14T07:05:00"))).toBeNull();
  });

  it("collapses a weekend of missed hourly runs into the latest one", () => {
    const since = at("2026-09-12T18:00:00");
    expect(dueOccurrence("0 * * * *", since, at("2026-09-14T09:12:00"))).toBe(at("2026-09-14T09:00:00"));
  });

  it("still fires a run that slept past its time (the old timer bug)", () => {
    // Timer armed at 23:00 for 07:00, Mac asleep until 08:30.
    const since = at("2026-09-13T23:00:00");
    expect(dueOccurrence("0 7 * * *", since, at("2026-09-14T08:30:00"))).toBe(at("2026-09-14T07:00:00"));
  });

  it("treats an invalid cron as never due", () => {
    expect(dueOccurrence("not a cron", 0, Date.now())).toBeNull();
  });
});

describe("nextOccurrence / earliestOccurrence", () => {
  it("finds the next run strictly after a time", () => {
    expect(nextOccurrence("0 7 * * *", at("2026-09-14T07:00:00"))).toBe(at("2026-09-15T07:00:00"));
  });

  it("picks the soonest valid cron and ignores broken ones", () => {
    const after = at("2026-09-14T06:00:00");
    expect(earliestOccurrence(["0 9 * * *", "bad", "30 6 * * *"], after)).toBe(at("2026-09-14T06:30:00"));
    expect(earliestOccurrence(["bad"], after)).toBeNull();
    expect(earliestOccurrence([], after)).toBeNull();
  });
});
