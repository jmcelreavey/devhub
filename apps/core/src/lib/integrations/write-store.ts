import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { writeAtomic } from "../atomic-write";
import { profileStateDir } from "../../../../../packages/shared/storage/profile-state";
import { withPluginMutationLock } from "../plugins/lock";
import { providerFor } from "./registry";
import { assertCapability, IntegrationError, type IntegrationProvider } from "./types";
import { WriteInputSchema, type WriteResult, type WriteInput, type PreparedWrite } from "./write-types";
import { captureTaskJiraKey, linkCreatedJiraTask } from "./jira-task-link";

export function writesRoot() { return path.join(profileStateDir(), "integration-writes"); }
async function save(root: string, result: WriteResult) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, result.id + ".json");
  await writeAtomic(file, JSON.stringify(result));
  fs.chmodSync(file, 0o600);
}
interface Options { source?: string; root?: string; now?: number; provider?: (id: string) => IntegrationProvider; idempotencyKey?: string; authorised?: () => boolean }
async function adapter(input: WriteInput, options: Options) {
  const provider = (options.provider ?? providerFor)(input.provider);
  assertCapability(provider, input.action);
  if (!(await provider.accounts()).some((a) => a.id === input.account)) throw new IntegrationError("not-found", "This account is no longer configured.");
  if (!provider.prepareWrite || !provider.executeWrite) throw new IntegrationError("unsupported", "This provider cannot prepare and execute writes.");
  return provider as IntegrationProvider & Required<Pick<IntegrationProvider, "prepareWrite" | "executeWrite">>;
}
/** Persist before sending: a crash or an ambiguous response must never replay a write. */
async function send(root: string, result: WriteResult, prepared: PreparedWrite, provider: Awaited<ReturnType<typeof adapter>>, signal: AbortSignal, options: Options) {
  const stamp = () => new Date(options.now ?? Date.now()).toISOString();
  signal.throwIfAborted();
  result.state = "unknown";
  result.confirmedAt = stamp();
  result.detail = "Outcome unknown. Check the provider before creating another action; it could duplicate this one.";
  await save(root, result);
  if (options.authorised && !options.authorised()) {
    result.state = "failed"; result.detail = "Authorisation changed before sending."; result.finishedAt = stamp();
    await save(root, result);
    return result;
  }
  try {
    result.receipt = await provider.executeWrite(result.input, prepared, { signal, requestId: result.id });
    result.state = "succeeded"; result.detail = result.receipt.detail;
  } catch (error) {
    if (error instanceof IntegrationError && ["auth", "invalid", "not-found", "conflict", "rate-limit", "unsupported"].includes(error.kind)) {
      result.state = "failed"; result.detail = error.message;
    }
  }
  result.finishedAt = stamp();
  await save(root, result);
  if (result.state === "succeeded" && result.input.provider === "jira" && result.input.action === "issue.create" && result.input.taskId) {
    try {
      result.taskLink = await linkCreatedJiraTask(result);
      if (result.taskLink === "skipped") result.detail += ". Task link left unchanged because its Jira key changed or the receipt could not be matched.";
    } catch {
      result.taskLink = "failed";
      result.detail += ". Jira succeeded, but the task could not be linked. Check the task before retrying; do not create another ticket.";
    }
    await save(root, result);
  }
  return result;
}
export interface DirectWrite { result: WriteResult; timings: Record<string, number> }
/** Prepare and execute once; persist uncertain outcomes without replaying them. */
export async function writeNow(raw: unknown, profile: string, signal: AbortSignal, options: Options = {}): Promise<DirectWrite> {
  const input = WriteInputSchema.parse(raw);
  if (options.idempotencyKey) {
    const id = createHash("sha256").update(JSON.stringify([profile, options.idempotencyKey])).digest("hex");
    const root = options.root ?? writesRoot();
    return withPluginMutationLock(path.join(root, ".locks", id), async () => {
      if (options.authorised && !options.authorised()) throw new IntegrationError("conflict", "Authorisation changed.");
      let saved: WriteResult | undefined;
      try {
        const raw: unknown = JSON.parse(fs.readFileSync(path.join(root, id + ".json"), "utf8"));
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new IntegrationError("conflict", "The previous write record is invalid.");
        saved = raw as WriteResult;
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (saved) {
        if (saved.id !== id || saved.profile !== profile || JSON.stringify(saved.input) !== JSON.stringify(input) || !["unknown", "succeeded", "failed"].includes(saved.state)) throw new IntegrationError("conflict", "The request id belongs to another write.");
        return { result: saved, timings: {} };
      }
      return writeNowOnce(input, profile, signal, options, id);
    });
  }
  return writeNowOnce(input, profile, signal, options, randomUUID());
}

async function writeNowOnce(input: WriteInput, profile: string, signal: AbortSignal, options: Options, id: string): Promise<DirectWrite> {
  const provider = await adapter(input, options);
  const root = options.root ?? writesRoot(); const now = options.now ?? Date.now();
  const result: WriteResult = { id, profile, input, source: options.source ?? "DevHub", createdAt: new Date(now).toISOString(), state: "unknown" };
  if (input.provider === "jira" && input.action === "issue.create" && input.taskId) result.taskJiraKey = await captureTaskJiraKey(profile, input.taskId);
  const timings: Record<string, number> = {};
  const timed = async <T>(name: string, work: () => Promise<T>) => { const started = performance.now(); try { return await work(); } finally { timings[name] = Math.round((performance.now() - started) * 10) / 10; } };
  let prepared: PreparedWrite;
  try { prepared = await timed("prepare", () => provider.prepareWrite(input, { signal })); }
  catch (error) {
    // Keep the attempt in the trail: "I clicked and nothing happened" must be answerable.
    if (error instanceof IntegrationError) { result.state = "failed"; result.detail = error.message; result.finishedAt = new Date(now).toISOString(); await save(root, result); }
    throw error;
  }
  result.prepared = prepared;
  await timed("send", () => send(root, result, prepared, provider, signal, options));
  return { result, timings };
}
