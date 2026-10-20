export function profileKey(url: string, profile: string | undefined): string | null {
  if (profile === undefined) return null;
  const [pathname, search = ""] = url.split("?");
  const params = new URLSearchParams(search);
  params.set("taskProfile", profile);
  return `${pathname}?${params}`;
}

export function profileHeaders(profile?: string): Record<string, string> {
  return profile === undefined ? {} : { "X-Devhub-Task-Profile": profile };
}
