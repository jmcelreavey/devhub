import { describe, expect, it } from "vitest";
import { isTranslocatedAppPath } from "./translocation";

describe("isTranslocatedAppPath", () => {
  it("detects App Translocation and a mounted disk image, and ignores an installed app", () => {
    expect(isTranslocatedAppPath("/var/folders/xx/AppTranslocation/ABC/d/DevHub.app/Contents/MacOS/node")).toBe(true);
    expect(isTranslocatedAppPath("/Volumes/DevHub/DevHub.app/Contents/MacOS/node")).toBe(true);
    expect(isTranslocatedAppPath("/Volumes/Macintosh HD/Applications/DevHub.app/Contents/MacOS/node")).toBe(false);
    expect(isTranslocatedAppPath("/Applications/DevHub.app/Contents/MacOS/node")).toBe(false);
    expect(isTranslocatedAppPath("/opt/homebrew/bin/node")).toBe(false);
    expect(isTranslocatedAppPath("C:\\Users\\me\\DevHub\\node.exe")).toBe(false);
  });
});
