type PaseoLink = { kind: "internal" | "external"; href: string };

export function resolvePaseoLink(raw: unknown, dashboardOrigin: string): PaseoLink | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 4096) return null;
  try {
    const dashboard = new URL(dashboardOrigin);
    const url = new URL(raw, dashboard);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
    const sameOrigin = url.origin === dashboard.origin || (
      url.protocol === dashboard.protocol && url.port === dashboard.port &&
      loopback.has(url.hostname) && loopback.has(dashboard.hostname)
    );
    if (sameOrigin && !url.pathname.startsWith("//")) {
      return { kind: "internal", href: `${url.pathname}${url.search}${url.hash}` };
    }
    return { kind: "external", href: url.href };
  } catch {
    return null;
  }
}
