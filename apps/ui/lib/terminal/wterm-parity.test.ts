import { describe, expect, it } from "vitest";
import { createOsc133OutputStream, sliceNewOutput, terminalBufferMarker } from "./blocks";

describe("wterm command output", () => {
  it("paints fragmented markers before reporting command output", () => {
    let screen = "";
    let start = "";
    let output = "";
    const stream = createOsc133OutputStream(
      (text) => { screen += text; },
      (marker) => {
        if (marker.kind === "C") start = terminalBufferMarker(screen);
        if (marker.kind === "D") output = sliceNewOutput(start, screen);
      },
      () => {},
    );
    stream("$ echo hi\r\n\x1b]0;133;C\x07\x1b]13", false);
    stream("3;C\x1b", false);
    stream("\\hi\r\n\x1b]133;D;0\x07", false);
    expect(output).toBe("hi\r\n\x1b]133;D;0\x07");
  });

  it("routes replayed markers separately from live markers", () => {
    const live: string[] = [];
    const replayed: string[] = [];
    const stream = createOsc133OutputStream(
      () => {},
      (marker) => live.push(marker.kind),
      (marker) => replayed.push(marker.kind),
    );
    stream("\x1b]133;C\x07output\x1b]133;D;0\x07", true);
    stream("\x1b]133;C\x07new output\x1b]133;D;1\x07", false);
    expect(replayed).toEqual(["C", "D"]);
    expect(live).toEqual(["C", "D"]);
  });
});
