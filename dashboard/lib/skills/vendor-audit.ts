/**
 * Static audit of vendored skill scripts.
 *
 * ## Why this is asserted rather than remembered
 *
 * A vendored skill is code someone else wrote that DevHub copies into
 * `~/.claude/skills` and four sibling directories, where an agent runs it with
 * your shell, your files and your credentials. It gets reviewed once on the way
 * in. The risk is the *second* import: re-vendor is copy-from-upstream (sparse
 * clone, eyeball the Python, `cp` into `skills/vendor/`, then
 * `npm run skills:verify-vendor`) — see `docs/guides/vendored-skills.md`. The
 * diff is 900 lines of Python, and "it's just a version bump" is exactly how a
 * network call gets waved through.
 *
 * So the two properties `skills/vendor/NOTICE.md` claims — offline, and stdlib
 * only — are checked by code instead of by memory.
 *
 * ## What this is not
 *
 * Not a sandbox and not a malware scanner. It matches the obvious ways a Python
 * script reaches the network, and anything determined to hide one (base64,
 * `getattr` indirection, an exotic shell-out) will get past it. It raises the
 * floor; it does not replace reading the diff. The failure message says so too,
 * because a check that implies more assurance than it delivers is worse than no
 * check at all.
 */
import fs from "node:fs";
import path from "node:path";

/** Import names and calls that mean a script can reach off the machine. */
const NETWORK_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /^\s*(?:import|from)\s+(?:urllib|http|socket|ftplib|smtplib|telnetlib)\b/m,
    label: "network stdlib import",
  },
  {
    pattern: /^\s*(?:import|from)\s+(?:requests|httpx|aiohttp|urllib3)\b/m,
    label: "third-party HTTP client",
  },
  { pattern: /\b(?:urlopen|urlretrieve)\s*\(/, label: "URL fetch call" },
  { pattern: /["'](?:curl|wget)["']/, label: "curl/wget subprocess" },
  { pattern: /\bsocket\.(?:socket|create_connection)\s*\(/, label: "raw socket" },
];

/**
 * Modules these scripts may import.
 *
 * Deliberately an allowlist. A denylist of "bad" modules has to predict what
 * upstream might add; this only has to describe what the current scripts
 * actually use, and anything new shows up as a finding to look at rather than
 * silently passing. A third-party import would also break the clone-and-run
 * promise, since it implies an install step nobody runs.
 */
const STDLIB_ALLOWLIST = new Set([
  "argparse", "collections", "dataclasses", "datetime", "difflib", "enum",
  "fnmatch", "functools", "glob", "hashlib", "itertools", "json", "math",
  "os", "pathlib", "re", "shlex", "shutil", "statistics", "string",
  "subprocess", "sys", "textwrap", "time", "typing", "unicodedata", "uuid",
  // Networking stdlib is listed here so it is reported once, by NETWORK_PATTERNS,
  // with a label that says what is actually wrong. Left out, `import urllib`
  // also trips the non-stdlib rule and the reader gets two findings for one
  // line, the vaguer of which is misleading — urllib *is* stdlib.
  "urllib", "http", "socket", "ftplib", "smtplib", "telnetlib",
]);

export interface VendorFinding {
  file: string;
  problem: string;
  line: number;
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

/** Find every `.py` file under a directory. */
export function pythonFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".py")) found.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

/**
 * Audit one script's source.
 *
 * `siblingModules` are module names that live beside the script, so a skill
 * splitting itself across files is not reported as a third-party dependency.
 */
export function auditPythonSource(
  content: string,
  file: string,
  siblingModules: ReadonlySet<string> = new Set(),
): VendorFinding[] {
  const findings: VendorFinding[] = [];

  for (const { pattern, label } of NETWORK_PATTERNS) {
    const match = pattern.exec(content);
    if (match) {
      findings.push({
        file,
        problem: `${label}: ${match[0].trim()}`,
        line: lineOf(content, match.index),
      });
    }
  }

  const importRe = /^\s*(?:import|from)\s+([A-Za-z_][\w.]*)/gm;
  for (let m = importRe.exec(content); m; m = importRe.exec(content)) {
    const root = m[1].split(".")[0];
    if (root === "__future__" || STDLIB_ALLOWLIST.has(root)) continue;
    if (siblingModules.has(root)) continue;
    findings.push({
      file,
      problem: `non-stdlib import: ${root}`,
      line: lineOf(content, m.index),
    });
  }

  return findings;
}

export function auditVendorSkillDir(skillDir: string, relativeTo: string): VendorFinding[] {
  const findings: VendorFinding[] = [];
  for (const file of pythonFiles(skillDir)) {
    const siblings = new Set(
      fs
        .readdirSync(path.dirname(file))
        .filter((n) => n.endsWith(".py"))
        .map((n) => n.slice(0, -3)),
    );
    const content = fs.readFileSync(file, "utf-8");
    findings.push(
      ...auditPythonSource(content, path.relative(relativeTo, file), siblings),
    );
  }
  return findings;
}

export function formatVendorFindings(findings: VendorFinding[]): string {
  return [
    `${findings.length} problem(s) in vendored skill scripts:`,
    "",
    ...findings.map((f) => `  ${f.file}:${f.line} — ${f.problem}`),
    "",
    "These scripts run with your agent's full permissions on every machine",
    "DevHub syncs to. Read the diff before overriding this.",
  ].join("\n");
}
