import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { pluginContext } from "../plugins/context";
import { hashFile } from "../plugins/inspect";
import { readManifest } from "../plugins/manifest";
import { confirmOperation, prepareLocal, startLifecycle } from "../plugins/operations";
import { invokeRuntime, loadRuntime } from "../plugins/runtime-host";
import type { PluginOperationView } from "../../../../../packages/shared/ui-lib/plugins/model";
import { providers, providerFor } from "./registry";
import { WriteInputSchema } from "./write-types";
import { writeNow } from "./write-store";
import * as dashboardEnv from "../dashboard-env-local";

const roots: string[] = [];
const signal = () => AbortSignal.timeout(5000);
const ref = { provider: "fixture", account: "default", kind: "issue", id: "ITEM-1" } as const;
const write = { action: "issue.create", provider: "fixture", account: "default", projectKey: "ITEM", title: "Fixture item", body: "Fixture body" } as const;
const worker = `import fs from 'node:fs';let input='';for await(const chunk of process.stdin)input+=chunk;
const r=JSON.parse(input),mode=MODE;fs.appendFileSync('calls.jsonl',JSON.stringify(r)+'\\n');let result;
if(r.path==='accounts' && mode==='timeout') {setInterval(()=>{},1000);} else {
if(mode==='error')throw new Error(process.env.FIXTURE_CREDENTIAL);
if(r.path==='accounts') result=[{provider:r.body.provider,id:'default',label:'Fixture account'}];
else if(r.path==='get')result={ref:r.body.ref,title:mode==='redact'?process.env.FIXTURE_CREDENTIAL:'Fixture item',revision:'1',url:'https://example.invalid/item',...(mode==='redact'?{metadata:{[process.env.FIXTURE_CREDENTIAL]:process.env.FIXTURE_CREDENTIAL}}:{})};
else if(r.path==='setupStatus')result={configured:true,fields:{ready:true}};
else if(r.path==='alerts')result={oncall:[{id:'alert',title:mode==='settings'?process.env.AWS_PROFILE+' '+process.env.FIXTURE_CREDENTIAL:'Fixture alert',timestampMs:100,url:mode==='settings'?'https://app.'+process.env.DD_SITE+'/event':'https://example.invalid/alert'}],related:[]};
else if(r.path==='transitions')result=[{id:'2',label:'Done'}];
else if(r.path==='prepareWrite')result={destination:'https://example.invalid/project',actor:'Fixture actor',summary:'Create fixture',details:{title:r.body.input.title},native:{revision:'1'}};
else if(r.path==='executeWrite'){
 if(mode==='conflict')result={error:{kind:'conflict'}};
 else {fs.appendFileSync('writes.jsonl',r.body.requestId+'\\n');if(mode==='ambiguous')throw new Error(process.env.FIXTURE_CREDENTIAL);result={detail:'Created fixture',item:{ref:{provider:r.body.provider,account:r.body.input.account,kind:'issue',id:'ITEM-2'},title:'Fixture item'}};}
}
if(mode==='bad-ref' && r.path==='get')result.ref={...r.body.ref,account:'other'};
if(mode==='bad-receipt' && r.path==='executeWrite')result={bad:true};
if(mode==='wrong-receipt-kind' && r.path==='executeWrite')result.item.ref.kind='pr';
if(mode==='secret-preparation' && r.path==='prepareWrite')result.native.token=process.env.FIXTURE_CREDENTIAL;
process.stdout.write(JSON.stringify(result));}
`;
function consent(view: PluginOperationView) {
  if (!view.preview) throw new Error("Missing fixture review");
  return { accepted: true, revision: view.preview.revision, planDigest: view.preview.planDigest, selectedTargets: [] };
}
async function fixture(mode = "normal", capabilities = ["issue.read", "issue.create", "alerts.read", "issue.transitions"], id = "fixture") {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-integration-")));
  roots.push(root);
  for (const [key, value] of Object.entries({ HOME: root, DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_PLUGIN_HOME: path.join(root, "managed"), DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets"), DEVHUB_APP_DATA: path.join(root, "app-data"), FIXTURE_CREDENTIAL: "fixture-private-value", AWS_PROFILE: "dev", DD_SITE: "datadoghq.eu" })) vi.stubEnv(key, value);
  const ctx = pluginContext();
  const source = path.join(root, "source");
  fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
  const parsed = readManifest(source);
  if (!parsed.ok || !parsed.manifest.runtime) throw new Error("Invalid fixture manifest");
  const manifest = parsed.manifest;
  // Read the edited manifest through the public parser before installation.
  const manifestFile = path.join(source, "devhub-plugin.json");
  const raw = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  raw.runtime.capabilities = { integrations: [{ id, label: "Fixture integration", capabilities }] };
  raw.runtime.permissions.env = ["FIXTURE_CREDENTIAL"];
  if (mode === "settings") raw.runtime.permissions.publicEnv = ["AWS_PROFILE", "DD_SITE"];
  fs.writeFileSync(path.join(source, "worker.mjs"), worker.replace("MODE", JSON.stringify(mode)));
  raw.runtime.sha256 = hashFile(path.join(source, "worker.mjs"));
  fs.writeFileSync(manifestFile, JSON.stringify(raw));
  const review = await prepareLocal(ctx, source);
  expect(review.preview?.inventory.find((group) => group.kind === "Integration providers")?.entries[0]).toContain(id);
  if (mode === "settings") expect(review.preview?.inventory.find(group => group.kind.startsWith("Public environment"))?.entries).toEqual(["AWS_PROFILE", "DD_SITE"]);
  expect((await confirmOperation(ctx, review.id, consent(review))).state).toBe("succeeded");
  const data = path.join(ctx.paths.pluginHome, "runtime-data", loadRuntime(ctx, manifest.name).id);
  const writes = () => fs.existsSync(path.join(data, "writes.jsonl")) ? fs.readFileSync(path.join(data, "writes.jsonl"), "utf8").trim().split("\n") : [];
  return { ctx, source, root, data, writes };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("serves real async accounts, reads, setup, alerts and transitions with secrets redacted", async () => {
  await fixture("redact");
  const provider = providerFor("fixture");
  expect((await provider.accounts())[0].provider).toBe("fixture");
  const item = await provider.get(ref, { signal: signal() });
  expect(item.title).toBe("[redacted]");
  expect(item.metadata).toEqual({ "[redacted]": "[redacted]" });
  expect(await provider.setupStatus!()).toEqual({ configured: true, fields: { ready: true } });
  expect((await provider.alerts!.recent(10)).oncall[0].title).toBe("Fixture alert");
  expect(await provider.transitions!(ref, { signal: signal() })).toEqual([{ id: "2", label: "Done" }]);
});
it("keeps duplicate provider IDs as conflicts, including core IDs", async () => {
  await fixture("normal", ["issue.read"], "jira");
  expect(providers).toThrow(/Duplicate integration provider/);
});
it("preserves reviewed public settings in real worker responses while redacting credentials", async () => {
  vi.spyOn(dashboardEnv, "readDashboardEnvLocalFile").mockReturnValue({ overrides: new Map([["AWS_PROFILE", "dev"], ["DD_SITE", "datadoghq.eu"], ["FIXTURE_CREDENTIAL", "fixture-saved-private-value"]]), passthrough: [] });
  await fixture("settings", ["alerts.read"]);
  vi.stubEnv("AWS_PROFILE", "boot-profile");
  vi.stubEnv("DD_SITE", "datadoghq.com");
  expect((await providerFor("fixture").alerts!.recent(5)).oncall[0]).toEqual({
    id: "alert", title: "dev [redacted]", timestampMs: 100, url: "https://app.datadoghq.eu/event",
  });
});
it("refuses writes without their declared capability before starting an action worker", async () => {
  const f = await fixture("normal", ["issue.read"]);
  await expect(writeNow(write, "default", signal(), { root: path.join(f.root, "writes") })).rejects.toMatchObject({ kind: "unsupported" });
  await expect(invokeRuntime(f.ctx, "sample-tools", { kind: "integration", path: "executeWrite", method: "POST", body: { provider: "fixture", input: write } })).rejects.toThrow(/did not declare/);
  expect(f.writes()).toEqual([]);
});
it("disables a runtime provider immediately", async () => {
  const f = await fixture();
  const provider = providerFor("fixture");
  const disable = await startLifecycle(f.ctx, "sample-tools", "disable");
  await confirmOperation(f.ctx, disable.id, consent(disable));
  expect(() => providerFor("fixture")).toThrow(/absent or disabled/);
  await expect(provider.get(ref, { signal: signal() })).rejects.toMatchObject({ kind: "unsupported" });
});
it.each(["timeout", "error"])("bounds and sanitises %s failures", async (mode) => {
  await fixture(mode);
  const started = Date.now();
  await expect(providerFor("fixture").accounts()).rejects.toMatchObject({ kind: "unavailable" });
  expect(Date.now() - started).toBeLessThan(8000);
});
it("rejects another account's response and credentials in prepared requests", async () => {
  await fixture("bad-ref");
  await expect(providerFor("fixture").get(ref, { signal: signal() })).rejects.toMatchObject({ kind: "invalid" });
  await fixture("secret-preparation");
  await expect(providerFor("fixture").prepareWrite!(WriteInputSchema.parse(write), { signal: signal() })).rejects.toMatchObject({ kind: "invalid" });
});
it("rejects changed preparations and consumes a successful preparation only once", async () => {
  const f = await fixture();
  const provider = providerFor("fixture"), input = WriteInputSchema.parse(write);
  const prepared = await provider.prepareWrite!(input, { signal: signal() });
  prepared.summary = "Changed";
  await expect(provider.executeWrite!(input, prepared, { signal: signal(), requestId: "changed" })).rejects.toMatchObject({ kind: "conflict" });
  prepared.summary = "Create fixture";
  await provider.executeWrite!(input, prepared, { signal: signal(), requestId: "once" });
  await expect(provider.executeWrite!(input, prepared, { signal: signal(), requestId: "twice" })).rejects.toMatchObject({ kind: "conflict" });
  expect(f.writes()).toEqual(["once"]);
});
it("refuses a preparation after reviewed worker replacement", async () => {
  const f = await fixture();
  const provider = providerFor("fixture"), input = WriteInputSchema.parse(write);
  const prepared = await provider.prepareWrite!(input, { signal: signal() });
  const file = path.join(f.source, "devhub-plugin.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.appendFileSync(path.join(f.source, "worker.mjs"), "\n// next reviewed snapshot\n");
  manifest.runtime.sha256 = hashFile(path.join(f.source, "worker.mjs"));
  fs.writeFileSync(file, JSON.stringify(manifest));
  const replacement = await prepareLocal(f.ctx, f.source, { reviewRuntimeReplacement: true });
  expect((await confirmOperation(f.ctx, replacement.id, consent(replacement))).state).toBe("succeeded");
  await expect(provider.executeWrite!(input, prepared, { signal: signal(), requestId: "stale" })).rejects.toMatchObject({ kind: "conflict" });
  expect(f.writes()).toEqual([]);
});
it.each([["normal", "succeeded", 1], ["conflict", "failed", 0], ["ambiguous", "unknown", 1], ["bad-receipt", "unknown", 1], ["wrong-receipt-kind", "unknown", 1]] as const)("persists %s outcomes without replaying writes", async (mode, expected, count) => {
  const f = await fixture(mode);
  const root = path.join(f.root, "writes");
  const { result } = await writeNow(write, "default", signal(), { root });
  expect(result.state).toBe(expected);
  expect(f.writes()).toHaveLength(count);
  const stored = fs.readFileSync(path.join(root, result.id + ".json"), "utf8");
  expect(JSON.parse(stored).state).toBe(expected);
  expect(stored).not.toContain("fixture-private-value");
});
it("retains native provider action, reference, traversal and account checks", () => {
  expect(WriteInputSchema.safeParse({ ...write, provider: "github" }).success).toBe(false);
  expect(WriteInputSchema.safeParse({ action: "issue.transition", provider: "jira", account: "default", ref: { ...ref, provider: "jira", id: "../bad" }, transitionId: "1" }).success).toBe(false);
  expect(WriteInputSchema.safeParse({ action: "pr.publish", provider: "github", account: "default", ref: { provider: "github", account: "other", kind: "pr", id: "owner/repo/1" } }).success).toBe(false);
});
