import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { writeAtomic } from "@/lib/atomic-write";
import { profileStateDir } from "@/lib/profile-state";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { providerFor } from "./registry";
import { assertCapability, IntegrationError, type IntegrationProvider } from "./types";
import { WriteInputSchema, type WriteProposal, type WriteInput, type PreparedWrite } from "./write-types";
import { captureTaskJiraKey, linkCreatedJiraTask } from "./jira-task-link";

export function writesRoot() { return path.join(profileStateDir(), "integration-writes"); }
export function writeDigest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
const RecordSchema = z.object({
  id: z.string().uuid(), profile: z.string(), input: WriteInputSchema, source: z.string(), createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
  state: z.enum(["requested", "pending", "unknown", "succeeded", "failed", "cancelled"]),
  approval: z.enum(["direct", "review"]).optional(),
  taskJiraKey: z.string().nullable().optional(), taskLink: z.enum(["linked", "skipped", "failed"]).optional(),
  prepared: z.object({ destination: z.string(), actor: z.string(), summary: z.string(), details: z.record(z.string(), z.unknown()), native: z.record(z.string(), z.unknown()) }).optional(),
  digest: z.string().optional(), detail: z.string().optional(), confirmedAt: z.string().datetime().optional(), finishedAt: z.string().datetime().optional(), receipt: z.object({ detail: z.string(), item: z.unknown().optional() }).optional(),
});
function filename(root: string, id: string) { return path.join(root, z.string().uuid().parse(id) + ".json"); }
function read(root: string, id: string): WriteProposal {
  return RecordSchema.parse(JSON.parse(fs.readFileSync(filename(root, id), "utf8"))) as WriteProposal;
}
async function save(root: string, proposal: WriteProposal) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  await writeAtomic(filename(root, proposal.id), JSON.stringify(proposal));
  fs.chmodSync(filename(root, proposal.id), 0o600);
}
export function listWrites(profile: string, root = writesRoot()): WriteProposal[] {
  let files: string[];
  try { files = fs.readdirSync(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return files.filter((f) => /^[a-f0-9-]{36}\.json$/.test(f)).map((f) => read(root, f.slice(0, -5))).filter((p) => p.profile === profile).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
interface Options { root?: string; now?: number; provider?: (id: string) => IntegrationProvider }
function adapter(input: WriteInput, options: Options) {
  const provider = (options.provider ?? providerFor)(input.provider);
  assertCapability(provider, input.action);
  if (!provider.accounts().some((a) => a.id === input.account)) throw new IntegrationError("not-found", "This account is no longer configured.");
  if (!provider.prepareWrite || !provider.executeWrite) throw new IntegrationError("unsupported", "This provider cannot prepare and execute writes.");
  return provider as IntegrationProvider & Required<Pick<IntegrationProvider, "prepareWrite" | "executeWrite">>;
}
function owned(root: string, id: string, profile: string) {
  const proposal = read(root, id);
  if (proposal.profile !== profile) throw new IntegrationError("not-found", "Proposal not found in this work profile.");
  return proposal;
}
export async function requestWrite(raw: unknown, profile: string, source = "DevHub", options: Options & { id?: string } = {}): Promise<WriteProposal> {
  const input = WriteInputSchema.parse(raw); adapter(input, options);
  const root = options.root ?? writesRoot(); const now = options.now ?? Date.now();
  return withPluginMutationLock(root, async () => {
    if (options.id && fs.existsSync(filename(root, options.id))) return owned(root, options.id, profile);
    const records = listWrites(profile, root);
    if (records.filter((p) => ["requested", "pending"].includes(p.state) && Date.parse(p.expiresAt) > now).length >= 100) throw new IntegrationError("rate-limit", "There are 100 pending actions. Review or cancel them before adding more.");
    const proposal: WriteProposal = { id: options.id ?? randomUUID(), profile, input, source, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 15 * 60000).toISOString(), state: "requested" };
    if (input.action === "issue.create" && input.taskId) proposal.taskJiraKey = await captureTaskJiraKey(profile, input.taskId);
    await save(root, proposal);
    return proposal;
  }, { waitMs: 1000 });
}
function pending(proposal: WriteProposal, now: number) {
  if (!["requested", "pending"].includes(proposal.state)) throw new IntegrationError("conflict", "This action is no longer awaiting confirmation. Check its recorded outcome.");
  if (Date.parse(proposal.expiresAt) <= now) throw new IntegrationError("conflict", "This proposal expired. Create and review a fresh action.");
}
export async function reviewWrite(id: string, profile: string, signal: AbortSignal, options: Options = {}): Promise<WriteProposal> {
  const root = options.root ?? writesRoot();
  return withPluginMutationLock(path.join(root, z.string().uuid().parse(id)), async () => {
    const proposal = owned(root, id, profile); pending(proposal, options.now ?? Date.now());
    const provider = adapter(proposal.input, options);
    proposal.prepared = await provider.prepareWrite(proposal.input, { signal });
    proposal.digest = writeDigest({ input: proposal.input, prepared: proposal.prepared });
    proposal.state = "pending";
    await save(root, proposal); return proposal;
  });
}
export async function cancelWrite(id: string, profile: string, options: Options = {}) {
  const root = options.root ?? writesRoot();
  return withPluginMutationLock(path.join(root, z.string().uuid().parse(id)), async () => {
    const proposal = owned(root, id, profile);
    if (!["requested", "pending"].includes(proposal.state)) throw new IntegrationError("conflict", "This action has already started or finished.");
    proposal.state = "cancelled"; await save(root, proposal); return proposal;
  });
}
/** Persist before sending: a crash or an ambiguous response must never replay a write. */
async function send(root: string, proposal: WriteProposal, prepared: PreparedWrite, provider: ReturnType<typeof adapter>, signal: AbortSignal, options: Options) {
  const stamp = () => new Date(options.now ?? Date.now()).toISOString();
  signal.throwIfAborted();
  proposal.state = "unknown";
  proposal.confirmedAt = stamp();
  proposal.detail = "Outcome unknown. Check the provider before creating another action; it could duplicate this one.";
  await save(root, proposal);
  try {
    proposal.receipt = await provider.executeWrite(proposal.input, prepared, { signal, approvalId: proposal.id });
    proposal.state = "succeeded"; proposal.detail = proposal.receipt.detail;
  } catch (error) {
    if (error instanceof IntegrationError && ["auth", "invalid", "not-found", "conflict", "rate-limit", "unsupported"].includes(error.kind)) {
      proposal.state = "failed"; proposal.detail = error.message;
    }
  }
  proposal.finishedAt = stamp();
  await save(root, proposal);
  if (proposal.state === "succeeded" && proposal.input.action === "issue.create" && proposal.input.taskId) {
    try {
      proposal.taskLink = await linkCreatedJiraTask(proposal);
      if (proposal.taskLink === "skipped") proposal.detail += ". Task link left unchanged because its Jira key changed or the receipt could not be matched.";
    } catch {
      proposal.taskLink = "failed";
      proposal.detail += ". Jira succeeded, but the task could not be linked. Check the task before retrying; do not create another ticket.";
    }
    await save(root, proposal);
  }
  return proposal;
}
export async function confirmWrite(id: string, digest: string, profile: string, signal: AbortSignal, options: Options = {}, approval?: { via: "chat"; quote: string }): Promise<WriteProposal> {
  const root = options.root ?? writesRoot();
  return withPluginMutationLock(path.join(root, z.string().uuid().parse(id)), async () => {
    const proposal = owned(root, id, profile); pending(proposal, options.now ?? Date.now());
    if (proposal.state !== "pending" || !proposal.prepared || proposal.digest !== digest || writeDigest({ input: proposal.input, prepared: proposal.prepared }) !== digest) throw new IntegrationError("conflict", "Review the exact action before confirming.");
    const provider = adapter(proposal.input, options);
    const fresh: PreparedWrite = await provider.prepareWrite(proposal.input, { signal });
    if (writeDigest({ input: proposal.input, prepared: fresh }) !== digest) throw new IntegrationError("conflict", "The account, destination or remote item changed. Review the action again.");
    pending(proposal, options.now ?? Date.now());
    proposal.approval = approval ? "chat" : "review";
    if (approval) proposal.approvalNote = approval.quote.slice(0, 500);
    return send(root, proposal, fresh, provider, signal, options);
  });
}
export interface DirectWrite { proposal: WriteProposal; timings: Record<string, number> }
/**
 * A person's own click in DevHub is the approval, so there is no proposal to
 * review: prepare once, record, send. The record still lands in the same audit
 * trail (`approval: "direct"`). Callers must only reach this from a human
 * session; agent and chat requests go through requestWrite + confirmWrite.
 */
export async function writeNow(raw: unknown, profile: string, signal: AbortSignal, options: Options = {}): Promise<DirectWrite> {
  const input = WriteInputSchema.parse(raw); const provider = adapter(input, options);
  const root = options.root ?? writesRoot(); const now = options.now ?? Date.now();
  const proposal: WriteProposal = { id: randomUUID(), profile, input, source: "DevHub", approval: "direct", createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 15 * 60000).toISOString(), state: "requested" };
  if (input.action === "issue.create" && input.taskId) proposal.taskJiraKey = await captureTaskJiraKey(profile, input.taskId);
  const timings: Record<string, number> = {};
  const timed = async <T>(name: string, work: () => Promise<T>) => { const started = performance.now(); try { return await work(); } finally { timings[name] = Math.round((performance.now() - started) * 10) / 10; } };
  let prepared: PreparedWrite;
  try { prepared = await timed("prepare", () => provider.prepareWrite(input, { signal })); }
  catch (error) {
    // Keep the attempt in the trail: "I clicked and nothing happened" must be answerable.
    if (error instanceof IntegrationError) { proposal.state = "failed"; proposal.detail = error.message; proposal.finishedAt = new Date(now).toISOString(); await save(root, proposal); }
    throw error;
  }
  proposal.prepared = prepared; proposal.digest = writeDigest({ input, prepared });
  await timed("send", () => send(root, proposal, prepared, provider, signal, options));
  return { proposal, timings };
}
