import { describe, expect, it } from "vitest";
import { describeCheck, type CheckOutcome } from "./update-result";

const ahead = { available: true, checkoutAhead: true };

describe("describeCheck", () => {
  it("up to date names the version", () => {
    const notice = describeCheck({ status: "upToDate", currentVersion: "2.0.0" });
    expect(notice).toMatchObject({ tone: "success", title: "You're up to date (2.0.0)", actions: [] });
  });
  it("an available update offers Install", () => {
    const notice = describeCheck({ status: "available", currentVersion: "2.0.0", version: "2.1.0" });
    expect(notice.title).toBe("DevHub 2.1.0 is available");
    expect(notice.body).toContain("You're on 2.0.0");
    expect(notice.actions).toEqual(["install"]);
  });
  it("no published release is a plain message, not an error", () => {
    const notice = describeCheck({ status: "noRelease", currentVersion: "2.0.0" });
    expect(notice).toMatchObject({ tone: "info", title: "No published release yet" });
    expect(notice.details).toBeUndefined();
    expect(notice.actions).toEqual([]);
  });
  it("a network failure is readable, keeps the raw text behind details, and can retry", () => {
    const outcome: CheckOutcome = { status: "failed", currentVersion: "2.0.0", message: "Couldn't reach the update server. Check your connection and try again.", details: "dns error" };
    const notice = describeCheck(outcome);
    expect(notice).toMatchObject({ tone: "warning", title: outcome.message, details: "dns error" });
    expect(notice.actions).toEqual(["retry"]);
  });
  it("offers a rebuild when the checkout is ahead, next to any release result", () => {
    expect(describeCheck({ status: "upToDate", currentVersion: "2.0.0" }, ahead)).toMatchObject({
      body: "Your checkout is ahead of the running build.",
      actions: ["rebuild"],
    });
    expect(describeCheck({ status: "noRelease", currentVersion: "2.0.0" }, ahead).actions).toEqual(["rebuild"]);
    expect(describeCheck({ status: "available", currentVersion: "2.0.0", version: "2.1.0" }, ahead).actions).toEqual(["install", "rebuild"]);
    expect(describeCheck({ status: "failed", currentVersion: "2.0.0", message: "x", details: "y" }, ahead).actions).toEqual(["retry", "rebuild"]);
  });
  it("does not offer a rebuild that cannot run, or when the checkout is not ahead", () => {
    expect(describeCheck({ status: "upToDate", currentVersion: "2.0.0" }, { available: false, checkoutAhead: true }).actions).toEqual([]);
    expect(describeCheck({ status: "upToDate", currentVersion: "2.0.0" }, { available: true, checkoutAhead: false }).actions).toEqual([]);
    expect(describeCheck({ status: "upToDate", currentVersion: "2.0.0" }, null).actions).toEqual([]);
  });
});
