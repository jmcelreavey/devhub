/**
 * Operation records, receipts and idempotency keys, all under the managed
 * plugin home and all written atomically. Nothing here talks to Git or the
 * registry.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeAtomicNow } from "@/lib/atomic-write";
import { PluginApiError, toolEnv, type PluginContext } from "./context";
import { destinationFingerprint, type InstallReceipt } from "./install";
import type { PluginOperationKind, PluginOperationState, PluginOperationView, PluginStep } from "./model";
import { commandOnPath, ensureSecureDir, secureFile, tildePath } from "./runtime";
import { assertSafePath, safePath } from "./filesystem";

export const PREVIEW_TTL_MS = 15 * 60 * 1000;
/** Staging for a cancelled, expired or abandoned review is kept this long, then removed. */
const STAGING_RETENTION_MS = 24 * 60 * 60 * 1000;
const RECORD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_KEPT = 100;
export const ID_RE = /^[a-z0-9]{16,64}$/;

export interface AssetHash {
  kind: "skill" | "agent";
  name: string;
  hash: string;
}

/** Everything about an operation that the person is never shown. */
export interface Internal {
  pid: number;
  url: string | null;
  owner: string | null;
  repo: string | null;
  sha: string | null;
  branch: string | null;
  visibility: "public" | "private" | null;
  workTree: string | null;
  stagingDir: string | null;
  authMethod: "configured-helper" | "gh" | null;
  gitAvailable: boolean;
  ghAvailable: boolean;
  exitCode: number | null;
  timedOut: boolean;
  registryRevision: string;
  idempotencyKey: string | null;
  pluginRecordId: string | null;
  cancelRequested: boolean;
  manifestHash: string | null;
  sourceHash: string | null;
  assetHashes: AssetHash[];
  fingerprints: Record<string, string>;
  confirmKey: string | null;
  confirmBody: string | null;
  deleteStagingOnDone: boolean;
}

export interface StoredOperation {
  view: PluginOperationView;
  internal: Internal;
}

export function step(id: string, label: string): PluginStep {
  return { id, label, state: "pending" };
}

export function prepareSteps(): PluginStep[] {
  return [
    step("url", "Check repository URL"),
    step("access", "Check repository access"),
    step("download", "Download repository"),
    step("validate", "Validate plugin"),
    step("preview", "Prepare preview"),
  ];
}

export function applySteps(): PluginStep[] {
  return [
    step("verify", "Verify reviewed files"),
    step("save", "Save managed download"),
    step("sync", "Sync skills and agents"),
    step("registry", "Save plugin settings"),
  ];
}

export function disableSteps(): PluginStep[] {
  return [step("sync", "Disable future sync"), step("copies", "Remove unchanged installed copies")];
}

export function removeSteps(): PluginStep[] {
  return [...disableSteps(), step("registry", "Remove registration")];
}

export function blank(ctx: PluginContext, kind: PluginOperationKind, steps: PluginStep[]): StoredOperation {
  ensureSecureDir(ctx.paths.pluginHome);
  const id = crypto.randomBytes(12).toString("hex");
  const env = toolEnv(ctx);
  return {
    view: {
      id,
      kind,
      state: "validating_url",
      phase: steps[0]?.label ?? "",
      steps,
      cancellable: true,
      message: null,
      startedAt: new Date().toISOString(),
      subject: null,
      sourceUrl: null,
      pluginId: null,
      preview: null,
      result: null,
      error: null,
      access: null,
      issues: [],
      progress: [],
    },
    internal: {
      pid: process.pid,
      url: null,
      owner: null,
      repo: null,
      sha: null,
      branch: null,
      visibility: null,
      workTree: null,
      stagingDir: null,
      authMethod: null,
      gitAvailable: commandOnPath("git", env),
      ghAvailable: commandOnPath("gh", env),
      exitCode: null,
      timedOut: false,
      registryRevision: "missing",
      idempotencyKey: null,
      pluginRecordId: null,
      cancelRequested: false,
      manifestHash: null,
      sourceHash: null,
      assetHashes: [],
      fingerprints: {},
      confirmKey: null,
      confirmBody: null,
      deleteStagingOnDone: false,
    },
  };
}

export function mark(stored: StoredOperation, id: string, state: PluginStep["state"]): void {
  const found = stored.view.steps.find((item) => item.id === id);
  if (!found) return;
  found.state = state;
  if (state === "running") stored.view.phase = found.label;
}

export function terminal(state: PluginOperationState): boolean {
  return ["ready", "needs_access", "git_missing", "invalid", "succeeded", "failed", "cancelled", "expired", "needs_attention"].includes(state);
}

export function save(ctx: PluginContext, stored: StoredOperation): void {
  const dir = path.join(ctx.paths.pluginHome, "operations");
  assertSafePath(ctx.paths.pluginHome, dir);
  ensureSecureDir(dir);
  // A separate marker cannot be overwritten by a preparing worker's stale
  // progress snapshot when cancellation arrives from another process.
  if (fs.existsSync(path.join(dir, `${stored.view.id}.cancel`))) {
    stored.internal.cancelRequested = true;
    if (["ready", "invalid"].includes(stored.view.state)) {
      stored.view.state = "cancelled";
      stored.view.message = "Cancelled. No plugin was enabled.";
      stored.view.cancellable = false;
    }
  }
  const file = path.join(dir, `${stored.view.id}.json`);
  writeAtomicNow(file, JSON.stringify(stored));
  secureFile(file);
}

export function readStored(ctx: PluginContext, id: string): StoredOperation {
  const gone = () => new PluginApiError(404, "NOT_FOUND", "That review is no longer available.");
  if (!ID_RE.test(id)) throw gone();
  const file = path.join(ctx.paths.pluginHome, "operations", `${id}.json`);
  assertSafePath(ctx.paths.pluginHome, file);
  let parsed: StoredOperation;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoredOperation;
  } catch {
    throw gone();
  }
  if (!parsed?.view?.id || parsed.view.id !== id) throw gone();
  if (fs.existsSync(path.join(ctx.paths.pluginHome, "operations", `${id}.cancel`))) parsed.internal.cancelRequested = true;
  return parsed;
}

export function requestCancellation(ctx: PluginContext, id: string): void {
  if (!ID_RE.test(id)) throw new Error("Invalid operation identifier");
  const file = path.join(ctx.paths.pluginHome, "operations", `${id}.cancel`);
  assertSafePath(ctx.paths.pluginHome, file);
  writeAtomicNow(file, "cancel\n");
  secureFile(file);
}

function pidAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * A record the owning process can no longer finish is settled honestly:
 * an unfinished review expires, an unfinished apply needs attention. Nothing
 * resumes by itself.
 */
export function reconcile(ctx: PluginContext, stored: StoredOperation): StoredOperation {
  if (!pidAlive(stored.internal.pid) && !terminal(stored.view.state)) {
    const applying = stored.view.state === "applying";
    stored.view.state = applying ? "needs_attention" : "expired";
    stored.view.message = applying ? "Plugin changes need attention" : "Review expired";
    stored.view.cancellable = false;
    if (applying) {
      const receipt = readReceipt(ctx, stored.internal.pluginRecordId ?? stored.view.id);
      const files = receipt?.files.filter((file) => !safePath(ctx.paths.targetHome, file.destination) || destinationFingerprint(file.destination, file.kind) !== "absent") ?? [];
      const unchanged = files.filter((file) => safePath(ctx.paths.targetHome, file.destination) && destinationFingerprint(file.destination, file.kind) === `${file.kind === "skill" ? "dir" : "file"}:${file.hash}`).length;
      stored.view.error = {
        code: "INTERRUPTED", message: "Plugin changes were interrupted. Review the recorded copies before continuing.", retryable: false,
        consequences: [`${unchanged} recorded copies are unchanged; ${files.length - unchanged} need manual review.`, "No changes were resumed automatically. Retry cleanup removes unchanged copies only; an enabled plugin must be disabled from its details first."],
        paths: files.map((file) => tildePath(file.destination, ctx.home)),
      };
    }
    // Polling is read-only: it must not overwrite another process that has
    // just acquired the mutation lock to confirm or recover this operation.
    return stored;
  }
  if (stored.view.state === "ready" && stored.view.preview && Date.parse(stored.view.preview.expiresAt) < Date.now()) {
    stored.view.state = "expired";
    stored.view.message = "Review expired";
  }
  return stored;
}

export function writeReceipt(ctx: PluginContext, receipt: InstallReceipt): void {
  const dir = path.join(ctx.paths.pluginHome, "receipts");
  if (!ID_RE.test(receipt.pluginId)) throw new Error("Invalid plugin record identifier");
  assertSafePath(ctx.paths.pluginHome, dir);
  ensureSecureDir(dir);
  const file = path.join(dir, `${receipt.pluginId}.json`);
  writeAtomicNow(file, JSON.stringify(receipt, null, 2) + "\n");
  secureFile(file);
}

export function readReceipt(ctx: PluginContext, id: string): InstallReceipt | null {
  if (!ID_RE.test(id)) return null;
  try {
    const file = path.join(ctx.paths.pluginHome, "receipts", `${id}.json`);
    assertSafePath(ctx.paths.pluginHome, file);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as InstallReceipt;
    if (parsed.pluginId !== id || !Array.isArray(parsed.files) || parsed.files.some((item) => !item || !["skill", "agent"].includes(item.kind) || typeof item.destination !== "string" || typeof item.hash !== "string")) return null;
    if (parsed.retainedPaths && (!Array.isArray(parsed.retainedPaths) || parsed.retainedPaths.some((item) => typeof item !== "string"))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function removeReceipt(ctx: PluginContext, id: string): void {
  if (!ID_RE.test(id)) return;
  assertSafePath(ctx.paths.pluginHome, path.join(ctx.paths.pluginHome, "receipts", `${id}.json`));
  fs.rmSync(path.join(ctx.paths.pluginHome, "receipts", `${id}.json`), { force: true });
}

interface IdempotencyEntry {
  key: string;
  bodyHash: string;
  operationId: string;
}

function readIdempotency(ctx: PluginContext): IdempotencyEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(ctx.paths.pluginHome, "idempotency.json"), "utf8")) as { entries?: IdempotencyEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

export function findIdempotent(ctx: PluginContext, key: string | null | undefined, bodyHash: string): string | null {
  if (!key) return null;
  if (!/^[\w.-]{8,200}$/.test(key)) throw new PluginApiError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8–200 characters.");
  const found = readIdempotency(ctx).find((entry) => entry.key === key);
  if (!found) return null;
  if (found.bodyHash !== bodyHash) {
    throw new PluginApiError(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different request.", false, found.operationId);
  }
  return found.operationId;
}

export function rememberIdempotent(ctx: PluginContext, key: string | null | undefined, bodyHash: string, operationId: string): void {
  if (!key) return;
  const entries = [...readIdempotency(ctx).filter((entry) => entry.key !== key), { key, bodyHash, operationId }].slice(-IDEMPOTENCY_KEPT);
  ensureSecureDir(ctx.paths.pluginHome);
  const file = path.join(ctx.paths.pluginHome, "idempotency.json");
  writeAtomicNow(file, JSON.stringify({ entries }));
  secureFile(file);
}

/**
 * Removes staging left behind by a review nobody finished, and operation
 * records old enough to be of no use. Anything still being worked on in this
 * process (`busy`) is left alone.
 */
export function sweepOldWork(ctx: PluginContext, busy: (id: string) => boolean): void {
  const now = Date.now();
  const clean = (dir: string, maxAge: number, removeRecursive: boolean) => {
    let names: string[];
    try {
      assertSafePath(ctx.paths.pluginHome, dir);
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const id = name.replace(/\.json$/, "");
      if (!ID_RE.test(id) || busy(id)) continue;
      const target = path.join(dir, name);
      try {
        const record = readStored(ctx, id);
        if (!terminal(record.view.state) && pidAlive(record.internal.pid)) continue;
        // An interrupted apply's journal remains available for explicit recovery.
        if (record.view.state === "applying" || record.view.state === "needs_attention") continue;
        assertSafePath(ctx.paths.pluginHome, target);
        if (now - fs.lstatSync(target).mtimeMs > maxAge) {
          fs.rmSync(target, { recursive: removeRecursive, force: true });
          if (!removeRecursive) fs.rmSync(path.join(dir, `${id}.cancel`), { force: true });
        }
      } catch {
        // Gone already, or not ours to remove.
      }
    }
  };
  clean(path.join(ctx.paths.pluginHome, "staging"), STAGING_RETENTION_MS, true);
  clean(path.join(ctx.paths.pluginHome, "operations"), RECORD_RETENTION_MS, false);
}
