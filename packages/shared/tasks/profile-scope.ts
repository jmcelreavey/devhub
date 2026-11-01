export function profileKey(url: string, profile: string | undefined): string | null {
  if (profile === undefined) return null;
  const [pathname, search = ""] = url.split("?");
  const params = new URLSearchParams(search);
  params.set("taskProfile", profile);
  return `${pathname}?${params}`;
}

export function taskLaunchProfile(pathname: string, params: Pick<URLSearchParams, "get">, taskId?: string): string | undefined {
  if (pathname !== "/work" || !taskId || params.get("task") !== taskId) return undefined;
  return params.get("taskProfile") || undefined;
}

export function profileHeaders(profile?: string): Record<string, string> {
  return profile === undefined ? {} : { "X-Devhub-Task-Profile": profile };
}
