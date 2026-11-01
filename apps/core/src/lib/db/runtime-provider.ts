import { z } from "zod";
import { pluginContext, type PluginContext } from "../plugins/context";
import { invokeRuntime, runtimeCatalog, type LoadedRuntime } from "../plugins/runtime-host";
import { rows } from "../plugins/views";
import { runtimeResponse } from "../plugins/runtime-response";
import { runtimeEnvironmentValues } from "../plugins/runtime-environment";
import { DbConnectionNotFoundError, type DbConnectionProvider } from "./provider";
import type { DbConnectionRef, ResolvedDbConnection } from "./types";

const text = z.string().min(1).max(500);
const remedy = z.object({
  id: text, label: text, endpoint: text, body: z.record(z.string(), z.unknown()).optional(),
  pendingLabel: text.optional(), affectsMachineState: z.boolean().optional(),
}).strict();
// Credentials and arbitrary worker fields must never cross the public listing seam.
const refSchema = z.object({
  id: z.string().max(240).regex(/^[a-z0-9][a-zA-Z0-9:._-]*$/), label: text,
  engine: z.enum(["postgres", "mongodb", "sqlite"]), database: text.optional(),
  group: text.optional(), env: text.optional(), tone: z.enum(["neutral", "accent", "warning", "danger"]).optional(),
  accessMode: z.enum(["read", "write"]), dangerous: z.boolean(), unavailable: text.optional(),
  remedy: remedy.optional(), credentialsExpireAt: z.number().finite().positive().optional(),
}).strict();
const listSchema = z.array(refSchema).max(500);
const preflightSchema = z.object({
  ok: z.boolean(), checks: z.array(z.object({
    label: text, status: z.enum(["pass", "warn", "fail"]), detail: text.optional(), remedy: remedy.optional(),
  }).strict()).max(40),
}).strict().refine((value) => !value.ok || value.checks.every((check) => check.status !== "fail"));
const resolvedBase = z.object({
  id: refSchema.shape.id, accessMode: z.enum(["read", "write"]), dangerous: z.boolean(),
  expiresAt: z.number().finite().positive().optional(),
});
const resolvedSchema = z.discriminatedUnion("engine", [
  resolvedBase.extend({ engine: z.literal("postgres"), postgres: z.object({
    host: text, port: z.number().int().min(1).max(65535), database: text, user: text,
    password: z.string().max(16000), ssl: z.union([z.boolean(), z.object({ rejectUnauthorized: z.boolean() }).strict()]),
  }).strict() }).strict(),
  resolvedBase.extend({ engine: z.literal("mongodb"), mongodb: z.object({ uri: z.string().min(1).max(16000), database: text }).strict() }).strict(),
  resolvedBase.extend({ engine: z.literal("sqlite"), sqlite: z.object({ file: z.string().min(1).max(4000), readOnly: z.boolean() }).strict() }).strict(),
]);

function invalidResponse(): Error {
  // Never include a schema issue, child stderr or the resolved credential document.
  return new Error("The runtime database provider returned an invalid response. Review its status in Plugins.");
}

function publicResponse<T>(schema: z.ZodType<T>, value: unknown, plugin: LoadedRuntime, ctx: PluginContext): T {
  // Remedies can only call this plugin's reviewed action routes, with the usual confirmation.
  const safe = runtimeResponse(schema, value, plugin, ctx);
  const checkRemedy = (item: z.infer<typeof remedy> | undefined) => {
    if (!item) return;
    const body = item.body;
    if (item.endpoint !== `/api/plugins/runtime/${plugin.name}` || body?.kind !== "api" || body.method !== "POST" || !plugin.runtime.routes.some((route) => route.path === body.path && route.method === "POST")) throw invalidResponse();
    item.affectsMachineState = true;
  };
  if (Array.isArray(safe)) for (const ref of safe as z.infer<typeof listSchema>) checkRemedy(ref.remedy);
  else for (const check of (safe as z.infer<typeof preflightSchema>).checks) checkRemedy(check.remedy);
  return safe;
}

export function runtimeDbProviders(ctx: PluginContext = pluginContext()): { key: string; managedNames: Set<string>; providers: DbConnectionProvider[] } {
  const plugins = runtimeCatalog(ctx).filter((plugin) => plugin.runtime.capabilities?.database);
  // Disabled or damaged managed snapshots must not resurrect their compiled source provider.
  const managedNames = new Set(rows(ctx).filter((entry) => entry.managed).map((entry) => entry.name));
  return {
    key: JSON.stringify([plugins.map((plugin) => {
      const values = runtimeEnvironmentValues(plugin.runtime, ctx.env);
      return [plugin.id, plugin.root, plugin.runtime.sha256, (plugin.runtime.permissions.publicEnv ?? []).map(name => [name, values[name]])];
    }), [...managedNames]]),
    managedNames,
    providers: plugins.map((plugin): DbConnectionProvider => {
      const id = plugin.runtime.capabilities!.database!.id;
      const call = (operation: string, body?: unknown) => invokeRuntime(ctx, plugin.name, { kind: "database", path: operation, method: "POST", body });
      const list = async (): Promise<DbConnectionRef[]> => {
        const refs = publicResponse(listSchema, await call("list"), plugin, ctx);
        if (refs.some((ref) => !ref.id.startsWith(`${id}:`)) || new Set(refs.map((ref) => ref.id)).size !== refs.length) throw invalidResponse();
        return refs.map((ref) => ({ ...ref, source: `plugin:${plugin.name}` }));
      };
      const find = async (connectionId: string) => {
        const ref = (await list()).find((ref) => ref.id === connectionId);
        if (!ref) throw new DbConnectionNotFoundError(connectionId);
        return ref;
      };
      return {
        id, list,
        async preflight(connectionId, options) {
          await find(connectionId);
          return publicResponse(preflightSchema, await call("preflight", { id: connectionId, accessMode: options?.accessMode ?? "read" }), plugin, ctx);
        },
        async resolve(connectionId): Promise<ResolvedDbConnection> {
          const ref = await find(connectionId);
          const parsed = resolvedSchema.safeParse(await call("resolve", { id: connectionId }));
          if (!parsed.success) throw invalidResponse();
          const resolved = parsed.data;
          if (resolved.id !== ref.id || resolved.engine !== ref.engine || resolved.accessMode !== ref.accessMode || resolved.dangerous !== ref.dangerous || (resolved.engine === "sqlite" && resolved.sqlite.readOnly !== (ref.accessMode === "read"))) throw invalidResponse();
          return resolved;
        },
        async invalidate() {
          if (await call("invalidate") !== null) throw invalidResponse();
        },
      };
    }),
  };
}
