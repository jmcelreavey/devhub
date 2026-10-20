import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { writeAtomic } from "@/lib/atomic-write";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { readStateFile } from "./state-file";
import { slackStateRoot } from "./store";
import { readGatewayDevice } from "./gateway-state";
import { slackTransportContext } from "./transport-context";

export const CONFIRM_TTL_MS = 10 * 60 * 1000;

const EntrySchema = z.object({
  /** run: Confirm executes the tool. pick: fills details, then asks. undo: reverses a one-click task change. view: shows more of a card (read-only). */
  kind: z.enum(["run", "pick", "undo", "view"]),
  tool: z.string(), args: z.record(z.string(), z.unknown()),
  /** The original message, kept so a "Did you mean…?" pick can fill arguments from it. */
  text: z.string().optional(),
  /** What an undo or view is about, in words, for the message that replaces its card. */
  label: z.string().optional(),
  profile: z.string(), teamId: z.string(), userId: z.string(), channel: z.string(), threadTs: z.string().optional(),
  expiresAt: z.number(), state: z.enum(["pending", "consumed", "cancelled"]),
  deviceId: z.string().optional(), argsHash: z.string().optional(), nonce: z.string().optional(),
});
const StateSchema = z.object({ version: z.literal(1), entries: z.record(z.string(), EntrySchema) });
export type ToolConfirmEntry = z.infer<typeof EntrySchema>;
export type ToolConfirmInput = Omit<ToolConfirmEntry, "expiresAt" | "state" | "deviceId" | "argsHash" | "nonce">;
export type ClaimResult = { ok: true; entry: ToolConfirmEntry } | { ok: false; reason: "missing" | "expired" | "used" | "wrong-user" | "wrong-kind" };

/** Pending tool confirmations (and "did you mean" picks): single-use, expiring, bound to one user. */
export class ToolConfirmStore {
  constructor(readonly root = slackStateRoot(), private readonly now: () => number = Date.now,
    private readonly device: () => string | undefined = () => slackTransportContext.getStore()?.deviceId ?? (process.env.SLACK_TRANSPORT === "gateway" ? readGatewayDevice()?.deviceId : undefined)) {}

  private read(): z.infer<typeof StateSchema> {
    return readStateFile(path.join(this.root, "tool-confirm.json"), (value) => StateSchema.parse(value), () => ({ version: 1, entries: {} }));
  }

  private async change<Result>(update: (state: z.infer<typeof StateSchema>) => Result): Promise<Result> {
    return withPluginMutationLock(path.join(this.root, "tool-confirm"), async () => {
      const state = this.read();
      for (const [id, entry] of Object.entries(state.entries)) if (entry.expiresAt + CONFIRM_TTL_MS < this.now()) delete state.entries[id];
      const result = update(state);
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
      await writeAtomic(path.join(this.root, "tool-confirm.json"), JSON.stringify(state));
      fs.chmodSync(path.join(this.root, "tool-confirm.json"), 0o600);
      return result;
    });
  }

  create(input: ToolConfirmInput): Promise<string> {
    return this.change((state) => {
      const id = randomBytes(16).toString("hex");
      const deviceId = this.device();
      state.entries[id] = { ...input, expiresAt: this.now() + CONFIRM_TTL_MS, state: "pending",
        ...(deviceId ? { deviceId, argsHash: createHash("sha256").update(JSON.stringify(input.args)).digest("hex"), nonce: id } : {}) };
      return id;
    });
  }

  peek(id: string): ToolConfirmEntry | undefined { return this.read().entries[id]; }

  /**
   * Atomically takes the entry: only the first valid claim by the right user wins. `kind` is what
   * the clicked button is allowed to take; a mismatch is refused without using the entry up.
   */
  claim(id: string, who: { userId: string; teamId: string; channel: string; deviceId?: string }, outcome: "consumed" | "cancelled" = "consumed", kind?: ToolConfirmEntry["kind"]): Promise<ClaimResult> {
    return this.change((state): ClaimResult => {
      const entry = state.entries[id];
      if (!entry) return { ok: false, reason: "missing" };
      if (entry.userId !== who.userId || entry.teamId !== who.teamId || entry.channel !== who.channel) return { ok: false, reason: "wrong-user" };
      if (entry.deviceId !== who.deviceId || (entry.deviceId && (entry.nonce !== id || entry.argsHash !== createHash("sha256").update(JSON.stringify(entry.args)).digest("hex")))) return { ok: false, reason: "wrong-user" };
      if (kind && entry.kind !== kind) return { ok: false, reason: "wrong-kind" };
      if (entry.state !== "pending") return { ok: false, reason: "used" };
      if (entry.expiresAt < this.now()) return { ok: false, reason: "expired" };
      entry.state = outcome;
      return { ok: true, entry: { ...entry } };
    });
  }
}
