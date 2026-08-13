import { describe, expect, it } from "vitest";
import { statusTone } from "./status";

describe("statusTone", () => {
  it("keeps pending and failing out of the success state", () => {
    expect(statusTone("passing")).toBe("ok");
    expect(statusTone("pending")).toBe("bad");
    expect(statusTone("failing")).toBe("bad");
    expect(statusTone("unknown")).toBe("unknown");
  });
});
