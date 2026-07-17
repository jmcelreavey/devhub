import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectRepoUpstart,
  importLegacyUpstartIfNeeded,
  resolveLegacyUpstartPath,
  resolveUpstartScriptPath,
  sanitizeUpstartRepoName,
  upstartScriptRelativePath,
} from "./repo-upstart";

const SAVE = {
  REPO_ROOT: process.env.REPO_ROOT,
  UPSTARTS_DIR: process.env.UPSTARTS_DIR,
};

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-upstart-"));
  process.env.REPO_ROOT = tmpRoot;
  delete process.env.UPSTARTS_DIR;
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVE)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("repo-upstart paths", () => {
  it("builds a stable relative path under upstarts/", () => {
    expect(upstartScriptRelativePath("insider-app")).toBe("upstarts/insider-app/upstart.sh");
    expect(resolveUpstartScriptPath("insider-app")).toBe(
      path.join(tmpRoot, "upstarts", "insider-app", "upstart.sh"),
    );
  });

  it("rejects path traversal in repo names", () => {
    expect(() => sanitizeUpstartRepoName("../evil")).toThrow(/Invalid/);
    expect(() => sanitizeUpstartRepoName("foo/bar")).toThrow(/Invalid/);
  });

  it("honours UPSTARTS_DIR override", () => {
    const elsewhere = path.join(tmpRoot, "elsewhere-upstarts");
    process.env.UPSTARTS_DIR = elsewhere;
    expect(resolveUpstartScriptPath("acme")).toBe(path.join(elsewhere, "acme", "upstart.sh"));
  });
});

describe("legacy import", () => {
  it("copies .devhub/upstart.sh into the private store once", () => {
    const targetRepo = path.join(tmpRoot, "target-repo");
    const legacy = resolveLegacyUpstartPath(targetRepo);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "#!/usr/bin/env bash\necho legacy\n", "utf-8");

    expect(detectRepoUpstart("target-repo", targetRepo)).toBe(true);

    const managed = resolveUpstartScriptPath("target-repo");
    expect(fs.readFileSync(managed, "utf-8")).toContain("legacy");
    expect(fs.existsSync(legacy)).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(managed), "MIGRATED.txt"))).toBe(true);

    // Second detect must not clobber edits in the private store.
    fs.writeFileSync(managed, "#!/usr/bin/env bash\necho managed\n", "utf-8");
    expect(importLegacyUpstartIfNeeded("target-repo", targetRepo)).toBe(true);
    expect(fs.readFileSync(managed, "utf-8")).toContain("managed");
  });

  it("returns false when neither store nor legacy exists", () => {
    const targetRepo = path.join(tmpRoot, "empty-repo");
    fs.mkdirSync(targetRepo, { recursive: true });
    expect(detectRepoUpstart("empty-repo", targetRepo)).toBe(false);
  });
});
