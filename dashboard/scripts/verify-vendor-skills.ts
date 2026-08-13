#!/usr/bin/env tsx
/**
 * Gate vendored skills before they sync to every machine.
 *
 * Thin wrapper: the checks live in lib/skills/vendor-audit.ts and
 * lib/skills/provenance.ts so they are unit-tested rather than only exercised
 * by running this. See vendor-audit.ts for what the audit does and does not
 * claim to catch.
 */
import path from "node:path";
import { devhubVendorSkillsDir, listSkillDirNames } from "../lib/skills/shared";
import { formatProvenanceProblems, validateVendorProvenance } from "../lib/skills/provenance";
import {
  auditVendorSkillDir,
  formatVendorFindings,
  pythonFiles,
  type VendorFinding,
} from "../lib/skills/vendor-audit";

function main(): number {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const vendorDir = devhubVendorSkillsDir(repoRoot);
  const names = listSkillDirNames(vendorDir);

  if (names.length === 0) {
    console.log("No vendored skills — nothing to verify.");
    return 0;
  }

  const provenanceProblems = validateVendorProvenance(
    names.map((name) => ({ name, dir: path.join(vendorDir, name) })),
  );

  const findings: VendorFinding[] = [];
  let scriptCount = 0;
  for (const name of names) {
    const skillDir = path.join(vendorDir, name);
    scriptCount += pythonFiles(skillDir).length;
    findings.push(...auditVendorSkillDir(skillDir, vendorDir));
  }

  if (provenanceProblems.length > 0) {
    console.error(formatProvenanceProblems(provenanceProblems));
    console.error("");
  }
  if (findings.length > 0) {
    console.error(formatVendorFindings(findings));
  }
  if (provenanceProblems.length > 0 || findings.length > 0) return 1;

  console.log(
    `Vendored skills OK: ${names.length} skill(s), ${scriptCount} script(s) — ` +
      "provenance complete, no network access, stdlib only.",
  );
  console.log("Note: a grep is a floor, not a sandbox. Still read the diff on re-vendor.");
  return 0;
}

process.exit(main());
