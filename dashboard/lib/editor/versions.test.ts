import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import { activateEditorVersion, readEditorVersion } from "./versions";
it("switches only installed versions and keeps the prior runtime available for rollback", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editor-versions-"));
  try {
    for (const version of ["4.1.0", "4.2.0"]) {
      const dir = path.join(root, "versions", version, "bin");
      fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "code-server"), "");
    }
    activateEditorVersion(root, "4.2.0", "4.1.0");
    expect(readEditorVersion(root, "4.1.0")).toEqual({ active: "4.2.0", previous: "4.1.0" });
    activateEditorVersion(root, "4.1.0", "4.1.0");
    expect(readEditorVersion(root, "4.1.0")).toEqual({ active: "4.1.0", previous: "4.2.0" });
    expect(() => activateEditorVersion(root, "../escape", "4.1.0")).toThrow();
    expect(() => activateEditorVersion(root, "4.3.0", "4.1.0")).toThrow("not installed");
    expect(readEditorVersion(root, "4.1.0").active).toBe("4.1.0");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
