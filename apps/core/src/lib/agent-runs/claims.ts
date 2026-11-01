import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { agentRunsDir } from "./store";
import { sqliteRunsEnabled } from "../../domains/storage/runs";
import { requestClaimStorage } from "../../domains/storage/request-claims";

function claimHash(requestId: string): string {
  return createHash("sha256").update(requestId).digest("hex");
}

function claimFile(requestId: string): string {
  return path.join(agentRunsDir(), ".requests", claimHash(requestId) + ".json");
}

export async function readAgentRequest(requestId: string): Promise<string | null> {
  if (process.env.DEVHUB_STORAGE_URL || sqliteRunsEnabled()) return requestClaimStorage(agentRunsDir()).read(claimHash(requestId));
  let raw: string;
  try { raw = fs.readFileSync(claimFile(requestId), "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const claim: unknown = JSON.parse(raw);
    if (typeof claim === "object" && claim !== null && "runId" in claim && typeof claim.runId === "string") return claim.runId;
  } catch { /* An incomplete claim must not authorize another submission. */ }
  throw new Error("The prior request needs attention before it can be retried.");
}

/** Hold the local admission lock across async claim persistence. */
export async function withAgentAdmission<T>(action: () => T | Promise<T>): Promise<T> {
  const dir = agentRunsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = path.join(dir, ".admission");
  try { fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(fs.readFileSync(lock, "utf8"));
    let alive = true;
    if (Number.isSafeInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
    }
    if (!alive) { fs.rmSync(lock); return withAgentAdmission(action); }
    throw new Error("Another agent request is starting. Try again in a moment.");
  }
  try { return await action(); } finally { fs.rmSync(lock, { force: true }); }
}

/** A durable cross-process claim. Ambiguous attempts are never silently replayed. */
export async function claimAgentRequest(requestId: string, runId: string): Promise<string> {
  if (process.env.DEVHUB_STORAGE_URL || sqliteRunsEnabled()) return requestClaimStorage(agentRunsDir()).claim(claimHash(requestId), runId);
  const dir = path.join(agentRunsDir(), ".requests");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = claimFile(requestId);
  try {
    fs.writeFileSync(file, JSON.stringify({ runId }), { flag: "wx", mode: 0o600 });
    return runId;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const claim: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof claim !== "object" || claim === null || !("runId" in claim) || typeof claim.runId !== "string") throw new Error("The prior request needs attention before it can be retried.");
    return claim.runId;
  }
}

/** Release an unsubmitted claim while still holding the admission lock. */
export async function releaseAgentRequest(requestId: string, runId: string): Promise<void> {
  if (process.env.DEVHUB_STORAGE_URL || sqliteRunsEnabled()) return requestClaimStorage(agentRunsDir()).release(claimHash(requestId), runId);
  if (await readAgentRequest(requestId) === runId) fs.rmSync(claimFile(requestId));
}
