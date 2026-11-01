import { resolveJiraBrowseDomain } from "@shared/utils.ts";

export * from "@shared/utils.ts";

function injectedJiraDomain(): unknown {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { __DEVHUB_JIRA_DOMAIN?: unknown }).__DEVHUB_JIRA_DOMAIN;
}

/**
 * Direct, external Jira browse URL for a ticket key.
 *
 * The installed app's client bundle cannot see `JIRA_DOMAIN` (and
 * `NEXT_PUBLIC_JIRA_DOMAIN` is fixed at build time, usually empty). The root
 * layout injects the configured domain before hydration so this still points
 * at Atlassian instead of the same-origin redirect — an installed PWA captures
 * same-origin links and opens them in-app, but hands cross-origin links to the
 * system browser. The redirect remains the fallback when no domain is configured.
 */
export function jiraBrowseUrl(key: string): string {
  const domain = resolveJiraBrowseDomain({
    injected: injectedJiraDomain(),
    configured: process.env.JIRA_DOMAIN,
    published: process.env.NEXT_PUBLIC_JIRA_DOMAIN,
  });
  const safeKey = encodeURIComponent(key.trim());
  if (!domain) return `/api/jira/ticket/${safeKey}/redirect`;
  return `https://${domain}/browse/${safeKey}`;
}

