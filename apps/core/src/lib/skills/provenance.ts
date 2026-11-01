/**
 * Skill provenance — who wrote a skill, under what licence, and where it came from.
 *
 * ## Why this exists
 *
 * DevHub syncs skills into `~/.claude/skills` and four sibling directories on
 * every machine you use. Once a skill is there it runs with the agent's full
 * permissions. Before `skills/vendor/` existed every skill in the tree was
 * yours and MIT, so provenance was implicit and nobody had to think about it.
 * The moment one Apache-2.0 skill lands, "who owns this code" stops being
 * answerable by looking at the repo licence, and redistribution obligations
 * become real — Apache-2.0 §4 wants the licence and attribution carried along.
 *
 * The upstream project already had the answer: `license`, `metadata.author`,
 * `metadata.version` and `metadata.source` in SKILL.md frontmatter. This module
 * reads those fields and the validator refuses to sync a vendored skill that
 * omits them, so the boundary cannot rot silently.
 *
 * ## Deliberately not a YAML parser
 *
 * `descriptionFromFrontmatter` in ./shared.ts already hand-rolls just enough
 * YAML to read one field, and its header comment records what that cost: ten
 * skills once reported their description as the literal string `">-"` because
 * the naive regex captured the block-scalar indicator. The same restraint
 * applies here — these are four flat scalars in a fenced block, and a real YAML
 * dependency would be a much larger surface than the problem justifies. The
 * cases this does not handle (nested maps beyond one level, anchors, multi-line
 * scalars in metadata) are cases no skill frontmatter has ever used.
 */
import fs from "node:fs";
import { frontmatterBlock, skillMdPath, unquote } from "./shared";

export interface SkillProvenance {
  /** SPDX-ish licence id, e.g. "Apache-2.0" or "MIT". */
  license: string | null;
  author: string | null;
  version: string | null;
  /** Upstream project URL. */
  source: string | null;
}

export const EMPTY_PROVENANCE: SkillProvenance = {
  license: null,
  author: null,
  version: null,
  source: null,
};

/**
 * Read provenance fields from SKILL.md frontmatter.
 *
 * `license` is top-level; `author`, `version` and `source` live one level down
 * under `metadata:`. Indentation is how we tell them apart — a top-level
 * `source:` would be a different field and is ignored rather than guessed at.
 */
export function provenanceFromFrontmatter(content: string): SkillProvenance {
  const block = frontmatterBlock(content);
  if (!block) return { ...EMPTY_PROVENANCE };

  const result: SkillProvenance = { ...EMPTY_PROVENANCE };
  let inMetadata = false;

  for (const line of block) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      inMetadata = /^metadata:\s*$/.test(line.trim());
      const license = line.match(/^license:\s*(.+?)\s*$/);
      if (license) result.license = unquote(license[1].trim()) || null;
      continue;
    }

    if (!inMetadata) continue;
    const entry = line.trim().match(/^([a-z_]+):\s*(.+?)\s*$/i);
    if (!entry) continue;
    const value = unquote(entry[2].trim()) || null;
    if (entry[1] === "author") result.author = value;
    else if (entry[1] === "version") result.version = value;
    else if (entry[1] === "source") result.source = value;
  }

  return result;
}

export function readSkillProvenance(skillDir: string): SkillProvenance {
  try {
    const file = skillMdPath(skillDir);
    if (!fs.existsSync(file)) return { ...EMPTY_PROVENANCE };
    return provenanceFromFrontmatter(fs.readFileSync(file, "utf-8"));
  } catch {
    return { ...EMPTY_PROVENANCE };
  }
}

/**
 * Fields a vendored skill must declare.
 *
 * Only enforced for `skills/vendor/`. Requiring it of your own skills would be
 * ceremony — the repo LICENSE already answers all four questions for those, and
 * a validator that fires on 22 existing skills gets suppressed rather than
 * satisfied.
 */
const REQUIRED_VENDOR_FIELDS: Array<keyof SkillProvenance> = [
  "license",
  "author",
  "version",
  "source",
];

export interface ProvenanceProblem {
  skill: string;
  missing: string[];
}

export function validateVendorProvenance(
  skills: Array<{ name: string; dir: string }>,
): ProvenanceProblem[] {
  const problems: ProvenanceProblem[] = [];
  for (const { name, dir } of skills) {
    const provenance = readSkillProvenance(dir);
    const missing = REQUIRED_VENDOR_FIELDS.filter((field) => !provenance[field]);
    if (missing.length > 0) problems.push({ skill: name, missing });
  }
  return problems;
}

export function formatProvenanceProblems(problems: ProvenanceProblem[]): string {
  return [
    `${problems.length} vendored skill${problems.length === 1 ? "" : "s"} missing provenance:`,
    ...problems.map((p) => `  ${p.skill}: no ${p.missing.join(", ")}`),
    "",
    "Vendored skills redistribute someone else's code. Add the upstream",
    "license/metadata frontmatter and record the skill in skills/vendor/NOTICE.md.",
  ].join("\n");
}
