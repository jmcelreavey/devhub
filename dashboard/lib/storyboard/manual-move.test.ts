import { describe, expect, it } from "vitest";
import { moveRequiresConfirmation } from "./notes-board-shared";

describe("manual backward moves", () => {
  it("does not ask to stop work when nothing is running", () => {
    expect(moveRequiresConfirmation({ status: "in-progress", run: null, steps: [] }, "todo")).toBe(false);
  });
  it("asks before leaving a live run or auto mode behind in To do", () => {
    expect(moveRequiresConfirmation({ status: "in-progress", run: { status: "running" }, steps: [] }, "todo")).toBe(true);
    expect(moveRequiresConfirmation({ status: "in-progress", auto: { status: "starting" }, steps: [] }, "todo")).toBe(true);
  });
  it("also protects other backward moves but not a forward move", () => {
    expect(moveRequiresConfirmation({ status: "ready-for-review", steps: [{ status: "queued" }] }, "planning")).toBe(true);
    expect(moveRequiresConfirmation({ status: "in-progress", run: { status: "running" } }, "ready-for-review")).toBe(false);
  });
});
