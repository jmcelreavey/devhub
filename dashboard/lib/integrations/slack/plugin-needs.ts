import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listEnabledPlugins } from "@/lib/plugins/registry";
import { resolvePluginPaths } from "@/lib/plugins/paths";
import type { SlackNeed } from "./needs-you-source";

/** Items one plugin can have waiting at a time, and the longest text kept from each. */
const MAX_ITEMS = 20;
const MAX_FILE_BYTES = 256 * 1024;

export interface PluginNeedsOptions {
  home?: string;
  /** Where plugins leave their files. Defaults to `plugin-needs/` beside the plugin registry. */
  dir?: string;
}

export function pluginNeedsDir(home = os.homedir()): string {
  return path.join(resolvePluginPaths({ home }).configDir, "plugin-needs");
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, max) : undefined;
}

/**
 * One item a plugin says needs John, made safe to post. Every field is optional on the plugin's side: a
 * missing title falls back to the plugin's name, a missing reason to "Waiting on you", a missing link to the
 * DevHub home page, so a sparse item still posts a card with an Open link instead of vanishing.
 */
export function normalizePluginNeed(plugin: string, profile: string, raw: unknown, index: number): SlackNeed {
  const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const title = text(item.title, 200) ?? `${plugin} needs you`;
  const needed = text(item.reason, 300) ?? "Waiting on you";
  // A page inside DevHub. Anything else opens the dashboard home, so a plugin can't put another site's link on a card.
  const link = text(item.href, 500);
  const href = link?.startsWith("/") && !link.startsWith("//") && !link.includes("\\") ? link : "/";
  const id = text(item.id, 100) ?? createHash("sha256").update(JSON.stringify([index, title])).digest("hex").slice(0, 16);
  return {
    profile, entityId: `plugin:${plugin}:${id}`, title, needed, href, action: "open",
    itemKey: createHash("sha256").update(JSON.stringify([title, needed])).digest("hex"),
  };
}

/**
 * Attention items that enabled plugins want shown with Needs you. A plugin leaves
 * `plugin-needs/<plugin-name>.json` — `{ "items": [{ "id", "title", "reason", "href" }] }` — beside the plugin
 * registry; DevHub reads it on each Needs-you pass. Only files for plugins that are enabled right now are read,
 * so removing a plugin clears its items. A missing, oversized or malformed file contributes nothing.
 */
export function readPluginNeeds(profile: string, options: PluginNeedsOptions = {}): SlackNeed[] {
  const home = options.home ?? os.homedir();
  const dir = options.dir ?? pluginNeedsDir(home);
  return listEnabledPlugins(home).flatMap((plugin) => {
    const file = path.join(dir, `${plugin.name}.json`);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return [];
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      const items = parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items) ? (parsed as { items: unknown[] }).items : [];
      return items.slice(0, MAX_ITEMS).map((raw, index) => normalizePluginNeed(plugin.name, profile, raw, index));
    } catch { return []; }
  });
}
