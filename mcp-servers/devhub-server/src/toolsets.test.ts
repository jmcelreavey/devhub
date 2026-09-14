import { describe, expect, it } from "vitest";
import { selectToolsets } from "./toolsets.ts";

const available = ["notes", "tasks", "terminal", "agents"];

describe("selectToolsets", () => {
  it("registers everything when unset, blank, or all", () => {
    expect(selectToolsets(undefined, available)).toEqual({ names: available, unknown: [] });
    expect(selectToolsets(" ", available)).toEqual({ names: available, unknown: [] });
    expect(selectToolsets("notes,all", available)).toEqual({ names: available, unknown: [] });
  });

  it("keeps registry order and reports unknown names", () => {
    expect(selectToolsets(" Agents , notes,bogus", available)).toEqual({
      names: ["notes", "agents"],
      unknown: ["bogus"],
    });
  });
});
