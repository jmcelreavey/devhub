import { describe, expect, it } from "vitest";
import { isFiringAlert } from "@/lib/tasks/alert-drafts";

describe("isFiringAlert", () => {
  it("skips recoveries and OK transitions", () => {
    expect(isFiringAlert({ title: "[Triggered] High 5xx on foo", status: "error" })).toBe(true);
    expect(isFiringAlert({ title: "[Warn] Latency", status: "warning" })).toBe(true);
    expect(isFiringAlert({ title: "[Recovered] High 5xx on foo", status: "error" })).toBe(false);
    expect(isFiringAlert({ title: "High 5xx on foo", status: "success" })).toBe(false);
  });
});
