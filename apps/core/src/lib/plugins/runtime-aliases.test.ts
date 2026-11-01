import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { aliasIsReserved, coreRouteNamespaces } from "../../../../../packages/shared/ui-lib/plugins/alias-contract";
import { runtimeSchema, runtimeInventory } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { pluginContext } from "./context";
import { readManifest } from "./manifest";
import { confirmOperation, prepareLocal, startLifecycle } from "./operations";
import { handleRuntimeAlias, resolveRuntimeAlias } from "./runtime-aliases";
import { hashFile } from "./inspect";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const reserved = ["/api/tasks", "/plugins", "/work"];

async function fixture(includeDelete = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-aliases-")));
  roots.push(root);
  for (const [key, value] of Object.entries({ HOME: root, DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_PLUGIN_HOME: path.join(root, "managed"), DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets"), DEVHUB_BIND_HOST: "127.0.0.1", DEVHUB_CORE_ROUTE_NAMESPACES: JSON.stringify(reserved) })) vi.stubEnv(key, value);
  const source = path.join(root, "source");
  fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
  const read = readManifest(source);
  if (!read.ok || !read.manifest.runtime) throw new Error("Bad fixture");
  const manifest = read.manifest;
  const runtime = manifest.runtime!;
  runtime.pages = [{ path: "/review", label: "Review" }];
  const methods = includeDelete ? ["GET", "POST", "DELETE"] as const : ["GET", "POST"] as const;
  runtime.routes = methods.map(method => ({ path: "/api/review", method }));
  runtime.aliases = [{ kind: "page", path: "/old-review", target: "/review" }, ...methods.map(method => ({ kind: "api" as const, path: "/api/old-review", target: "/api/review", method }))];
  fs.writeFileSync(path.join(source, runtime.entry), 'let text="";for await(const chunk of process.stdin)text+=chunk;const request=JSON.parse(text);console.log(JSON.stringify({status:request.method==="POST"?201:200,body:request.body}));');
  runtime.sha256 = hashFile(path.join(source, runtime.entry));
  fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
  const ctx = pluginContext({ home: root, repoRoot: root, env: { ...process.env, NODE_ENV: "test" } });
  const install = async (directory = source, replace = false) => {
    const operation = await prepareLocal(ctx, directory, { reviewRuntimeReplacement: replace });
    if (!operation.preview) throw new Error("No preview");
    expect(operation.preview.canApply).toBe(true);
    expect((await confirmOperation(ctx, operation.id, { accepted: true, revision: operation.preview.revision, planDigest: operation.preview.planDigest, selectedTargets: [] })).state).toBe("succeeded");
  };
  await install();
  return { root, source, ctx, runtime, manifest, install };
}

it("validates and reviews aliases without allowing undeclared targets, streams or ambiguous paths", async () => {
  const { runtime } = await fixture();
  expect(runtimeInventory(runtime).find(group => group.kind === "Legacy URLs")?.entries).toContain("GET /old-review → /review · core routes and other plugins cannot be replaced");
  for (const path of ["/", "/a/../b", "/a//b", "/a/", "/a%2fb", "/a?x=b", "//evil", "/a\\b"]) expect(runtimeSchema.safeParse({ ...runtime, aliases: [{ kind: "page", path, target: "/review" }] }).success).toBe(false);
  for (const aliases of [
    [{ kind: "page", path: "/old", target: "/missing" }],
    [{ kind: "page", path: "/api/old", target: "/review" }],
    [{ kind: "api", path: "/api/old", target: "/api/review", method: "DELETE" }],
    [runtime.aliases![0], runtime.aliases![0]],
  ]) expect(runtimeSchema.safeParse({ ...runtime, aliases }).success).toBe(false);
  expect(runtimeSchema.safeParse({ ...runtime, routes: runtime.routes.map(route => ({ ...route, stream: true })) }).success).toBe(false);
});

it("reserves static, grouped and dynamic core namespaces for every method", () => {
  const namespaces = coreRouteNamespaces(["apps/ui/app/page.tsx", "apps/ui/app/(work)/tasks/[id]/page.tsx", "apps/ui/app/api/tasks/[id]/route.ts", "apps/ui/app/@slot/(group)/setup/page.tsx", "apps/ui/app/api/things/[...path]/route.ts", "apps/ui/app/not-a-route.ts"]);
  expect(namespaces).toEqual(["/api/tasks", "/api/things", "/setup", "/tasks"]);
  for (const url of ["/", "/tasks", "/tasks/new", "/api/tasks/future", "/_next/server"]) expect(aliasIsReserved(url, namespaces)).toBe(true);
  expect(aliasIsReserved("/tasks-other", namespaces)).toBe(false);
  expect(aliasIsReserved("/any", coreRouteNamespaces(["apps/ui/app/[...path]/page.tsx"]))).toBe(true);
});

it("fails closed on core and cross-plugin collisions, disabled owners, tampering and undeclared methods", async () => {
  const { ctx, runtime, source, manifest, install } = await fixture();
  expect(resolveRuntimeAlias(ctx, "/old-review", "GET", reserved)?.plugin.name).toBe("sample-tools");
  expect(resolveRuntimeAlias(ctx, "/old-review", "GET", ["/old-review"])).toBeNull();
  expect(() => resolveRuntimeAlias(ctx, "/api/old-review", "DELETE", reserved)).toThrow(expect.objectContaining({ status: 405 }));
  const disable = await startLifecycle(ctx, "sample-tools", "disable");
  if (!disable.preview) throw new Error("No preview");
  await confirmOperation(ctx, disable.id, { accepted: true, revision: disable.preview.revision, planDigest: disable.preview.planDigest, selectedTargets: [] });
  expect(() => resolveRuntimeAlias(ctx, "/old-review", "GET", reserved)).toThrow(expect.objectContaining({ status: 404 }));
  const other = path.join(path.dirname(source), "other");
  fs.cpSync(source, other, { recursive: true });
  fs.writeFileSync(path.join(other, "devhub-plugin.json"), JSON.stringify({ ...manifest, name: "other-tools" }));
  await install(other);
  expect(() => resolveRuntimeAlias(ctx, "/old-review", "GET", reserved)).toThrow(expect.objectContaining({ code: "ALIAS_COLLISION" }));
  expect(runtime.aliases).toHaveLength(3);
});

it("forwards the legacy query/body and JSON status without an envelope, enforces origin, and follows reviewed replacement", async () => {
  const { ctx, source, manifest, install } = await fixture();
  const request = (method = "GET", origin = "http://localhost:1437") => new Request("http://localhost:1437/api/old-review?year=2026&year=2000&subject=fixture", { method, headers: { host: "localhost:1437", origin, "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify({ goal: "g1" }) } : {}) });
  const get = await handleRuntimeAlias(request(), ctx);
  expect(get.status).toBe(200);
  expect(await get.json()).toEqual({ query: { year: "2026", subject: "fixture" } });
  const post = await handleRuntimeAlias(request("POST"), ctx);
  expect(post.status).toBe(201);
  expect(await post.json()).toEqual({ query: { year: "2026", subject: "fixture" }, body: { goal: "g1" } });
  expect((await handleRuntimeAlias(request("POST", "http://foreign.invalid"), ctx)).status).toBe(403);
  const old = resolveRuntimeAlias(ctx, "/old-review", "GET", reserved)!.plugin;
  manifest.runtime!.aliases![0] = { kind: "page", path: "/new-review", target: "/review" };
  fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
  await install(source, true);
  expect(resolveRuntimeAlias(ctx, "/old-review", "GET", reserved)).toBeNull();
  expect(resolveRuntimeAlias(ctx, "/new-review", "GET", reserved)!.plugin.revision).not.toBe(old.revision);
  fs.appendFileSync(path.join(resolveRuntimeAlias(ctx, "/new-review", "GET", reserved)!.plugin.root, manifest.runtime!.entry), "\n// tampered");
  expect(() => resolveRuntimeAlias(ctx, "/new-review", "GET", reserved)).toThrow(expect.objectContaining({ code: "RUNTIME_CHANGED" }));
});

it("forwards a reviewed DELETE with or without a JSON body", async () => {
  const { ctx } = await fixture(true);
  const headers = { host: "localhost:1437", origin: "http://localhost:1437", "content-type": "application/json" };
  const empty = await handleRuntimeAlias(new Request("http://localhost:1437/api/old-review", { method: "DELETE", headers }), ctx);
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual({ query: {} });
  const emptyStream = await handleRuntimeAlias(new Request("http://localhost:1437/api/old-review", { method: "DELETE", headers, body: "" }), ctx);
  expect(emptyStream.status).toBe(200);
  expect(await emptyStream.json()).toEqual({ query: {} });
  const supplied = await handleRuntimeAlias(new Request("http://localhost:1437/api/old-review", { method: "DELETE", headers, body: JSON.stringify({ id: "fixture" }) }), ctx);
  expect(await supplied.json()).toEqual({ query: {}, body: { id: "fixture" } });
});
