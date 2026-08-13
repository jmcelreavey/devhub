/**
 * Avatar CDN allowlist shared by client `<img>` sources and server-side
 * identity maps. Anything that lands in an img src from remote data goes
 * through here.
 */

function px(size: number): number {
  return size * 2;
}

export function isTrustedAvatarHost(hostname: string): boolean {
  return (
    hostname === "avatars.githubusercontent.com" ||
    hostname === "github.com" ||
    hostname.endsWith(".atl-paas.net") ||
    hostname.endsWith(".atlassian.com") ||
    hostname.endsWith(".atlassian.net")
  );
}

/**
 * Accept only known avatar CDNs. GitHub URLs get a size hint; Atlassian URLs
 * are used as-is (their size is baked into the path / query already).
 */
export function trustedAvatarUrl(url: string, size: number): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !isTrustedAvatarHost(parsed.hostname)) {
      return null;
    }
    if (parsed.hostname === "avatars.githubusercontent.com") {
      parsed.searchParams.set("s", String(px(size)));
      return parsed.toString();
    }
    if (parsed.hostname === "github.com" && parsed.pathname.endsWith(".png")) {
      parsed.searchParams.set("size", String(px(size)));
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

const FULL_PX = 512;

/**
 * Highest-res variant of a URL we already decided to display. GitHub and
 * Gravatar take a size query; Atlassian bakes size into `/N48x48/` or `s` /
 * `size`.
 *
 * Not a trust check — callers must pass a URL already accepted for `<img src>`
 * (`trustedAvatarUrl`, a GitHub noreply URL, or Gravatar from this module).
 * Unknown hosts return null. Gravatar is sized here even though
 * `isTrustedAvatarHost` rejects it, because the chain already vetted that URL.
 */
export function fullResolutionAvatarUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;

    if (parsed.hostname === "avatars.githubusercontent.com") {
      parsed.searchParams.set("s", String(FULL_PX));
      return parsed.toString();
    }
    if (parsed.hostname === "github.com" && parsed.pathname.endsWith(".png")) {
      parsed.searchParams.set("size", String(FULL_PX));
      return parsed.toString();
    }
    if (
      parsed.hostname === "www.gravatar.com" ||
      parsed.hostname === "gravatar.com" ||
      parsed.hostname === "secure.gravatar.com"
    ) {
      parsed.searchParams.set("s", String(FULL_PX));
      return parsed.toString();
    }
    if (!isTrustedAvatarHost(parsed.hostname)) return null;

    parsed.pathname = parsed.pathname.replace(/\/N\d+x\d+(?=\/|$)/, `/N${FULL_PX}x${FULL_PX}`);
    if (parsed.searchParams.has("s")) parsed.searchParams.set("s", String(FULL_PX));
    const size = parsed.searchParams.get("size");
    if (size === "xsmall" || size === "small" || size === "medium" || size === "large") {
      parsed.searchParams.set("size", "xlarge");
    } else if (size && /^\d+$/.test(size)) {
      parsed.searchParams.set("size", String(FULL_PX));
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
