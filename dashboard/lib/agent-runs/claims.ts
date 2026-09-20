import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { agentRunsDir } from "./store";

function claimFile(requestId: string): string {
  return path.join(agentRunsDir(), ".requests", createHash("sha256").update(requestId).digest("hex") + ".json");
}

export function readAgentRequest(requestId: string): string | null {
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

/** Reserve capacity synchronously, before awaiting runtime or worktree startup. */
export function withAgentAdmission<T>(action: () => T): T {
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
  try { return action(); } finally { fs.rmSync(lock, { force: true }); }
}

/** A durable cross-process claim. Ambiguous attempts are never silently replayed. */
export function claimAgentRequest(requestId: string, runId: string): string {
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
