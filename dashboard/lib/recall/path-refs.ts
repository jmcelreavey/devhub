import type { EntityRef } from "@/lib/entity-note";

function safeKnownRepos(knownRepos: readonly string[]): string[] {
  return [...new Set(knownRepos.map((name) => name.trim()).filter(Boolean))].filter(
    (name) => !name.includes("/") && !name.includes("\\") && !name.includes(".."),
  );
}

function exactRepo(value: string, knownRepos: readonly string[]): string | null {
  const lower = value.toLowerCase();
  return knownRepos.find((name) => name.toLowerCase() === lower) ?? null;
}

function repoAtSlugEnd(value: string, knownRepos: readonly string[]): string | null {
  const lower = value.toLowerCase();
  return (
    [...knownRepos]
      .sort((a, b) => b.length - a.length)
      .find((name) => lower === name.toLowerCase() || lower.endsWith(`-${name.toLowerCase()}`)) ??
    null
  );
}

function repoRef(id: string): EntityRef {
  return { kind: "repo", id, label: id };
}

/** Entity identity encoded by stable vault paths, without guessing missing boundaries. */
export function refsFromSourcePath(
  sourcePath: string,
  knownRepos: readonly string[],
): EntityRef[] {
  const relPath = sourcePath.replace(/\\/g, "/").replace(/\.json$/, "");
  const repos = safeKnownRepos(knownRepos);

  const pr = relPath.match(/^pr-reviews\/(.+)-(\d+)$/);
  if (pr) {
    const repo = repoAtSlugEnd(pr[1], repos);
    return repo ? [repoRef(repo)] : [];
  }

  const learning = relPath.match(/^learnings\/([^/]+)\//);
  if (learning) {
    const repo = exactRepo(learning[1], repos);
    return repo ? [repoRef(repo)] : [];
  }

  const task = relPath.match(/^task-notes\/(\d{4}-\d{2}-\d{2})-([^/]+)$/);
  if (task) {
    return [{ kind: "task", id: task[2], label: `Task ${task[2]}`, href: `/work?date=${task[1]}` }];
  }

  const audit = relPath.match(/^reviews\/dx-audit-(.+)-\d{4}-\d{2}-\d{2}$/);
  if (audit) {
    const repo = exactRepo(audit[1], repos);
    return [
      ...(repo ? [repoRef(repo)] : []),
      { kind: "tag", id: "dx-audit", label: "#dx-audit", href: "/work?tag=dx-audit" },
    ];
  }

  return [];
}
