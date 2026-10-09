/**
 * Plugin review and apply. HTTP and the CLI share this module.
 * A local directory prepare exists for tests; no HTTP route accepts a filesystem path.
 *
 * Nothing the plugin ships runs here. Review reads files; apply copies the
 * exact reviewed bytes and writes the registry last, so a failure at any step
 * leaves the registry as it was.
 */
import fs from "node:fs";
import path from "node:path";
import { PluginApiError, toolEnv, type PluginContext } from "./context";
import { NOT_COPIED, addedSummary, keptSummary, syncSummary, CANCELLING } from "./copy";
import { applyReviewedAssets, cleanupReceipt, visibleSyncTargets, type InstallReceipt } from "./install";
import type {
  PluginDiagnostic,
  PluginOperationError,
  PluginOperationView,
  PluginPreview,
} from "./model";
import { ensureSecureDir, serviceRuntime, tildePath, commandOnPath } from "./runtime";
import { withPluginMutationLock } from "./lock";
import { expandHome } from "./registry";
import {
  patchPluginEntry,
  registerManagedPlugin,
  registryRevision,
  removePluginEntry,
  type ManagedSource,
} from "./registry-write";
import {
  checkRepositoryAccess,
  downloadRepository,
  parseGitHubRepoUrl,
  readGhStatus,
  readVisibility,
  type ParsedGitHubRepo,
} from "./source";
import {
  applySteps,
  blank,
  disableSteps,
  findIdempotent,
  mark,
  prepareSteps,
  readReceipt,
  readStored,
  reconcile,
  rememberIdempotent,
  removeReceipt,
  removeSteps,
  save,
  sweepOldWork,
  terminal,
  writeReceipt,
  type StoredOperation,
} from "./store";
import {
  accessView,
  assetHashes,
  fingerprintMap,
  fingerprintsMatch,
  hashesMatch,
  inspectTree,
  lifecyclePreview,
  nameCollision,
  sha256,
  toPreview,
  type SourceFacts,
} from "./preview";
import { findEntry } from "./views";

export { PluginApiError, pluginContext, type PluginContext } from "./context";
export { getRegistration, listRegistrations, type PluginListResult } from "./views";

const STALE_MESSAGE = "The plugin or its targets changed. Review the changes again.";

/** Reviews running in this process, and the handle that stops their current command. */
const prepares = new Map<string, number[]>();
const inflight = new Map<string, Promise<void>>();
const controllers = new Map<string, AbortController>();

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export function operationSettled(id: string): Promise<void> {
  return inflight.get(id) ?? Promise.resolve();
}

function fail(code: string, message: string, retryable: boolean, consequences: string[] = [], paths: string[] = []): PluginOperationError {
  return { code, message, retryable, consequences, paths };
}

export function startPrepare(ctx: PluginContext, url: string, idempotencyKey?: string | null): PluginOperationView {
  const parsed = parseGitHubRepoUrl(url);
  if (!parsed.ok) throw new PluginApiError(400, "INVALID_URL", parsed.message);
  const bodyHash = sha256(parsed.repo.url);
  const existing = findIdempotent(ctx, idempotencyKey, bodyHash);
  if (existing) return getOperation(ctx, existing);
  rateLimit(ctx.paths.pluginHome);
  try {
    sweepOldWork(ctx, (id) => inflight.has(id));
  } catch {
    // Housekeeping must never stop a review.
  }
  const stored = blank(ctx, "install", prepareSteps());
  const id = stored.view.id;
  stored.internal.url = parsed.repo.url;
  stored.internal.owner = parsed.repo.owner;
  stored.internal.repo = parsed.repo.repo;
  stored.internal.idempotencyKey = idempotencyKey ?? null;
  stored.view.subject = `${parsed.repo.owner}/${parsed.repo.repo}`;
  stored.view.sourceUrl = parsed.repo.url;
  save(ctx, stored);
  rememberIdempotent(ctx, idempotencyKey, bodyHash, id);
  const controller = new AbortController();
  controllers.set(id, controller);
  const job = runUrlPrepare(ctx, id, parsed.repo, controller.signal)
    .catch(() => failUnexpected(ctx, id))
    .finally(() => {
      controllers.delete(id);
      inflight.delete(id);
    });
  inflight.set(id, job);
  return stored.view;
}

/** Test and scripting entry: reviews a local folder as if it had been downloaded. No route calls this. */
export async function prepareLocal(ctx: PluginContext, dir: string): Promise<PluginOperationView> {
  const root = fs.realpathSync(dir);
  const stored = blank(ctx, "install", prepareSteps());
  stored.internal.deleteStagingOnDone = true;
  save(ctx, stored);
  await runLocalPrepare(ctx, stored.view.id, root);
  return getOperation(ctx, stored.view.id);
}

export function getOperation(ctx: PluginContext, id: string): PluginOperationView {
  return reconcile(ctx, readStored(ctx, id)).view;
}

export function getPreview(ctx: PluginContext, id: string): PluginPreview {
  const stored = reconcile(ctx, readStored(ctx, id));
  if (!stored.view.preview) throw new PluginApiError(404, "NOT_FOUND", "This review is no longer available.", false, id);
  if (stored.view.state === "expired" || Date.parse(stored.view.preview.expiresAt) < Date.now()) {
    throw new PluginApiError(410, "PREVIEW_EXPIRED", "Review expired", false, id);
  }
  return stored.view.preview;
}

export async function cancelOperation(ctx: PluginContext, id: string): Promise<PluginOperationView> {
  const stored = readStored(ctx, id);
  if (stored.view.state === "applying" || stored.view.state === "succeeded") {
    throw new PluginApiError(409, "NOT_CANCELLABLE", "You can close this window. Progress stays in Plugins.", false, id);
  }
  if (terminal(stored.view.state) && stored.view.state !== "ready") return stored.view;
  stored.internal.cancelRequested = true;
  if (stored.view.state === "ready" || !inflight.has(id)) return finishCancel(ctx, stored);
  // A command is running. Stop it and let the review finish the cancellation;
  // the page polls, so there is nothing to wait for here.
  stored.view.phase = CANCELLING;
  stored.view.cancellable = false;
  save(ctx, stored);
  controllers.get(id)?.abort();
  return stored.view;
}

export async function recheckOperation(ctx: PluginContext, id: string): Promise<PluginOperationView> {
  return withPluginMutationLock(ctx.paths.pluginHome, async () => {
    const stored = readStored(ctx, id);
    if (stored.view.state !== "ready" || !stored.view.preview || !stored.internal.workTree) {
      throw new PluginApiError(409, "NOT_READY", "Review the plugin again before enabling it.", false, id);
    }
    stored.view.preview = rebuildPreview(ctx, stored);
    stored.view.issues = [];
    save(ctx, stored);
    return stored.view;
  });
}

export interface ConfirmBody {
  revision: number;
  planDigest: string;
  selectedTargets: string[];
  accepted: boolean;
}

export async function confirmOperation(
  ctx: PluginContext,
  id: string,
  body: ConfirmBody,
  idempotencyKey?: string | null,
): Promise<PluginOperationView> {
  if (body.accepted !== true) throw new PluginApiError(400, "NOT_ACCEPTED", "Review the plugin before enabling it.", false, id);
  if (!Array.isArray(body.selectedTargets) || body.selectedTargets.some((item) => typeof item !== "string")) {
    throw new PluginApiError(400, "INVALID_TARGETS", "Choose the tools to sync from the review.", false, id);
  }
  return withPluginMutationLock(ctx.paths.pluginHome, async () => {
    const stored = reconcile(ctx, readStored(ctx, id));
    const bodyHash = sha256(JSON.stringify({ revision: body.revision, planDigest: body.planDigest, selectedTargets: [...body.selectedTargets].sort(), accepted: true }));
    if (stored.internal.confirmKey && idempotencyKey && stored.internal.confirmKey === idempotencyKey) {
      if (stored.internal.confirmBody !== bodyHash) {
        throw new PluginApiError(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different request.", false, id);
      }
      return stored.view;
    }
    if (stored.view.state === "succeeded") return stored.view;
    if (stored.view.state === "applying") throw new PluginApiError(409, "BUSY", "Plugin settings are busy. Try again.", true, id);
    if (stored.view.state === "expired") throw new PluginApiError(410, "PREVIEW_EXPIRED", "Review expired", false, id);
    if (stored.view.state !== "ready" || !stored.view.preview) {
      throw new PluginApiError(409, "NOT_READY", "Review the plugin again before enabling it.", false, id);
    }
    const preview = stored.view.preview;
    if (Date.parse(preview.expiresAt) < Date.now()) {
      stored.view.state = "expired";
      stored.view.message = "Review expired";
      save(ctx, stored);
      throw new PluginApiError(410, "PREVIEW_EXPIRED", "Review expired", false, id);
    }
    if (preview.revision !== body.revision || preview.planDigest !== body.planDigest) {
      throw new PluginApiError(409, "PREVIEW_STALE", STALE_MESSAGE, false, id);
    }
    if (!preview.canApply) {
      throw new PluginApiError(422, "CANNOT_APPLY", preview.heading || preview.blockers[0]?.message || "This plugin can’t be enabled.", false, id);
    }
    if (registryRevision(ctx.home, ctx.env) !== stored.internal.registryRevision) {
      throw new PluginApiError(409, "PREVIEW_STALE", STALE_MESSAGE, false, id);
    }
    const installing = stored.view.kind === "install" || stored.view.kind === "enable";
    if (installing) {
      const known = new Set(visibleSyncTargets(ctx.paths.targetHome).map((target) => target.id));
      if (body.selectedTargets.some((target) => !known.has(target))) {
        throw new PluginApiError(400, "INVALID_TARGETS", "Choose the tools to sync from the review.", false, id);
      }
      for (const target of body.selectedTargets) {
        if (preview.targets.find((item) => item.id === target)?.conflict) {
          throw new PluginApiError(409, "TARGET_CONFLICT", "Conflicts with a local copy", false, id);
        }
      }
      if (!fingerprintsMatch(ctx, stored, body.selectedTargets)) {
        throw new PluginApiError(409, "PREVIEW_STALE", STALE_MESSAGE, false, id);
      }
    }
    stored.internal.confirmKey = idempotencyKey ?? null;
    stored.internal.confirmBody = bodyHash;
    stored.view.state = "applying";
    stored.view.cancellable = false;
    if (installing) stored.view.steps = applySteps();
    save(ctx, stored);
    if (stored.view.kind === "disable") return applyDisable(ctx, stored);
    if (stored.view.kind === "remove") return applyRemove(ctx, stored);
    return applyInstall(ctx, stored, body.selectedTargets);
  });
}

export function diagnosticsFor(ctx: PluginContext, id: string): PluginDiagnostic {
  const stored = id === "registry" ? null : readStored(ctx, id);
  const runtime = serviceRuntime(ctx.env);
  const env = toolEnv(ctx);
  return {
    operationId: id,
    operation: stored?.view.kind ?? "read",
    phase: stored?.view.state ?? "registry",
    errorCode: stored?.view.error?.code ?? null,
    appVersion: ctx.env.DEVHUB_VERSION?.trim() || "unknown",
    runtime: runtime.kind,
    distro: runtime.distro,
    source: stored?.internal.url ?? null,
    ref: stored?.internal.url ? "default" : null,
    sha: stored?.internal.sha ?? null,
    gitAvailable: stored?.internal.gitAvailable ?? commandOnPath("git", env),
    ghAvailable: stored?.internal.ghAvailable ?? commandOnPath("gh", env),
    authMethod: stored?.internal.authMethod ?? null,
    exitCode: stored?.internal.exitCode ?? null,
    timedOut: stored?.internal.timedOut ?? false,
  };
}

export async function startLifecycle(
  ctx: PluginContext,
  idOrName: string,
  kind: "disable" | "remove" | "enable",
): Promise<PluginOperationView> {
  const entry = findEntry(ctx, idOrName);
  if (!entry) throw new PluginApiError(404, "NOT_FOUND", "That plugin is not registered.");
  if (!entry.managed) {
    throw new PluginApiError(422, "NOT_MANAGED", "This plugin is registered from a folder you manage. DevHub won’t move, update or delete that folder.");
  }
  if (kind === "disable" && !entry.enabled) throw new PluginApiError(409, "ALREADY_DISABLED", "This plugin is already disabled.");
  if (kind === "enable" && entry.enabled) throw new PluginApiError(409, "ALREADY_ENABLED", "This plugin is already enabled.");
  const stored = blank(ctx, kind, kind === "remove" ? removeSteps() : kind === "disable" ? disableSteps() : applySteps());
  stored.internal.pluginRecordId = entry.id;
  stored.view.subject = entry.name;
  stored.view.sourceUrl = entry.url;
  stored.view.pluginId = entry.id;
  stored.internal.workTree = expandHome(entry.path, ctx.home);
  stored.internal.sha = entry.sha;
  stored.internal.url = entry.url;
  stored.internal.branch = entry.ref;
  if (kind === "enable") {
    save(ctx, stored);
    inspectRetained(ctx, stored, entry.name);
    return getOperation(ctx, stored.view.id);
  }
  const preview = lifecyclePreview(ctx, stored, { ...entry, path: entry.path }, readVersion(stored.internal.workTree));
  stored.view.preview = preview;
  stored.internal.registryRevision = preview.registryRevision;
  stored.view.state = "ready";
  stored.view.cancellable = true;
  save(ctx, stored);
  return stored.view;
}

export async function waitForOperation(ctx: PluginContext, id: string, timeoutMs = 15000): Promise<PluginOperationView> {
  const started = Date.now();
  for (;;) {
    const view = getOperation(ctx, id);
    if (terminal(view.state)) return view;
    if (Date.now() - started > timeoutMs) return view;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function readVersion(dir: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "devhub-plugin.json"), "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** Fresh read after an await: another request (cancel) may have changed the record meanwhile. */
function fresh(ctx: PluginContext, id: string): StoredOperation {
  return readStored(ctx, id);
}

function sourceFacts(ctx: PluginContext, id: string, stored: StoredOperation): SourceFacts {
  return {
    url: stored.internal.url,
    owner: stored.internal.owner,
    repo: stored.internal.repo,
    branch: stored.internal.branch,
    sha: stored.internal.sha,
    visibility: stored.internal.visibility,
    managed: true,
    destination: tildePath(path.join(ctx.paths.pluginHome, "repos", stored.internal.pluginRecordId ?? id), ctx.home),
  };
}

async function runUrlPrepare(ctx: PluginContext, id: string, repo: ParsedGitHubRepo, signal: AbortSignal): Promise<void> {
  const env = toolEnv(ctx);
  let stored = fresh(ctx, id);
  mark(stored, "url", "complete");
  mark(stored, "access", "running");
  stored.view.state = "checking_access";
  save(ctx, stored);
  const stagingDir = path.join(ctx.paths.pluginHome, "staging", id);
  ensureSecureDir(ctx.paths.pluginHome);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  ensureSecureDir(stagingDir);
  const hooks = path.join(stagingDir, "hooks");
  ensureSecureDir(hooks);

  const access = await checkRepositoryAccess(ctx.runner, repo, hooks, env, signal);
  stored = fresh(ctx, id);
  stored.internal.stagingDir = stagingDir;
  stored.internal.gitAvailable = access.gitAvailable;
  stored.internal.exitCode = access.exitCode;
  stored.internal.timedOut = access.timedOut;
  stored.internal.authMethod = access.authMethod;
  if (stored.internal.cancelRequested || access.aborted) {
    finishCancel(ctx, stored);
    return;
  }
  if (access.rewritten) {
    stored.view.state = "failed";
    stored.view.message = "Your Git settings redirect github.com";
    stored.view.error = fail(
      "URL_REWRITTEN",
      "A Git setting on this computer sends github.com addresses somewhere else. DevHub only downloads plugins straight from github.com.",
      false,
      ["Nothing has been enabled."],
    );
    mark(stored, "access", "failed");
    stored.view.cancellable = false;
    save(ctx, stored);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    return;
  }
  if (!access.ok) {
    const gh = await readGhStatus(ctx.runner, env);
    stored = fresh(ctx, id);
    stored.internal.ghAvailable = gh.available;
    stored.view.state = access.timedOut ? "failed" : "needs_access";
    stored.view.message = access.timedOut ? "The repository check timed out." : "We couldn’t access this repository";
    stored.view.error = access.timedOut
      ? fail("TIMEOUT", "The repository check timed out.", true, ["Nothing has been enabled."])
      : fail("NEEDS_ACCESS", "We couldn’t access this repository", true);
    stored.view.access = accessView(ctx, repo, gh, Boolean(gh.login) && !access.timedOut);
    mark(stored, "access", "failed");
    stored.view.cancellable = false;
    save(ctx, stored);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    return;
  }
  mark(stored, "access", "complete");
  mark(stored, "download", "running");
  stored.view.state = "cloning";
  save(ctx, stored);

  const downloaded = await downloadRepository(ctx.runner, repo, stagingDir, env, access.authMethod, { signal });
  stored = fresh(ctx, id);
  if (stored.internal.cancelRequested || (!downloaded.ok && downloaded.code === "ABORTED")) {
    finishCancel(ctx, stored);
    return;
  }
  if (!downloaded.ok) {
    const denied = downloaded.code === "ACCESS";
    const gh = denied ? await readGhStatus(ctx.runner, env) : null;
    stored = fresh(ctx, id);
    stored.internal.timedOut = downloaded.timedOut;
    stored.internal.exitCode = downloaded.exitCode;
    if (gh) stored.internal.ghAvailable = gh.available;
    if (denied && gh) {
      stored.view.state = "needs_access";
      stored.view.message = "We couldn’t access this repository";
      stored.view.access = accessView(ctx, repo, gh, Boolean(gh.login));
      stored.view.error = fail("NEEDS_ACCESS", "We couldn’t access this repository", true);
    } else if (downloaded.code === "TIMEOUT") {
      stored.view.state = "failed";
      stored.view.message = "The download timed out.";
      stored.view.error = fail("TIMEOUT", "The download timed out.", true, ["Nothing has been enabled."]);
    } else if (downloaded.code === "LIMIT") {
      stored.view.state = "invalid";
      stored.view.message = "This plugin is larger than DevHub will download for review.";
      stored.view.error = fail("LIMIT", stored.view.message, false, ["Nothing has been enabled."]);
    } else if (downloaded.code === "UNSAFE") {
      stored.view.state = "invalid";
      stored.view.message = "This plugin contains an unsafe file path";
      stored.view.error = fail("UNSAFE", "A declared file points outside the plugin, or uses a file type DevHub won’t install.", false, ["Nothing has been enabled."]);
    } else {
      stored.view.state = "failed";
      stored.view.message = "Couldn’t download this repository.";
      stored.view.error = fail(downloaded.code, stored.view.message, true, ["Nothing has been enabled."]);
    }
    mark(stored, "download", "failed");
    stored.view.cancellable = false;
    save(ctx, stored);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    return;
  }
  stored.internal.workTree = downloaded.workTree;
  stored.internal.sha = downloaded.sha;
  stored.internal.branch = downloaded.branch;
  stored.internal.deleteStagingOnDone = true;
  mark(stored, "download", "complete");
  save(ctx, stored);
  const visibility = await readVisibility(ctx.runner, repo, env);
  stored = fresh(ctx, id);
  if (stored.internal.cancelRequested) {
    finishCancel(ctx, stored);
    return;
  }
  stored.internal.visibility = visibility;
  save(ctx, stored);
  await finishInspect(ctx, id, downloaded.workTree);
}

async function runLocalPrepare(ctx: PluginContext, id: string, root: string): Promise<void> {
  const stored = fresh(ctx, id);
  for (const stepId of ["url", "access", "download"]) mark(stored, stepId, "skipped");
  const stagingDir = path.join(ctx.paths.pluginHome, "staging", id);
  const tree = path.join(stagingDir, "tree");
  try {
    copyTree(root, tree);
  } catch {
    stored.view.state = "invalid";
    stored.view.message = "This plugin contains an unsafe file path";
    stored.view.error = fail("UNSAFE", stored.view.message, false, ["Nothing has been enabled."]);
    save(ctx, stored);
    return;
  }
  stored.internal.stagingDir = stagingDir;
  stored.internal.workTree = tree;
  stored.internal.deleteStagingOnDone = true;
  save(ctx, stored);
  await finishInspect(ctx, id, tree);
}

async function finishInspect(ctx: PluginContext, id: string, root: string): Promise<void> {
  let stored = fresh(ctx, id);
  mark(stored, "validate", "running");
  stored.view.state = "validating";
  save(ctx, stored);
  await yieldToLoop();
  const inspected = inspectTree(ctx, root, null);
  stored = fresh(ctx, id);
  mark(stored, "validate", inspected.fatal ? "failed" : "complete");
  mark(stored, "preview", "running");
  stored.view.state = "preparing_preview";
  save(ctx, stored);
  await yieldToLoop();
  const nameTaken = inspected.manifest ? nameCollision(ctx, inspected.manifest.name, null) : null;
  const preview = toPreview(ctx, id, 1, inspected, sourceFacts(ctx, id, stored), nameTaken);
  stored = fresh(ctx, id);
  stored.view.preview = preview;
  stored.internal.manifestHash = inspected.manifestHash;
  stored.internal.assetHashes = assetHashes(inspected);
  stored.internal.fingerprints = fingerprintMap(ctx, inspected);
  stored.internal.registryRevision = preview.registryRevision;
  stored.view.issues = inspected.issues.map((issue) => ({ file: issue.file, field: issue.field, message: issue.message }));
  mark(stored, "preview", "complete");
  if (inspected.fatal) {
    stored.view.state = "invalid";
    stored.view.message = inspected.heading;
    stored.view.error = fail(inspected.issues[0]?.code ?? "INVALID", inspected.heading || "This repository isn’t a valid DevHub plugin", false, ["Nothing has been enabled."]);
    stored.view.cancellable = false;
    save(ctx, stored);
    if (stored.internal.stagingDir) fs.rmSync(stored.internal.stagingDir, { recursive: true, force: true });
    return;
  }
  stored.view.state = "ready";
  stored.view.message = preview.heading;
  stored.view.cancellable = true;
  stored.view.phase = "Prepare preview";
  save(ctx, stored);
}

/** Re-review a retained download so a disabled plugin can be enabled again. */
function inspectRetained(ctx: PluginContext, stored: StoredOperation, allowName: string): void {
  const root = stored.internal.workTree;
  if (!root || !fs.existsSync(root)) {
    stored.view.state = "needs_attention";
    stored.view.message = "The downloaded plugin is missing.";
    stored.view.error = fail("MISSING_SOURCE", stored.view.message, false);
    save(ctx, stored);
    return;
  }
  const inspected = inspectTree(ctx, root, allowName);
  const preview = toPreview(ctx, stored.view.id, 1, inspected, {
    url: stored.internal.url,
    owner: null,
    repo: null,
    branch: stored.internal.branch,
    sha: stored.internal.sha,
    visibility: null,
    managed: true,
    destination: tildePath(root, ctx.home),
  }, null);
  stored.view.preview = preview;
  stored.internal.manifestHash = inspected.manifestHash;
  stored.internal.assetHashes = assetHashes(inspected);
  stored.internal.fingerprints = fingerprintMap(ctx, inspected);
  stored.internal.registryRevision = preview.registryRevision;
  stored.view.issues = inspected.issues.map((issue) => ({ file: issue.file, field: issue.field, message: issue.message }));
  stored.view.state = inspected.fatal ? "invalid" : "ready";
  stored.view.message = preview.heading;
  stored.view.cancellable = !inspected.fatal;
  save(ctx, stored);
}

function rebuildPreview(ctx: PluginContext, stored: StoredOperation): PluginPreview {
  const root = stored.internal.workTree;
  if (!root) throw new PluginApiError(409, "NOT_READY", "Review the plugin again before enabling it.", false, stored.view.id);
  const reenable = stored.view.kind === "enable";
  const inspected = inspectTree(ctx, root, reenable ? stored.view.preview?.plugin?.name ?? null : null);
  const nameTaken = inspected.manifest && !reenable ? nameCollision(ctx, inspected.manifest.name, stored.internal.pluginRecordId) : null;
  const preview = toPreview(ctx, stored.view.id, (stored.view.preview?.revision ?? 1) + 1, inspected, {
    ...sourceFacts(ctx, stored.view.id, stored),
    destination: stored.view.preview?.source.destination ?? null,
  }, nameTaken);
  stored.internal.assetHashes = assetHashes(inspected);
  stored.internal.fingerprints = fingerprintMap(ctx, inspected);
  stored.internal.registryRevision = preview.registryRevision;
  stored.internal.manifestHash = inspected.manifestHash;
  return preview;
}

async function applyInstall(ctx: PluginContext, stored: StoredOperation, selected: string[]): Promise<PluginOperationView> {
  const preview = stored.view.preview as PluginPreview;
  const name = preview.plugin?.name ?? "plugin";
  const reenable = stored.view.kind === "enable" && stored.internal.pluginRecordId !== null;
  const workTree = stored.internal.workTree;
  const pluginId = stored.internal.pluginRecordId ?? stored.view.id;
  const managed = reenable && workTree ? workTree : path.join(ctx.paths.pluginHome, "repos", pluginId);
  let copied = false;
  const stop = (error: PluginOperationError, state: "failed" | "expired" = "failed"): PluginOperationView => {
    if (copied) fs.rmSync(managed, { recursive: true, force: true });
    stored.view.state = state;
    stored.view.message = state === "expired" ? "Review expired" : `${name} couldn’t be enabled`;
    stored.view.error = error;
    save(ctx, stored);
    return stored.view;
  };
  try {
    mark(stored, "verify", "running");
    save(ctx, stored);
    if (!workTree || !hashesMatch(ctx, workTree, stored.internal.assetHashes)) {
      mark(stored, "verify", "failed");
      return stop(fail("PREVIEW_STALE", STALE_MESSAGE, false, ["Nothing was enabled."]), "expired");
    }
    mark(stored, "verify", "complete");
    mark(stored, "save", "running");
    save(ctx, stored);
    if (!reenable) {
      fs.rmSync(managed, { recursive: true, force: true });
      copyTree(workTree, managed);
      copied = true;
    }
    const inspected = inspectTree(ctx, managed, reenable ? name : null);
    if (inspected.fatal || inspected.manifestHash !== stored.internal.manifestHash || !hashesMatch(ctx, managed, stored.internal.assetHashes)) {
      mark(stored, "save", "failed");
      return stop(fail("PREVIEW_STALE", STALE_MESSAGE, false, ["Nothing was enabled."]), "expired");
    }
    mark(stored, "save", "complete");
    mark(stored, "sync", "running");
    save(ctx, stored);

    const applied = await applyReviewedAssets({
      pluginName: name,
      targetHome: ctx.paths.targetHome,
      selected,
      skills: inspected.skills,
      agents: inspected.agents,
      onProgress: (rows) => {
        stored.view.progress = rows;
        save(ctx, stored);
      },
    });
    if (!applied.ok) {
      mark(stored, "sync", "failed");
      const consequences = applied.leftover.length
        ? ["Plugin settings were not enabled.", "Some changes couldn’t be restored. Review the affected locations below."]
        : applied.rolledBack > 0
          ? ["Plugin settings were not enabled.", "Copies already written by this operation were removed."]
          : ["Nothing was enabled."];
      const retryable = applied.code === "TARGET_WRITE";
      return stop(fail(applied.code ?? "APPLY_FAILED", applied.message ?? "Nothing was enabled.", retryable, consequences, applied.leftover.map((file) => tildePath(file, ctx.home))));
    }
    const receipt: InstallReceipt = { pluginId, sha: stored.internal.sha, planDigest: preview.planDigest, files: applied.files };
    writeReceipt(ctx, receipt);
    mark(stored, "sync", "complete");
    mark(stored, "registry", "running");
    save(ctx, stored);
    const now = new Date().toISOString();
    try {
      if (reenable) {
        await patchPluginEntry(pluginId, {
          enabled: true,
          approvedSha: stored.internal.sha,
          approvedPlanDigest: preview.planDigest,
          lastOperation: { kind: "enable", at: now },
        }, ctx.home, ctx.env);
      } else {
        const source: ManagedSource = {
          kind: stored.internal.url ? "github" : "local",
          url: stored.internal.url,
          ref: stored.internal.url && stored.internal.branch ? `refs/heads/${stored.internal.branch}` : null,
          sha: stored.internal.sha,
        };
        await registerManagedPlugin({
          id: pluginId,
          name,
          path: managed,
          enabled: true,
          source,
          approvedSha: stored.internal.sha,
          approvedPlanDigest: preview.planDigest,
          installedAt: now,
        }, ctx.home, ctx.env);
      }
    } catch (err) {
      cleanupReceipt(receipt, ctx.paths.targetHome);
      removeReceipt(ctx, pluginId);
      mark(stored, "registry", "failed");
      const taken = err instanceof Error && err.message.includes("already registered");
      return stop(fail(
        "APPLY_FAILED",
        taken ? (err as Error).message : "Plugin settings couldn’t be saved.",
        !taken,
        ["Plugin settings were not enabled.", "Copies already written by this operation were removed."],
      ));
    }
    mark(stored, "registry", "complete");
    const skillCount = inspected.skills.filter((skill) => skill.preview.status === "add").length;
    const agentCount = inspected.agents.filter((agent) => agent.preview.status === "add").length;
    stored.view.state = "succeeded";
    stored.view.message = `${name} is enabled`;
    stored.view.error = null;
    stored.view.result = {
      name,
      skillCount,
      agentCount,
      targets: applied.targets,
      kept: [],
      summary: addedSummary(skillCount, agentCount),
      syncSummary: applied.targets.length ? syncSummary(applied.targets) : NOT_COPIED,
    };
    stored.view.cancellable = false;
    save(ctx, stored);
    if (stored.internal.deleteStagingOnDone && stored.internal.stagingDir) {
      fs.rmSync(stored.internal.stagingDir, { recursive: true, force: true });
    }
    return stored.view;
  } catch {
    return stop(fail("APPLY_FAILED", "Something went wrong while enabling this plugin.", true, ["Nothing was enabled."]));
  }
}

async function finishLifecycle(
  ctx: PluginContext,
  stored: StoredOperation,
  name: string,
  removal: boolean,
  kept: string[],
): Promise<PluginOperationView> {
  const heading = removal ? `${name} removed from DevHub. Downloaded files were kept.` : `${name} disabled.`;
  stored.view.state = "succeeded";
  stored.view.message = heading;
  stored.view.result = {
    name,
    skillCount: 0,
    agentCount: 0,
    targets: [],
    kept,
    summary: kept.length ? keptSummary(kept.length) : removal ? heading : "This plugin is kept on this computer and isn’t included in future syncs.",
    syncSummary: "",
  };
  save(ctx, stored);
  return stored.view;
}

function needsAttention(ctx: PluginContext, stored: StoredOperation, name: string, verb: "disabled" | "removed"): PluginOperationView {
  stored.view.state = "needs_attention";
  stored.view.message = `${name} couldn’t be ${verb}`;
  stored.view.error = fail(
    verb === "removed" ? "REMOVE_FAILED" : "DISABLE_FAILED",
    "The plugin is disabled, but some local copies need attention.",
    true,
    verb === "removed" ? ["The registration was kept so cleanup can be finished."] : [],
  );
  save(ctx, stored);
  return stored.view;
}

/** Disabling first stops the plugin being synced, then removes only copies still matching what was installed. */
async function disableAndClean(
  ctx: PluginContext,
  stored: StoredOperation,
  id: string,
): Promise<string[]> {
  mark(stored, "sync", "running");
  save(ctx, stored);
  await patchPluginEntry(id, { enabled: false, lastOperation: { kind: "disable", at: new Date().toISOString() } }, ctx.home, ctx.env);
  mark(stored, "sync", "complete");
  mark(stored, "copies", "running");
  save(ctx, stored);
  const receipt = readReceipt(ctx, id);
  const cleaned = receipt ? cleanupReceipt(receipt, ctx.paths.targetHome) : { removed: [], kept: [] };
  // Whatever was removed is gone; whatever was kept is no longer ours to track.
  if (receipt) writeReceipt(ctx, { ...receipt, files: [] });
  mark(stored, "copies", "complete");
  save(ctx, stored);
  return cleaned.kept.map((file) => tildePath(file, ctx.home));
}

async function applyDisable(ctx: PluginContext, stored: StoredOperation): Promise<PluginOperationView> {
  const entry = findEntry(ctx, stored.internal.pluginRecordId ?? "");
  const name = entry?.name || "plugin";
  if (!entry) return needsAttention(ctx, stored, name, "disabled");
  try {
    const kept = await disableAndClean(ctx, stored, entry.id);
    return await finishLifecycle(ctx, stored, name, false, kept);
  } catch {
    return needsAttention(ctx, stored, name, "disabled");
  }
}

async function applyRemove(ctx: PluginContext, stored: StoredOperation): Promise<PluginOperationView> {
  const entry = findEntry(ctx, stored.internal.pluginRecordId ?? "");
  const name = entry?.name || "plugin";
  if (!entry) return needsAttention(ctx, stored, name, "removed");
  try {
    const kept = await disableAndClean(ctx, stored, entry.id);
    mark(stored, "registry", "running");
    save(ctx, stored);
    await removePluginEntry(entry.id, ctx.home, ctx.env);
    removeReceipt(ctx, entry.id);
    mark(stored, "registry", "complete");
    return await finishLifecycle(ctx, stored, name, true, kept);
  } catch {
    // The disabled registration stays, with its receipt, so cleanup can be finished.
    return needsAttention(ctx, stored, name, "removed");
  }
}

function copyTree(src: string, dest: string): void {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  const walk = (from: string, to: string) => {
    for (const name of fs.readdirSync(from)) {
      if (name === ".git") continue;
      const source = path.join(from, name);
      const target = path.join(to, name);
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) throw new Error("unsafe");
      if (stat.isDirectory()) {
        fs.mkdirSync(target, { recursive: true, mode: 0o700 });
        walk(source, target);
      } else if (stat.isFile()) {
        fs.copyFileSync(source, target);
        fs.chmodSync(target, stat.mode & 0o777);
      } else {
        throw new Error("unsafe");
      }
    }
  };
  walk(src, dest);
}

function finishCancel(ctx: PluginContext, stored: StoredOperation): PluginOperationView {
  const installing = stored.view.kind === "install" || stored.view.kind === "enable";
  stored.view.state = "cancelled";
  stored.view.message = installing ? "Cancelled. No plugin was enabled." : "Cancelled. Nothing was changed.";
  stored.view.cancellable = false;
  stored.internal.cancelRequested = true;
  save(ctx, stored);
  // Only this review's own staging goes. A retained download belongs to its registration.
  if (stored.internal.stagingDir) fs.rmSync(stored.internal.stagingDir, { recursive: true, force: true });
  return stored.view;
}

function failUnexpected(ctx: PluginContext, id: string): void {
  try {
    const stored = readStored(ctx, id);
    if (terminal(stored.view.state)) return;
    stored.view.state = "failed";
    stored.view.message = "Couldn’t review this plugin.";
    stored.view.error = fail("INTERNAL", "Couldn’t review this plugin.", true, ["Nothing has been enabled."]);
    stored.view.cancellable = false;
    save(ctx, stored);
    if (stored.internal.stagingDir) fs.rmSync(stored.internal.stagingDir, { recursive: true, force: true });
  } catch {
    // The operation file itself could not be read.
  }
}

function rateLimit(pluginHome: string): void {
  const now = Date.now();
  const stamps = (prepares.get(pluginHome) ?? []).filter((stamp) => now - stamp < 60_000);
  if (stamps.length >= 8) {
    throw new PluginApiError(429, "RATE_LIMIT", "Too many plugin reviews. Wait a minute and try again.", true);
  }
  stamps.push(now);
  prepares.set(pluginHome, stamps);
}
