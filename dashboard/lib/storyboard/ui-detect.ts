/**
 * Is this task a UI change? Decided from the files it touches, not the
 * wording of the task: the implementation's changed files once there are any,
 * else the paths its plan names. Jev's before/after videos only run for UI
 * changes; the card's toggle overrides this either way.
 */

const UI_EXTENSIONS = /\.(?:tsx|jsx|css|scss|sass|less|styl|vue|svelte|astro|html|mdx)$/i;
/** Plain .ts/.js under these is screen code (Next app routes, RN screens, components). */
const UI_DIRS = /(?:^|\/)(?:app|pages|screens|components|ui|views|layouts|styles|routes)\//i;
const NOT_UI = /(?:^|\/)(?:api|server|scripts|migrations|__tests__|__mocks__|e2e|fixtures)\/|\.(?:test|spec|stories)\.[cm]?[tj]sx?$|\.d\.ts$|(?:^|\/)route\.[tj]s$/i;
const CODE_EXT = /\.[cm]?[tj]s$/i;

export function isUiPath(file: string): boolean {
  const normalised = file.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalised || NOT_UI.test(normalised)) return false;
  return UI_EXTENSIONS.test(normalised) || (UI_DIRS.test(normalised) && CODE_EXT.test(normalised));
}

const PATH_TOKEN = /(?:^|[\s`'"(\[])((?:[\w@.-]+\/)*[\w@.-]+\.(?:tsx|jsx|ts|js|mjs|cjs|css|scss|sass|less|styl|vue|svelte|astro|html|mdx|swift|kt|py|go|rs|rb|java|json|ya?ml|sql))(?=$|[\s`'"),.:;\]])/gim;

/** File paths named in the note's ## Plan section (or the whole note when it has none). */
export function planPaths(markdown: string | null | undefined): string[] {
  if (!markdown) return [];
  const plan = markdown.match(/^##\s+Plan\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im)?.[1] ?? markdown;
  const found = new Set<string>();
  for (const match of plan.matchAll(PATH_TOKEN)) {
    const file = match[1];
    // A bare "x.ts" mention counts; a URL host like "example.com" never matches the extension list.
    if (file && !/^https?:/i.test(file)) found.add(file);
  }
  return [...found];
}

export interface UiDetection {
  detected: boolean;
  reason: string;
}

function describe(files: string[], source: "changes" | "plan touches"): string {
  const [first, ...rest] = files;
  return `${source} ${first}${rest.length ? ` and ${rest.length} more UI file${rest.length === 1 ? "" : "s"}` : ""}`;
}

export function detectUiChange(input: { changedFiles?: string[] | null; planPaths?: string[] | null }): UiDetection {
  const changed = (input.changedFiles ?? []).filter(Boolean);
  if (changed.length) {
    const ui = changed.filter(isUiPath);
    return ui.length
      ? { detected: true, reason: describe(ui, "changes") }
      : { detected: false, reason: `${changed.length} changed file${changed.length === 1 ? "" : "s"}, none of them UI` };
  }
  const planned = (input.planPaths ?? []).filter(Boolean);
  if (planned.length) {
    const ui = planned.filter(isUiPath);
    return ui.length
      ? { detected: true, reason: describe(ui, "plan touches") }
      : { detected: false, reason: `the plan names ${planned.length} file${planned.length === 1 ? "" : "s"}, none of them UI` };
  }
  return { detected: false, reason: "no changed files or planned paths yet" };
}
