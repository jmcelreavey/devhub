import { z } from "zod";
import { runtimePageHref, type PluginNavDestination } from "../../../../../packages/shared/ui-lib/navigation/nav";
import type { PluginContext } from "./context";
import { runtimeCatalog } from "./runtime-host";
import { resolveRuntimeAlias } from "./runtime-aliases";

const metadataSchema = z.object({
  href: z.string(), label: z.string().min(1).max(120), icon: z.string().min(1).max(80),
  group: z.enum(["workspace", "library", "infra", "system"]),
  gate: z.enum(["always", "calendar", "github", "jira", "datadog", "infra", "opencode", "claude", "cursor", "chatgpt", "antigravity"]).optional(),
  desktopOnly: z.boolean().optional(), sidebar: z.boolean().optional(), shortcut: z.string().max(80).optional(),
  section: z.enum(["library", "system", "infra"]).optional(),
}).strict();

/** Navigation is inert reviewed metadata. Every link is constructed by core. */
export function runtimeNavigation(ctx: PluginContext): { items: PluginNavDestination[]; errors: string[] } {
  const items: PluginNavDestination[] = [];
  const errors: string[] = [];
  for (const plugin of runtimeCatalog(ctx)) {
    try {
      const aliases = (plugin.runtime.aliases ?? []).filter(alias => alias.kind === "page");
      for (const alias of aliases) {
        const resolved = resolveRuntimeAlias(ctx, alias.path, "GET");
        if (!resolved || resolved.plugin.root !== plugin.root) throw new Error("Unavailable alias");
      }
      const metadata = z.array(metadataSchema).max(30).parse(plugin.navigation ?? []);
      const claimed = new Set<string>();
      const byPage = new Map(metadata.map(item => {
        const page = plugin.runtime.pages.find(page => item.href === runtimePageHref(plugin.name, page.path)
          || aliases.some(alias => alias.path === item.href && alias.target === page.path));
        if (!page || claimed.has(page.path)) throw new Error("Invalid navigation target");
        claimed.add(page.path);
        return [page.path, item];
      }));
      const sidebarPages = [...byPage].filter(([, item]) => item.sidebar !== false);
      items.push(...plugin.runtime.pages.map(page => ({
        label: page.label, icon: "skills", group: "infra" as const, sidebar: byPage.has(page.path),
        ...byPage.get(page.path),
        href: runtimePageHref(plugin.name, page.path),
        parent: byPage.get(page.path)?.sidebar !== false && byPage.has(page.path) ? undefined
          : (() => {
            const parent = sidebarPages.find(([, item]) => item.group === byPage.get(page.path)?.group) ?? sidebarPages[0];
            return parent ? runtimePageHref(plugin.name, parent[0]) : undefined;
          })(),
        keywords: aliases.filter(alias => alias.target === page.path).map(alias => alias.path).join(" "),
      })));
    } catch {
      errors.push(`${plugin.name}: review navigation and legacy URL conflicts in Plugins.`);
    }
  }
  return { items, errors };
}
