import { describe, expect, it } from "vitest";
import { readFocusSession } from "./focus-session-storage";

describe("readFocusSession", () => {
  it("returns null when window is undefined", () => {
    const original = globalThis.window;
    // @ts-expect-error test shim
    delete globalThis.window;
    expect(readFocusSession()).toBeNull();
    globalThis.window = original;
  });
});
