import { mergeEntityRefs, type EntityRef } from "@/lib/entity-note";
import { buildEntityRefFromInput } from "@/lib/entity-links/build-ref";
import { JIRA_KEY_RE } from "@/lib/utils";

/** Resolve saved text with the same refs as the composer's picker; never guess a repo. */
export function resolveTaskInput(
  text: string,
  links: EntityRef[] = [],
  repoNames: readonly string[] = [],
): { text: string; links: EntityRef[] } {
  const repos = new Set(repoNames);
  const resolved: EntityRef[] = [];
  const title = text.replace(/(^|\s)@([^\s@]+)/g, (token, space: string, name: string) => {
    if (!repos.has(name)) return token;
    resolved.push(buildEntityRefFromInput("repo", name));
    return space;
  }).trim();
  for (const match of text.matchAll(new RegExp(JIRA_KEY_RE, "g"))) {
    resolved.push(buildEntityRefFromInput("jira", match[1]));
  }
  return {
    // A title consisting only of mentions must not become empty.
    text: title || text.trim(),
    links: mergeEntityRefs(links, resolved),
  };
}
