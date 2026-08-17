import fs from "node:fs";
import path from "node:path";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import type { OwnedDomainOverride, RepoDomain } from "@/lib/ownership/types";

interface CodeownersRule {
  pattern: string;
  owners: string[];
}

const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

function domainId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "root";
}

export function parseCodeowners(content: string): CodeownersRule[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .flatMap((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return pattern && owners.length ? [{ pattern, owners }] : [];
    });
}

function globRegex(pattern: string): RegExp {
  const directoryPattern = pattern.endsWith("/");
  const hasWildcard = /[?*]/.test(pattern);
  let source = pattern.replace(/^\//, "").replace(/\/$/, "/**");
  source = source.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  source = source
    .replace(/\*\*\//g, "\u0001")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0001/g, "(?:.*/)?")
    .replace(/\u0000/g, ".*");
  if (!pattern.includes("/")) source = `(?:^|.*/)${source}`;
  return new RegExp(`^${source}${directoryPattern || !hasWildcard ? "(?:$|/)" : "$"}`);
}

export function codeownersForPath(rules: CodeownersRule[], filePath: string): string[] {
  let owners: string[] = [];
  for (const rule of rules) {
    if (globRegex(rule.pattern).test(filePath)) owners = rule.owners;
  }
  return owners;
}

export function readCodeowners(repoRoot: string): CodeownersRule[] {
  for (const relativePath of CODEOWNERS_PATHS) {
    try {
      return parseCodeowners(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
    } catch {
      // GitHub checks these locations in order.
    }
  }
  return [];
}

function pathPrefix(pattern: string): string {
  const clean = pattern.replace(/^\//, "");
  const wildcard = clean.search(/[?*]/);
  const beforeWildcard = wildcard === -1 ? clean : clean.slice(0, wildcard);
  const staticPart = (beforeWildcard.endsWith("/")
    ? beforeWildcard
    : beforeWildcard.slice(0, beforeWildcard.lastIndexOf("/") + 1)).replace(/\/$/, "");
  return staticPart || ".";
}

function ownersForPrefix(rules: CodeownersRule[], files: string[], prefix: string): string[] {
  const sample = files.find((file) => prefix === "." || file === prefix || file.startsWith(`${prefix}/`));
  return sample ? codeownersForPath(rules, sample) : [];
}

function workspacePaths(repoRoot: string, files: string[]): string[] {
  let workspaces: string[] = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      workspaces?: string[] | { packages?: string[] };
    };
    workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
  } catch {
    return [];
  }

  const paths = new Set<string>();
  for (const workspace of workspaces) {
    const clean = workspace.replace(/^\.\//, "").replace(/\/$/, "");
    const star = clean.indexOf("*");
    if (star === -1) {
      paths.add(clean);
      continue;
    }
    const prefix = clean.slice(0, star).replace(/\/$/, "");
    for (const file of files) {
      if (!file.startsWith(`${prefix}/`)) continue;
      const child = file.slice(prefix.length + 1).split("/")[0];
      if (child) paths.add(`${prefix}/${child}`);
    }
  }
  return [...paths].filter(Boolean).sort();
}

/**
 * Tooling directories are not domains.
 *
 * `.github`, `.vscode`, `.agents` and friends churn constantly and are never
 * what an owner needs to go and learn — left in, they crowd out real code from
 * the knowledge-gap ledger. They stay reachable through the root fallback, and
 * through CODEOWNERS-derived domains when a rule names them explicitly.
 */
function isToolingDirectory(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

function directoryPaths(files: string[]): string[] {
  for (const container of ["apps", "packages", "services", "src"]) {
    const children = new Set(
      files
        .filter((file) => file.startsWith(`${container}/`))
        .map((file) => file.split("/").slice(0, 2).join("/"))
        .filter((value) => value.includes("/")),
    );
    if (children.size >= 3 && children.size <= 20) return [...children].sort();
  }
  const top = new Set(
    files
      .filter((file) => file.includes("/"))
      .map((file) => file.split("/")[0])
      .filter((name): name is string => Boolean(name) && !isToolingDirectory(name)),
  );
  return [...top].sort().slice(0, 20);
}

function fromPaths(
  paths: string[],
  source: RepoDomain["source"],
  rules: CodeownersRule[],
  files: string[],
): RepoDomain[] {
  return paths.map((domainPath) => ({
    id: domainId(domainPath),
    label: domainPath === "." ? "Root" : domainPath,
    paths: [domainPath],
    source,
    codeowners: ownersForPrefix(rules, files, domainPath),
  }));
}

function addRootFallback(domains: RepoDomain[], rules: CodeownersRule[], files: string[]): RepoDomain[] {
  const hasUnmapped = files.some((file) => !domains.some((domain) =>
    domain.paths.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)),
  ));
  return hasUnmapped ? [...domains, ...fromPaths(["."], "directory", rules, files)] : domains;
}

export async function deriveDomains(
  repoRoot: string,
  overrides: OwnedDomainOverride[] | null = null,
): Promise<RepoDomain[]> {
  const rules = readCodeowners(repoRoot);
  const result = await runGitRepoAsync(repoRoot, ["ls-files", "-z"], { timeout: 15_000 });
  if (result.status !== 0) return [];
  const files = result.stdout.split("\0").filter(Boolean);
  if (overrides?.length) {
    return overrides.map((domain) => ({ ...domain, source: "override", codeowners: ownersForPrefix(rules, files, domain.paths[0] ?? ".") }));
  }

  const workspaces = workspacePaths(repoRoot, files);
  if (workspaces.length >= 2 && workspaces.length <= 20) {
    return addRootFallback(fromPaths(workspaces, "workspace", rules, files), rules, files);
  }

  const codeownerPaths = [...new Set(rules.map((rule) => pathPrefix(rule.pattern)))].filter((p) => p !== ".");
  if (codeownerPaths.length >= 2 && codeownerPaths.length <= 20) {
    const codeownerDomains = fromPaths(codeownerPaths, "codeowners", rules, files);
    const uncoveredDirectories = directoryPaths(files).filter((candidate) =>
      !codeownerDomains.some((domain) => candidate === domain.paths[0] || candidate.startsWith(`${domain.paths[0]}/`)),
    );
    const combined = [
      ...codeownerDomains,
      ...fromPaths(uncoveredDirectories, "directory", rules, files),
    ].slice(0, 20);
    return addRootFallback(combined, rules, files);
  }

  const directories = directoryPaths(files);
  const domains = fromPaths(directories.length ? directories : ["."], "directory", rules, files);
  return addRootFallback(domains.map((domain) => ({
    ...domain,
    codeowners: [...new Set(files
      .filter((file) => domain.paths.some((prefix) => prefix === "." || file.startsWith(`${prefix}/`) || file === prefix))
      .flatMap((file) => codeownersForPath(rules, file)))],
  })), rules, files);
}

function longestMatchingPrefix(paths: string[], filePath: string): number {
  let best = -1;
  for (const prefix of paths) {
    if (prefix === "." || filePath === prefix || filePath.startsWith(`${prefix}/`)) {
      best = Math.max(best, prefix.length);
    }
  }
  return best;
}

export function domainForPath(domains: RepoDomain[], filePath: string): RepoDomain | null {
  let best: RepoDomain | null = null;
  let bestLength = -1;
  for (const domain of domains) {
    const length = longestMatchingPrefix(domain.paths, filePath);
    if (length > bestLength) {
      best = domain;
      bestLength = length;
    }
  }
  return best;
}
