/**
 * Reads and validates a plugin's `devhub-plugin.json` manifest.
 *
 * Tolerant by design: returns a tagged result instead of throwing, so a single broken
 * plugin manifest never takes down sync for everything else.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { runtimeSchema } from "./runtime-contract";
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
    group: z.enum(["workspace", "library", "bi", "system"]),
    gate: z.string().min(1).optional(),
    desktopOnly: z.boolean().optional(),
    shortcut: z.string().min(1).optional(),
    section: z.enum(["library", "system", "bi"]).optional(),
  })
  .strict();

const dashboardSchema = z
  .object({
    root: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1),
    overlays: z.array(z.string().min(1)).optional(),
    nav: z.array(pluginNavItemSchema).optional(),
    connections: z.string().min(1).optional(),
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
    // Deprecated and ignored (DevHub no longer runs OpenChamber); kept so existing
    // manifests still pass the strict schema.
    openchamber: z
      .object({
        themes: z.string().min(1).optional(),
        defaultDarkId: z.string().min(1).optional(),
        defaultLightId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    desktopIcon: z.string().min(1).optional(),
    // Deprecated alias — see PluginBranding.electronIcon.
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
    dashboardPackages: z
      .array(
        z
          .object({
            package: z.string().min(1),
            reason: z.string().min(1).optional(),
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
    runtime: runtimeSchema.optional(),
  })
  .strict();

export type ManifestResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; error: string };

export interface ManifestIssue {
  /** Dotted manifest path, e.g. "contributes.skills", or "devhub-plugin.json" for file-level problems. */
  field: string;
  message: string;
}

export type ManifestFailureKind = "missing" | "unreadable" | "json" | "api" | "schema";

export type DetailedManifestResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; kind: ManifestFailureKind; error: string; issues: ManifestIssue[] };

/** A manifest is a few hundred bytes; anything this large is not one. */
const MAX_MANIFEST_BYTES = 256 * 1024;

/**
 * Read + validate the manifest, keeping problems apart by field so a review can
 * list them. Issue text comes from the schema, never from the file's own
 * values, except for an unknown key's name (bounded).
 */
export function readManifestDetailed(pluginDir: string): DetailedManifestResult {
  const file = path.join(pluginDir, PLUGIN_MANIFEST_FILE);
  let stat: fs.Stats;
  try {
    // Follows a symlink on purpose: folders registered by path keep working.
    // Downloaded candidates never contain one; the tree walk refuses them.
    stat = fs.statSync(file);
  } catch {
    return {
      ok: false,
      kind: "missing",
      error: `missing ${PLUGIN_MANIFEST_FILE} in ${pluginDir}`,
      issues: [{ field: PLUGIN_MANIFEST_FILE, message: `${PLUGIN_MANIFEST_FILE} was not found` }],
    };
  }
  if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) {
    return {
      ok: false,
      kind: "unreadable",
      error: `unreadable ${PLUGIN_MANIFEST_FILE} in ${pluginDir}`,
      issues: [{ field: PLUGIN_MANIFEST_FILE, message: `${PLUGIN_MANIFEST_FILE} must be a regular file under 256 KB` }],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    return {
      ok: false,
      kind: "json",
      error: `invalid JSON in ${file}: ${e instanceof Error ? e.message : String(e)}`,
      issues: [{ field: PLUGIN_MANIFEST_FILE, message: `${PLUGIN_MANIFEST_FILE} isn’t valid JSON` }],
    };
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      field: i.path.join(".") || "(root)",
      message: i.message.slice(0, 200),
    }));
    const text = issues.map((i) => `${i.field}: ${i.message}`).join("; ");
    return {
      ok: false,
      kind: issues.some((i) => i.field === "devhubApi") ? "api" : "schema",
      error: `invalid manifest in ${file}: ${text}`,
      issues,
    };
  }
  return { ok: true, manifest: result.data as PluginManifest };
}

/** Read + validate the manifest at a plugin root directory. */
export function readManifest(pluginDir: string): ManifestResult {
  const result = readManifestDetailed(pluginDir);
  return result.ok ? result : { ok: false, error: result.error };
}
