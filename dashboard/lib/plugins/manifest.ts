/**
 * Reads and validates a plugin's `devhub-plugin.json` manifest.
 *
 * Tolerant by design: returns a tagged result instead of throwing, so a single broken
 * plugin manifest never takes down sync for everything else.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CONTRIBUTE_KINDS, SUPPORTED_DEVHUB_API, type PluginManifest } from "./types";

export const PLUGIN_MANIFEST_FILE = "devhub-plugin.json";

/** Same slug rule as skills/MCP server names — keeps origins URL/dir safe. */
export const PLUGIN_NAME_SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;

const contributesSchema = z
  .object(Object.fromEntries(CONTRIBUTE_KINDS.map((k) => [k, z.string().min(1).optional()])))
  .strict();

const pluginNavItemSchema = z
  .object({
    href: z.string().min(1),
    label: z.string().min(1),
    icon: z.string().min(1),
    group: z.enum(["workspace", "library", "system"]),
    gate: z.string().min(1).optional(),
    desktopOnly: z.boolean().optional(),
    shortcut: z.string().min(1).optional(),
    section: z.enum(["library", "system"]).optional(),
  })
  .strict();

const dashboardSchema = z
  .object({
    root: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1),
    nav: z.array(pluginNavItemSchema).optional(),
  })
  .strict();

const brandingSchema = z
  .object({
    themeCss: z.string().min(1).optional(),
    presets: z.string().min(1).optional(),
    defaultPreset: z.string().min(1).optional(),
    defaultMode: z.enum(["dark", "light", "system"]).optional(),
    fonts: z.string().min(1).optional(),
    logo: z
      .object({
        src: z.string().min(1),
        label: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    openchamber: z
      .object({
        themes: z.string().min(1).optional(),
        defaultDarkId: z.string().min(1).optional(),
        defaultLightId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    electronIcon: z.string().min(1).optional(),
  })
  .strict();

const requiresSchema = z
  .object({
    commands: z
      .array(
        z
          .object({
            command: z.string().min(1),
            install: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const manifestSchema = z
  .object({
    name: z.string().regex(PLUGIN_NAME_SLUG, "name must be a lowercase slug"),
    version: z.string().min(1),
    devhubApi: z.enum(SUPPORTED_DEVHUB_API),
    navGate: z.string().min(1).optional(),
    contributes: contributesSchema,
    dashboard: dashboardSchema.optional(),
    branding: brandingSchema.optional(),
    requires: requiresSchema.optional(),
  })
  .strict();

export type ManifestResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; error: string };

/** Read + validate the manifest at a plugin root directory. */
export function readManifest(pluginDir: string): ManifestResult {
  const file = path.join(pluginDir, PLUGIN_MANIFEST_FILE);
  if (!fs.existsSync(file)) {
    return { ok: false, error: `missing ${PLUGIN_MANIFEST_FILE} in ${pluginDir}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    return { ok: false, error: `invalid JSON in ${file}: ${e instanceof Error ? e.message : String(e)}` };
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { ok: false, error: `invalid manifest in ${file}: ${issues}` };
  }
  return { ok: true, manifest: result.data as PluginManifest };
}
