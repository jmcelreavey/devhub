/** Match a task.links repo id against the local clone name and GitHub full name. */
export function repoLinkMatches(
  linkId: string,
  repoName: string,
  fullName: string | null,
  aliases: readonly string[] = [],
): boolean {
  const needle = linkId.trim().toLowerCase();
  if (!needle) return false;
  const names = new Set(
    [repoName, fullName, ...aliases]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => {
        const lower = value.toLowerCase();
        const short = lower.includes("/") ? lower.slice(lower.lastIndexOf("/") + 1) : lower;
        return short === lower ? [lower] : [lower, short];
      }),
  );
  if (names.has(needle)) return true;
  return needle.endsWith(`/${repoName.toLowerCase()}`);
}
