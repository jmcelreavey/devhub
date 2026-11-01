import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginContext } from "../plugins/context";
import { confirmOperation, prepareLocal, startLifecycle } from "../plugins/operations";
import { hashFile } from "../plugins/inspect";
import { readManifest } from "../plugins/manifest";
import { invokeRuntime, loadRuntime } from "../plugins/runtime-host";
import { permissionChanges, runtimeSchema } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import type { PluginOperationView } from "../../../../../packages/shared/ui-lib/plugins/model";
import { listDbConnections, preflightDbConnection, resolveDbConnection, invalidateDbConnections, resetDbRegistry } from "./registry";
import { writeUserConnections } from "./user-connections";
import { executeStatement } from "./execute";
import { resetPool } from "./pool";

const roots: string[] = [];
const secret = "fixture-private-value";
const worker = `import fs from 'node:fs'; import path from 'node:path';
let input=''; for await (const chunk of process.stdin) input+=chunk;
const request=JSON.parse(input), mode=process.env.DB_FIXTURE_MODE;
fs.appendFileSync('calls.jsonl',JSON.stringify(request)+'\\n');
if(mode==='timeout'){setInterval(()=>{},1000);} else {
if(mode==='error') throw new Error(process.env.FIXTURE_CREDENTIAL);
let result;
if(request.path==='list') {
  result=['read','write'].map(accessMode=>({id:'fixture:'+accessMode,label:accessMode==='write'?'Fixture production':'Fixture read',engine:mode==='postgres'?'postgres':'sqlite',accessMode,dangerous:accessMode==='write'}));
  if(mode==='foreign') result[0].id='local:saved';
  if(mode==='duplicate') result[1].id=result[0].id;
  if(mode==='bad-list') result[0].password=process.env.FIXTURE_CREDENTIAL;
  if(mode==='redact') result[0].unavailable=process.env.FIXTURE_CREDENTIAL;
  if(mode==='oversize') result=Array(100000).fill(result[0]);
} else if(request.path==='preflight') {
  result={ok:true,checks:[{label:'Fixture',status:'pass',detail:process.env.FIXTURE_CREDENTIAL}]};
  if(mode==='bad-preflight') result.password=process.env.FIXTURE_CREDENTIAL;
  if(mode==='bad-remedy') result.checks[0].remedy={id:'bad',label:'bad',endpoint:'/api/tasks',body:{}};
} else if(request.path==='resolve') {
  const read=request.body.id.endsWith(':read');
  result={id:request.body.id,engine:mode==='postgres'?'postgres':'sqlite',accessMode:read?'read':'write',dangerous:!read};
  if(mode==='postgres') result.postgres={host:'127.0.0.1',port:5432,database:'fixture',user:'fixture',password:process.env.FIXTURE_CREDENTIAL,ssl:false};
  else result.sqlite={file:path.join(process.cwd(),'fixture.sqlite'),readOnly:read};
  if(mode==='mismatch') result.dangerous=false;
  if(mode==='escalate') result.accessMode='write';
} else if(request.path==='invalidate') result=null;
process.stdout.write(JSON.stringify(result)); }
`;

function consent(view: PluginOperationView) {
  if (!view.preview) throw new Error("Missing fixture review");
  return { accepted: true, revision: view.preview.revision, planDigest: view.preview.planDigest, selectedTargets: [] };
}

async function fixture(mode = "sqlite") {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-db-")));
  roots.push(root);
  for (const [key, value] of Object.entries({ HOME: root, DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_PLUGIN_HOME: path.join(root, "managed"), DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets"), DEVHUB_APP_DATA: path.join(root, "app-data"), FIXTURE_CREDENTIAL: secret })) vi.stubEnv(key, value);
  const ctx = pluginContext();
  const source = path.join(root, "source");
  fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
  const parsed = readManifest(source);
  if (!parsed.ok || !parsed.manifest.runtime) throw new Error("Invalid fixture manifest");
  const manifest = parsed.manifest;
  manifest.runtime!.capabilities = { database: { id: "fixture" } };
  manifest.runtime!.permissions.env = ["FIXTURE_CREDENTIAL"];
  fs.writeFileSync(path.join(source, "worker.mjs"), worker.replace("process.env.DB_FIXTURE_MODE", JSON.stringify(mode)));
  manifest.runtime!.sha256 = hashFile(path.join(source, "worker.mjs"));
  fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
  const review = await prepareLocal(ctx, source);
  expect(review.preview?.inventory.find((group) => group.kind === "Database providers")?.entries[0]).toContain("fixture");
  expect((await confirmOperation(ctx, review.id, consent(review))).state).toBe("succeeded");
  const data = path.join(root, "managed/runtime-data", loadRuntime(ctx, "sample-tools").id);
  const calls = () => fs.readFileSync(path.join(data, "calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  return { root, ctx, manifest, data, calls };
}

afterEach(async () => {
  await resetPool();
  resetDbRegistry();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("reviewed runtime database providers", () => {
  it("fails closed for unknown capabilities and reserved namespaces; widening needs consent", async () => {
    const { manifest } = await fixture();
    const runtime = manifest.runtime!;
    expect(runtimeSchema.safeParse({ ...runtime, capabilities: { arbitrary: {} } }).success).toBe(false);
    expect(runtimeSchema.safeParse({ ...runtime, capabilities: { database: { id: "local" } } }).success).toBe(false);
    expect(permissionChanges({ ...runtime, capabilities: undefined }, runtime)).toContain("capabilities");
  });

  it("caches cheap lists, defaults preflight to read, invalidates the worker and keeps credentials server-side", async () => {
    const f = await fixture("postgres");
    const listing = await listDbConnections();
    expect(listing.errors).toEqual([]);
    expect(listing.connections[0].source).toBe("plugin:sample-tools");
    expect(JSON.stringify(listing)).not.toContain(secret);
    await listDbConnections();
    expect(f.calls().map((call) => call.path)).toEqual(["list"]);
    const preflight = await preflightDbConnection("fixture:read");
    expect(preflight.checks[0].detail).toBe("[redacted]");
    expect(f.calls().at(-1).body).toEqual({ id: "fixture:read", accessMode: "read" });
    await preflightDbConnection("fixture:write", { accessMode: "write" });
    expect(f.calls().at(-1).body.accessMode).toBe("write");
    expect((await resolveDbConnection("fixture:write")).postgres?.password).toBe(secret);
    await invalidateDbConnections();
    expect(f.calls().at(-1).path).toBe("invalidate");
    await listDbConnections();
    expect(f.calls().at(-1).path).toBe("list");
  });

  it("keeps core IDs and rejects a worker claiming another namespace", async () => {
    const f = await fixture("foreign");
    writeUserConnections([{ slug: "saved", label: "Core saved", engine: "sqlite", file: path.join(f.root, "core.sqlite") }]);
    const listing = await listDbConnections();
    expect(listing.connections.map((ref) => ref.id)).toEqual(["local:saved"]);
    expect(listing.errors).toHaveLength(1);
    expect((await resolveDbConnection("local:saved")).sqlite?.file).toBe(path.join(f.root, "core.sqlite"));
    await expect(resolveDbConnection("fixture:missing")).rejects.toThrow(/invalid response/);
  });

  it.each(["bad-list", "duplicate", "oversize", "error"])("rejects %s output without returning child bytes or secrets", async (mode) => {
    await fixture(mode);
    const listing = await listDbConnections();
    expect(listing.connections).toEqual([]);
    expect(listing.errors).toHaveLength(1);
    expect(JSON.stringify(listing)).not.toContain(secret);
    expect(JSON.stringify(listing)).not.toContain("password");
  });

  it.each(["bad-preflight", "bad-remedy"])("rejects %s without exposing credentials or arbitrary core actions", async (mode) => {
    await fixture(mode);
    await expect(preflightDbConnection("fixture:read")).rejects.toThrow(/invalid response/);
  });

  it.each(["mismatch", "escalate"])("refuses resolved %s access metadata", async (mode) => {
    await fixture(mode);
    await expect(resolveDbConnection(mode === "mismatch" ? "fixture:write" : "fixture:read")).rejects.toThrow(/invalid response/);
  });

  it("redacts declared secret values even in allowed public fields", async () => {
    await fixture("redact");
    expect((await listDbConnections()).connections[0].unavailable).toBe("[redacted]");
  });

  it("bounds a hung list with the real worker timeout", async () => {
    await fixture("timeout");
    const started = Date.now();
    const listing = await listDbConnections();
    expect(listing.errors[0].message).toMatch(/time limit/);
    expect(Date.now() - started).toBeLessThan(8000);
  });

  it("drops cached entries on disable, refuses resolve, and requires the capability for internal calls", async () => {
    const f = await fixture();
    await listDbConnections();
    const disable = await startLifecycle(f.ctx, "sample-tools", "disable");
    await confirmOperation(f.ctx, disable.id, consent(disable));
    expect((await listDbConnections()).connections).toEqual([]);
    await expect(resolveDbConnection("fixture:read")).rejects.toThrow(/No database connection/);
    const enable = await startLifecycle(f.ctx, "sample-tools", "enable");
    await confirmOperation(f.ctx, enable.id, consent(enable));
    await expect(invokeRuntime(f.ctx, "sample-tools", { kind: "database", path: "arbitrary", method: "POST" })).rejects.toThrow(/did not declare/);
  });

  it("runs real SQLite reads and writes only after the existing access and typed-confirmation gates", async () => {
    const f = await fixture();
    await listDbConnections();
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(path.join(f.data, "fixture.sqlite"));
    database.exec("CREATE TABLE entries (value TEXT); INSERT INTO entries VALUES ('before')");
    database.close();
    const read = await executeStatement({ connectionId: "fixture:read", statement: "SELECT value FROM entries" });
    expect(read.results[0].rows).toEqual([["before"]]);
    await expect(executeStatement({ connectionId: "fixture:read", statement: "DELETE FROM entries" })).rejects.toMatchObject({ code: "read_only" });
    await expect(executeStatement({ connectionId: "fixture:write", statement: "DELETE FROM entries" })).rejects.toMatchObject({ code: "confirm_required" });
    await expect(executeStatement({ connectionId: "fixture:write", statement: "DELETE FROM entries", confirm: "wrong" })).rejects.toMatchObject({ code: "confirm_required" });
    await executeStatement({ connectionId: "fixture:write", statement: "INSERT INTO entries VALUES ('after')", confirm: "Fixture production" });
    const after = await executeStatement({ connectionId: "fixture:read", statement: "SELECT value FROM entries ORDER BY value" });
    expect(after.results[0].rows).toEqual([["after"], ["before"]]);
  });
});
