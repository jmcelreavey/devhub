import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createOsc133Stream, parseOsc133 } from "./blocks";
import { quietInjectCommand } from "./inject";

const markersFrom = (line: string) => {
  let out = "";
  try {
    out = execFileSync("sh", ["-c", line], { encoding: "utf8" });
  } catch (error) {
    out = String((error as { stdout?: string }).stdout ?? "");
  }
  const markers: NonNullable<ReturnType<typeof parseOsc133>>[] = [];
  createOsc133Stream((marker) => markers.push(marker))(out);
  return markers;
};

describe("quiet inject without shell integration", () => {
  it("reports the command's own exit code with a tagged marker", () => {
    expect(markersFrom(quietInjectCommand("sleep 0; true", true))).toEqual([{ kind: "D", exitCode: 0, inject: true }]);
    expect(markersFrom(quietInjectCommand("(exit 3)", true))).toEqual([{ kind: "D", exitCode: 3, inject: true }]);
  });

  it("leaves integrated shells to report their own exit", () => {
    expect(markersFrom(quietInjectCommand("true", false))).toEqual([]);
  });
});
