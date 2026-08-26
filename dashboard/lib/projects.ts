import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { slugify } from "@/lib/entity-note";

/**
 * Repo projects — named groups of repos that belong to one piece of work
 * ("acme-api + demo-app"). Deliberately hand-edited config, not derived data:
 * co-occurrence could suggest membership, but a wrong project is worse than
 * no project, and the set of repos you consider "one thing" is knowledge only
 * you have. Add a group to ~/.config/devhub/projects.json:
 *
 *   [{ "label": "Job Agent", "repos": ["acme-api", "demo-app"] }]
 */

export interface RepoProject {
  id: string;
  label: string;
  repos: string[];
}

function projectsFile(): string {
  const explicit = process.env.DEVHUB_PROJECTS_FILE?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(os.homedir(), ".config", "devhub", "projects.json");
}

/** Tolerant parse: drop anything without at least one repo, slugify the id. */
export function normaliseProjects(raw: unknown): RepoProject[] {
  if (!Array.isArray(raw)) return [];
  const out: RepoProject[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const repos = Array.isArray(record.repos)
      ? [...new Set(record.repos.filter((r): r is string => typeof r === "string" && !!r.trim()).map((r) => r.trim()))]
      : [];
    if (repos.length === 0) continue;
    const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : repos[0];
    const requestedId = typeof record.id === "string" ? record.id.trim() : "";
    let id = /^[a-z0-9-]+$/.test(requestedId) ? requestedId : slugify(label, { fallback: "project" });
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    out.push({ id, label, repos });
  }
  return out;
}

export function listProjects(): RepoProject[] {
  try {
    return normaliseProjects(JSON.parse(fs.readFileSync(projectsFile(), "utf-8")));
  } catch {
    return [];
  }
}

export function writeProjects(projects: RepoProject[]): RepoProject[] {
  const normalised = normaliseProjects(projects);
  const file = projectsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(normalised, null, 2)}
`, "utf-8");
  return normalised;
}
