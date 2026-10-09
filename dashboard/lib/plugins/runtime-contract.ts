import { z } from "zod";

const relative = z.string().max(240).regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/).refine((s) => s.split("/").every((p) => p !== "." && p !== ".." && p !== ""), "Use a confined relative path");
const homePath = z.string().max(240).regex(/^~\/[a-zA-Z0-9_.-][a-zA-Z0-9_./-]*$/).refine((s) => s.slice(2).split("/").every((p) => p !== "." && p !== ".." && p !== ""), "Use a specific path beneath the home directory");
const command = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);
const label = z.string().min(1).max(120);
const route = z.string().max(240).regex(/^\/[a-zA-Z0-9_/-]*$/).refine((s) => !s.includes("//"));
const envName = z.string().regex(/^[A-Z][A-Z0-9_]{0,80}$/).refine((name) => !/^(NODE|DEVHUB|NPM|LD_|DYLD_|PATH$|HOME$|TMP|TEMP|XDG_|BASH|ENV$|SHELL$|PYTHON|RUBY|PERL)/.test(name), "Runtime control variables cannot be requested");
const colour = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const tokens = z.object({ bg: colour, text: colour, accent: colour, border: colour }).strict();
const asset = z.object({ path: relative, sha256: digest }).strict();

export const runtimeSchema = z.object({
  api: z.literal("1"),
  transport: z.literal("request-worker"),
  entry: relative.refine((s) => s.endsWith(".mjs"), "Bundle must be an .mjs file"),
  sha256: digest,
  lockfile: asset,
  pages: z.array(z.object({ path: route, label }).strict()).max(30),
  routes: z.array(z.object({ path: route, method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]) }).strict()).max(100),
  mcp: z.array(z.object({ name: slug, description: label }).strict()).max(20),
  permissions: z.object({
    env: z.array(envName).max(40),
    network: z.array(z.string().min(1).max(240)).max(40),
    exec: z.boolean(),
    read: z.array(homePath).max(20).optional(),
    commands: z.array(command).max(20).optional(),
  }).strict(),
  branding: z.object({
    label,
    dark: tokens,
    light: tokens,
    logo: asset.refine((a) => /\.(png|webp)$/.test(a.path), "Use a PNG or WebP logo").optional(),
    font: asset.refine((a) => a.path.endsWith(".woff2"), "Use a WOFF2 font").optional(),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  for (const [key, names] of [
    ["pages", value.pages.map((p) => p.path)],
    ["routes", value.routes.map((p) => `${p.method} ${p.path}`)],
    ["mcp", value.mcp.map((p) => p.name)],
  ] as const) {
    if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", path: [key], message: "Duplicate runtime entry" });
  }
});

export type RuntimeContribution = z.infer<typeof runtimeSchema>;

/** Conservative comparison: changing executable bytes always requires fresh consent. */
export function permissionChanges(previous: RuntimeContribution, next: RuntimeContribution): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)] as (keyof RuntimeContribution)[]);
  return [...keys].filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
}

export function runtimeInventory(runtime: RuntimeContribution): { kind: string; entries: string[]; note: string | null; more: number }[] {
  const group = (kind: string, entries: string[]) => ({ kind, entries: entries.length ? entries : ["None declared."], note: null, more: 0 });
  return [
    group("Pages", runtime.pages.map((p) => `${p.label}: ${p.path}`)),
    group("API routes", runtime.routes.map((p) => `${p.method} ${p.path}`)),
    group("MCP servers and commands", runtime.mcp.map((p) => `${p.name}: bundled Node ${runtime.entry} (request-worker)`)),
    group("Environment and secrets", runtime.permissions.env),
    group("Network access (declared, not enforced)", runtime.permissions.network),
    group("Read-only home paths", runtime.permissions.read ?? []),
    group("Commands", [runtime.permissions.exec ? "May start child processes with your user account" : "Child processes blocked by Node permissions", ...(runtime.permissions.commands ?? []).map((name) => `Discover on PATH: ${name}`)]),
    group("Branding", runtime.branding ? [runtime.branding.label, "Dark and light colour presets", ...(runtime.branding.logo ? [runtime.branding.logo.path] : []), ...(runtime.branding.font ? [runtime.branding.font.path] : [])] : []),
    group("Bundle SHA-256", [runtime.sha256]),
    group("Lockfile SHA-256", [runtime.lockfile.sha256]),
  ];
}
