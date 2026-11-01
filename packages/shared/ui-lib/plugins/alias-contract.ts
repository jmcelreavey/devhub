import { z } from "zod";

const path = z.string().max(240).regex(/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/);
const targetPath = z.union([z.literal("/"), path]);
const apiPath = z.string().max(240).regex(/^\/api(?:\/(?:[a-zA-Z0-9_-]+|\[[a-zA-Z][a-zA-Z0-9_]{0,63}\]))+$/)
  .refine(value => {
    const names = [...value.matchAll(/\[([a-zA-Z][a-zA-Z0-9_]*)\]/g)].map(match => match[1]);
    return new Set(names).size === names.length;
  }, "Parameter names must be unique");
export const runtimeAliasSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), path, target: targetPath }).strict(),
  z.object({ kind: z.literal("api"), path: apiPath, target: path,
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), preflight: path.optional() }).strict(),
]);
export type RuntimeAlias = z.infer<typeof runtimeAliasSchema>;

/** Match only one safe URL segment per named parameter; encoded paths are never decoded here. */
export function matchAliasPath(pattern: string, pathname: string): Record<string, string> | null {
  if (pathname.length > 240) return null;
  const expected = pattern.split("/");
  const actual = pathname.split("/");
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = Object.create(null);
  for (let index = 0; index < expected.length; index++) {
    const parameter = /^\[([a-zA-Z][a-zA-Z0-9_]*)\]$/.exec(expected[index]);
    if (parameter) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(actual[index])) return null;
      params[parameter[1]] = actual[index];
    } else if (expected[index] !== actual[index]) return null;
  }
  return params;
}

/** Two templates overlap if they can claim the same concrete URL. */
export function aliasPathsOverlap(left: string, right: string): boolean {
  const a = left.split("/");
  const b = right.split("/");
  if (a.length !== b.length) return false;
  return a.every((segment, index) => segment === b[index] || /^\[.+\]$/.test(segment) || /^\[.+\]$/.test(b[index]));
}

/** Reserve whole core namespaces, including future children and every HTTP method. */
export function aliasNamespace(path: string): string {
  return path.split("/").slice(0, path.startsWith("/api/") ? 3 : 2).join("/");
}

export function coreRouteNamespaces(files: string[]): string[] {
  return [...new Set(files.filter(file => /^apps\/ui\/app\/.*(?:page\.(?:tsx?|jsx?)|route\.(?:tsx?|jsx?))$/.test(file)).map(file => {
    const segments = file.slice("apps/ui/app/".length).split("/").slice(0, -1)
      .filter(segment => !segment.startsWith("(") && !segment.startsWith("@"));
    // A root dynamic route reserves the entire root rather than guessing its matches.
    const namespace = aliasNamespace("/" + segments.join("/"));
    return namespace.includes("[") ? namespace.startsWith("/api/") ? "/api" : "/*" : namespace;
  }).filter(namespace => namespace !== "/"))].sort();
}

export function aliasIsReserved(path: string, namespaces: readonly string[]): boolean {
  return path === "/" || path === "/api" || path.startsWith("/_") || namespaces.some(namespace =>
    namespace === "/*" || path === namespace || path.startsWith(namespace + "/"));
}
