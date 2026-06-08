export interface VaultPathConfig {
  pagePrefix: string;
  apiPrefix: string;
  extension: string;
  treeRefreshEvent: string;
}

export function createVaultPathHelpers(config: VaultPathConfig) {
  const extRe = new RegExp(`${config.extension.replace(".", "\\.")}$`, "i");

  function normalizeSlug(raw: string): string {
    return raw.replace(/\\/g, "/").replace(extRe, "");
  }

  function slugFromPathname(pathname: string): string | null {
    const prefix = `${config.pagePrefix}/`;
    if (pathname === config.pagePrefix) return "";
    if (!pathname.startsWith(prefix)) return null;
    const rest = pathname.slice(prefix.length).replace(/\/$/, "");
    if (!rest) return null;
    return rest
      .split("/")
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join("/");
  }

  function pageHref(slug: string): string {
    const normalized = normalizeSlug(slug);
    if (!normalized) return config.pagePrefix;
    return `${config.pagePrefix}/${normalized
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  }

  function isPageActive(pathname: string, slug: string): boolean {
    const routeSlug = slugFromPathname(pathname);
    if (routeSlug === null) return false;
    return routeSlug === normalizeSlug(slug);
  }

  function apiPathFromSlug(slugOrPath: string): string {
    return normalizeSlug(slugOrPath)
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  function buildRenamedPath(currentSlug: string, newBaseName: string): string {
    const trimmed = newBaseName.trim();
    const segments = normalizeSlug(currentSlug).split("/").filter(Boolean);
    segments.pop();
    const dir = segments.join("/");
    return dir ? `${dir}/${trimmed}` : trimmed;
  }

  return {
    normalizeSlug,
    slugFromPathname,
    pageHref,
    isPageActive,
    apiPathFromSlug,
    buildRenamedPath,
    treeRefreshEvent: config.treeRefreshEvent,
  };
}

export type VaultPathHelpers = ReturnType<typeof createVaultPathHelpers>;
