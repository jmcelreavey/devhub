import path from "node:path";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { auditPythonSource, auditVendorSkillDir, pythonFiles } from "./vendor-audit";
import { devhubVendorSkillsDir } from "./shared";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

describe("auditPythonSource", () => {
  it("passes a stdlib-only offline script", () => {
    const src = "import json\nimport subprocess\nfrom collections import Counter\n";
    expect(auditPythonSource(src, "ok.py")).toEqual([]);
  });

  it("flags network stdlib imports with a line number", () => {
    const src = "import json\nimport urllib.request\n";
    const findings = auditPythonSource(src, "bad.py");
    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toContain("network stdlib import");
    expect(findings[0].line).toBe(2);
  });

  it("flags third-party HTTP clients", () => {
    const findings = auditPythonSource("import requests\n", "bad.py");
    expect(findings.some((f) => f.problem.includes("third-party HTTP client"))).toBe(true);
  });

  it("flags a curl subprocess even without a network import", () => {
    const src = 'import subprocess\nsubprocess.run(["curl", "https://example.com"])\n';
    const findings = auditPythonSource(src, "bad.py");
    expect(findings.some((f) => f.problem.includes("curl/wget"))).toBe(true);
  });

  it("flags urlopen calls", () => {
    const findings = auditPythonSource("x = urlopen(url)\n", "bad.py");
    expect(findings.some((f) => f.problem.includes("URL fetch call"))).toBe(true);
  });

  it("flags a non-stdlib import", () => {
    const findings = auditPythonSource("import numpy as np\n", "bad.py");
    expect(findings).toEqual([
      { file: "bad.py", problem: "non-stdlib import: numpy", line: 1 },
    ]);
  });

  it("allows __future__ and sibling modules", () => {
    const src = "from __future__ import annotations\nimport helpers\n";
    expect(auditPythonSource(src, "ok.py", new Set(["helpers"]))).toEqual([]);
  });

  it("does not flag the word socket in a comment", () => {
    // The patterns target calls and imports, not prose — a check that fires on
    // documentation gets suppressed rather than fixed.
    const src = "# we deliberately avoid socket access here\nimport json\n";
    expect(auditPythonSource(src, "ok.py")).toEqual([]);
  });
});

describe("the real vendored skills", () => {
  const vendorDir = devhubVendorSkillsDir(REPO_ROOT);
  const hasVendor = fs.existsSync(vendorDir) && pythonFiles(vendorDir).length > 0;
  const describeIfVendor = hasVendor ? describe : describe.skip;

  describeIfVendor("when skills/vendor is present", () => {
  it("ship at least one script", () => {
    expect(pythonFiles(vendorDir).length).toBeGreaterThan(0);
  });

  it("are offline and stdlib-only", () => {
    // This is the assertion NOTICE.md makes to the reader. If a re-vendor
    // introduces a network call, this test is what says so.
    expect(auditVendorSkillDir(vendorDir, vendorDir)).toEqual([]);
  });
  });
});
