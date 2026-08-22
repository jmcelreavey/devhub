import { describe, expect, it } from "vitest";
import { parseUpstreamTrack } from "./parsers";

describe("parseUpstreamTrack", () => {
  it("reads empty track as in sync", () => {
    expect(parseUpstreamTrack("")).toEqual({ ahead: 0, behind: 0, gone: false });
    expect(parseUpstreamTrack("  ")).toEqual({ ahead: 0, behind: 0, gone: false });
  });

  it("parses ahead / behind / both, brackets included", () => {
    expect(parseUpstreamTrack("[ahead 2]")).toEqual({ ahead: 2, behind: 0, gone: false });
    expect(parseUpstreamTrack("[behind 7]")).toEqual({ ahead: 0, behind: 7, gone: false });
    expect(parseUpstreamTrack("[ahead 1, behind 4]")).toEqual({
      ahead: 1,
      behind: 4,
      gone: false,
    });
  });

  it("flags a deleted upstream", () => {
    expect(parseUpstreamTrack("[gone]")).toEqual({ ahead: 0, behind: 0, gone: true });
  });
});
