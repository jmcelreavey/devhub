/** Page URL input is untrusted; cap it below the runtime request body limit. */
export function runtimePageQuery(search: string): Record<string, string> | null {
  if (search.length > 4096) return null;
  const params = new URLSearchParams(search);
  const query: Array<[string, string]> = [];
  for (const key of new Set(params.keys())) {
    if (key !== "page") query.push([key, params.get(key)!]);
  }
  return Object.fromEntries(query);
}
