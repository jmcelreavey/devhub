import { describe, expect, it } from "vitest";
import { listenPortFromPayload } from "./use-lazy-service-port";

describe("listenPortFromPayload", () => {
  it("takes a numeric port", () => {
    expect(listenPortFromPayload({ port: 49640 }, true)).toEqual({ port: 49640, error: null });
  });

  it("surfaces Forbidden instead of pretending start is still in progress", () => {
    expect(listenPortFromPayload({ error: "Forbidden" }, false)).toEqual({
      port: null,
      error: "Forbidden",
    });
  });

  it("does not treat a missing port on 200 as success", () => {
    expect(listenPortFromPayload({}, true)).toEqual({
      port: null,
      error: "Did not return a port.",
    });
  });
});
