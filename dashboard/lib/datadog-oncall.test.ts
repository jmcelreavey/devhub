import { describe, it, expect } from "vitest";
import {
  emailMatches,
  extractOncallUsers,
  extractScheduleIds,
  parseScheduleIds,
} from "./datadog-oncall";

describe("extractOncallUsers", () => {
  it("reads users from the included array of a schedule on-call response", () => {
    const raw = {
      data: { type: "shifts", id: "shift-1" },
      included: [
        { type: "users", id: "u1", attributes: { email: "JM@company.com", name: "Johnny M" } },
        { type: "teams", id: "t1", attributes: { name: "DAD" } },
      ],
    };
    expect(extractOncallUsers(raw)).toEqual([{ email: "JM@company.com", name: "Johnny M" }]);
  });

  it("falls back to handle when name is absent and skips users without email", () => {
    const raw = {
      included: [
        { type: "users", id: "u1", attributes: { handle: "jm" } }, // no email → skipped
        { type: "users", id: "u2", attributes: { email: "a@b.com", handle: "ab" } },
      ],
    };
    expect(extractOncallUsers(raw)).toEqual([{ email: "a@b.com", name: "ab" }]);
  });

  it("returns [] for junk input", () => {
    expect(extractOncallUsers(null)).toEqual([]);
    expect(extractOncallUsers({})).toEqual([]);
    expect(extractOncallUsers({ included: "nope" })).toEqual([]);
  });
});

describe("emailMatches", () => {
  const users = [{ email: "JM@company.com" }, { email: "other@company.com" }];
  it("matches case- and whitespace-insensitively", () => {
    expect(emailMatches(users, "jm@company.com")).toBe(true);
    expect(emailMatches(users, "  JM@COMPANY.COM ")).toBe(true);
  });
  it("does not match a different or empty email", () => {
    expect(emailMatches(users, "nope@company.com")).toBe(false);
    expect(emailMatches(users, "")).toBe(false);
    expect(emailMatches([], "jm@company.com")).toBe(false);
  });
});

describe("parseScheduleIds", () => {
  it("splits comma-separated ids and trims blanks", () => {
    expect(parseScheduleIds("a, b ,,c")).toEqual(["a", "b", "c"]);
    expect(parseScheduleIds("  solo ")).toEqual(["solo"]);
  });
  it("returns [] for empty/nullish", () => {
    expect(parseScheduleIds("")).toEqual([]);
    expect(parseScheduleIds(undefined)).toEqual([]);
    expect(parseScheduleIds(null)).toEqual([]);
  });
});

describe("extractScheduleIds", () => {
  it("collects ids from a schedules list response", () => {
    const raw = {
      data: [
        { type: "schedules", id: "sched-1" },
        { type: "schedules", id: "sched-2" },
        { type: "schedules" }, // no id → skipped
      ],
    };
    expect(extractScheduleIds(raw)).toEqual(["sched-1", "sched-2"]);
  });
  it("returns [] for junk", () => {
    expect(extractScheduleIds(null)).toEqual([]);
    expect(extractScheduleIds({ data: "nope" })).toEqual([]);
  });
});
