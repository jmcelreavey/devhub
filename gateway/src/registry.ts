import fs from "node:fs";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { validGatewayId, validSlackUser, type GatewayBinding, type HandoffStatus } from "../../shared/slack-gateway/protocol.ts";
import { validPublicKey } from "./auth.ts";

export const PAIR_TTL = 10 * 60_000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export interface Device extends GatewayBinding { publicKey: string; label: string; linkedAt: number; lastSeen: number; revoked: boolean; revokedAt?: number }
export interface Pairing { code: string; deviceId: string; publicKey: string; label: string; expiresAt: number; attempts: number }
export interface MessageReceipt {
  deviceId: string; userId: string; channel: string; ts: string; threadTs?: string;
  kind?: "ask" | "handoff"; askId?: string; helperUserId?: string; handoffId?: string;
  toUserId?: string; toDeviceId?: string; expiresAt?: number; status?: HandoffStatus; byUserId?: string;
  groupDm?: boolean;
}
const RECEIPT_FIELDS = ["deviceId", "userId", "channel", "ts", "threadTs", "kind", "askId", "helperUserId", "handoffId", "toUserId", "toDeviceId", "expiresAt", "status", "byUserId", "groupDm"];

function validReceipt(entry: MessageReceipt): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some((key) => !RECEIPT_FIELDS.includes(key))) return false;
  if (entry.groupDm !== undefined && (typeof entry.groupDm !== "boolean" || entry.kind !== "ask" || !entry.channel?.startsWith("G"))) return false;
  if (typeof entry.deviceId !== "string" || !entry.deviceId || !validSlackUser(entry.userId)
    || typeof entry.channel !== "string" || !/^[CDG][A-Z0-9]+$/.test(entry.channel)
    || typeof entry.ts !== "string" || !/^\d+\.\d+$/.test(entry.ts)
    || (entry.threadTs !== undefined && (typeof entry.threadTs !== "string" || !/^\d+\.\d+$/.test(entry.threadTs)))) return false;
  if (entry.kind === undefined) return [entry.askId, entry.helperUserId, entry.handoffId, entry.toUserId, entry.toDeviceId, entry.expiresAt, entry.status, entry.byUserId].every((value) => value === undefined);
  if (typeof entry.expiresAt !== "number" || !Number.isSafeInteger(entry.expiresAt) || entry.expiresAt <= 0) return false;
  if (entry.kind === "ask") return validGatewayId(entry.askId) && validSlackUser(entry.helperUserId) && entry.helperUserId !== entry.userId
    && [entry.handoffId, entry.toUserId, entry.toDeviceId, entry.status, entry.byUserId].every((value) => value === undefined);
  return entry.kind === "handoff" && validGatewayId(entry.handoffId) && validSlackUser(entry.toUserId) && entry.toUserId !== entry.userId
    && (entry.toDeviceId === undefined || (typeof entry.toDeviceId === "string" && !!entry.toDeviceId))
    && typeof entry.status === "string" && ["pending", "accepted", "declined", "expired"].includes(entry.status)
    && (entry.byUserId === undefined || entry.byUserId === entry.toUserId) && entry.askId === undefined && entry.helperUserId === undefined;
}
interface RegistryState { devices: Device[]; pending: Pairing[]; receipts: MessageReceipt[] }
export const REGISTRY_SAVE_MS = 1000;
export const REVOKED_RETENTION_MS = 30 * 86400_000;
export const HANDOFF_RETENTION_MS = 7 * 86400_000;

export class Registry {
  private readonly file?: string;
  private readonly now: () => number;
  private state: RegistryState;
  private readonly receipts = new Map<string, MessageReceipt>();
  private readonly threads = new Map<string, MessageReceipt>();
  private readonly threadOwners = new Map<string, MessageReceipt>();
  private readonly handoffs = new Map<string, MessageReceipt>();
  private readonly asks = new Map<string, MessageReceipt>();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private dirty = false;

  constructor(file?: string, now = Date.now) {
    this.file = file;
    this.now = now;
    this.state = { devices: [], pending: [], receipts: [] };
    if (file && fs.existsSync(file)) {
      try {
        const state = JSON.parse(fs.readFileSync(file, "utf8")) as RegistryState;
        if (!state || !Array.isArray(state.devices) || !Array.isArray(state.pending) || (state.receipts !== undefined && !Array.isArray(state.receipts))) throw new Error("Invalid registry");
        const stringFields = (value: unknown, fields: string[]) => !!value && typeof value === "object" && fields.every((field) => typeof (value as Record<string, unknown>)[field] === "string");
        if (!state.devices.every((entry) => stringFields(entry, ["deviceId", "teamId", "userId", "userName", "dmChannelId", "publicKey", "label"]) && Number.isFinite(entry.linkedAt) && Number.isFinite(entry.lastSeen) && typeof entry.revoked === "boolean" && validPublicKey(entry.publicKey))
          || !state.pending.every((entry) => stringFields(entry, ["code", "deviceId", "publicKey", "label"]) && Number.isFinite(entry.expiresAt) && Number.isFinite(entry.attempts) && validPublicKey(entry.publicKey))
          || !(state.receipts ?? []).every(validReceipt)) throw new Error("Invalid registry entries");
        this.state = { ...state, receipts: state.receipts ?? [] };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code && !(error instanceof SyntaxError)) throw error;
        fs.renameSync(file, `${file}.corrupt-${this.now()}-${randomUUID()}`);
        console.error("[gateway] REGISTRY CORRUPT: quarantined metadata; starting empty. All members must re-link.");
      }
    }
    for (const receipt of this.state.receipts.slice(-20_000)) this.indexReceipt(receipt);
    this.pruneDevices();
  }

  private save(immediate = true): void {
    this.dirty = true;
    if (!this.file) { this.pruneDevices(); return; }
    if (immediate) { this.flush(); return; }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      try { this.flush(); }
      catch { console.error("[gateway] Registry persistence failed; metadata is still in memory."); this.save(false); }
    }, REGISTRY_SAVE_MS);
    this.saveTimer.unref();
  }

  flush(): void {
    clearTimeout(this.saveTimer); this.saveTimer = undefined;
    if (!this.file || !this.dirty) return;
    this.pruneDevices();
    this.state.receipts = [...this.receipts.values()];
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const descriptor = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(descriptor, JSON.stringify(this.state)); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, this.file);
      this.dirty = false;
    } finally { fs.rmSync(temporary, { force: true }); }
  }

  private pruneDevices(): void {
    const kept = new Map<string, number>();
    this.state.devices = [...this.state.devices].reverse().filter((device) => {
      if (!device.revoked) return true;
      if ((device.revokedAt ?? device.lastSeen) < this.now() - REVOKED_RETENTION_MS) return false;
      const key = `${device.teamId}:${device.userId}`;
      const count = kept.get(key) ?? 0;
      kept.set(key, count + 1);
      return count < 5;
    }).reverse();
  }

  register(publicKey: string, label: string): Pairing {
    if (!validPublicKey(publicKey)) throw new Error("Invalid public key");
    this.state.pending = this.state.pending.filter((entry) => entry.expiresAt > this.now() && entry.attempts < 5);
    if (this.state.pending.length >= 1000) throw new Error("Pairing capacity reached");
    let code: string;
    do { code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""); }
    while (this.state.pending.some((entry) => entry.code === code));
    const pairing = { code, deviceId: randomUUID(), publicKey, label: label.slice(0, 80), expiresAt: this.now() + PAIR_TTL, attempts: 0 };
    this.state.pending.push(pairing);
    this.save();
    return { ...pairing };
  }

  key(deviceId: string): string | undefined {
    return this.device(deviceId)?.publicKey ?? this.state.pending.find((entry) => entry.deviceId === deviceId && entry.expiresAt > this.now() && entry.attempts < 5)?.publicKey;
  }

  device(deviceId: string): Device | undefined { return this.state.devices.find((entry) => entry.deviceId === deviceId && !entry.revoked); }
  member(teamId: string, userId: string): Device | undefined { return this.state.devices.find((entry) => entry.teamId === teamId && entry.userId === userId && !entry.revoked); }
  list(teamId: string): Omit<Device, "publicKey">[] { return this.state.devices.filter((entry) => entry.teamId === teamId).map(({ publicKey: _publicKey, ...metadata }) => metadata); }

  rememberReceipt(receipt: MessageReceipt): void {
    if (!validReceipt(receipt)) throw new Error("Invalid receipt metadata");
    if (!this.receipts.has(receipt.channel + ":" + receipt.ts) && this.retainHandoff(receipt) && !this.canRememberHandoff()) throw new Error("Handoff receipt capacity reached");
    this.indexReceipt(receipt);
    this.save(false);
  }

  private threadKey(receipt: MessageReceipt): string { return `${receipt.deviceId}:${receipt.userId}:${receipt.channel}:${receipt.threadTs ?? receipt.ts}`; }

  private indexReceipt(receipt: MessageReceipt): void {
    const key = `${receipt.channel}:${receipt.ts}`;
    const previous = this.receipts.get(key);
    if (previous) {
      this.unindexReceipt(previous);
      if (receipt.deviceId === previous.deviceId && receipt.userId === previous.userId) receipt = { ...previous, ...receipt, threadTs: receipt.threadTs ?? previous.threadTs };
    }
    this.receipts.delete(key);
    this.receipts.set(key, receipt);
    this.threads.set(this.threadKey(receipt), receipt);
    this.threadOwners.set(`${receipt.channel}:${receipt.threadTs ?? receipt.ts}`, receipt);
    if (receipt.handoffId) this.handoffs.set(receipt.handoffId, receipt);
    if (receipt.askId) this.asks.set(receipt.askId, receipt);
    if (this.receipts.size > 20_000) {
      const oldest = [...this.receipts.values()].find((entry) => !this.retainHandoff(entry));
      if (!oldest) throw new Error("Handoff receipt capacity reached");
      this.receipts.delete(oldest.channel + ":" + oldest.ts);
      this.unindexReceipt(oldest);
    }
  }

  private retainHandoff(receipt: MessageReceipt): boolean {
    return receipt.kind === "handoff" && (receipt.status === "pending" || receipt.expiresAt! + HANDOFF_RETENTION_MS > this.now());
  }

  canRememberHandoff(reserved = 0): boolean {
    return [...this.handoffs.values()].filter((receipt) => this.retainHandoff(receipt)).length + reserved < 20_000;
  }

  private unindexReceipt(receipt: MessageReceipt): void {
    const thread = `${receipt.channel}:${receipt.threadTs ?? receipt.ts}`;
    if (this.threads.get(this.threadKey(receipt)) === receipt) this.threads.delete(this.threadKey(receipt));
    if (this.threadOwners.get(thread) === receipt) this.threadOwners.delete(thread);
    if (receipt.handoffId && this.handoffs.get(receipt.handoffId) === receipt) this.handoffs.delete(receipt.handoffId);
    if (receipt.askId && this.asks.get(receipt.askId) === receipt) this.asks.delete(receipt.askId);
  }

  receipt(channel: string, ts: string): MessageReceipt | undefined { return this.receipts.get(`${channel}:${ts}`); }
  botThread(deviceId: string, userId: string, channel: string, threadTs: string): boolean { return this.threads.has(`${deviceId}:${userId}:${channel}:${threadTs}`); }
  thread(channel: string, threadTs: string): MessageReceipt | undefined { return this.receipt(channel, threadTs) ?? this.threadOwners.get(`${channel}:${threadTs}`); }
  ask(askId: string): MessageReceipt | undefined { return this.asks.get(askId); }
  groupAsk(channel: string): MessageReceipt | undefined {
    return [...this.asks.values()].reverse().find((receipt) => receipt.channel === channel && receipt.groupDm === true && receipt.expiresAt! > this.now());
  }
  handoff(handoffId: string): MessageReceipt | undefined { return this.handoffs.get(handoffId); }
  pendingHandoffs(): MessageReceipt[] { return [...this.handoffs.values()].filter((receipt) => receipt.status === "pending"); }

  link(code: string, binding: Omit<GatewayBinding, "deviceId">): { device: Device; replaced?: Device } | undefined {
    const pending = this.state.pending.find((entry) => entry.code === code.toUpperCase());
    if (!pending || pending.expiresAt <= this.now() || pending.attempts >= 5) return;
    pending.attempts++;
    const replaced = this.member(binding.teamId, binding.userId);
    if (replaced) { replaced.revoked = true; replaced.revokedAt = this.now(); }
    const device = { ...binding, deviceId: pending.deviceId, publicKey: pending.publicKey, label: pending.label, linkedAt: this.now(), lastSeen: this.now(), revoked: false };
    this.state.devices.push(device);
    this.state.pending = this.state.pending.filter((entry) => entry !== pending);
    this.save();
    return { device, replaced };
  }

  failedAttempt(deviceId: string): void {
    const pending = this.state.pending.find((entry) => entry.deviceId === deviceId);
    if (pending) { pending.attempts++; this.save(); }
  }

  cancel(deviceId: string): void {
    this.state.pending = this.state.pending.filter((entry) => entry.deviceId !== deviceId);
    this.save();
  }

  seen(deviceId: string): void {
    const device = this.device(deviceId);
    if (device && this.now() - device.lastSeen >= 30_000) { device.lastSeen = this.now(); this.save(false); }
  }

  revoke(teamId: string, userId: string): Device | undefined {
    const device = this.member(teamId, userId);
    if (device) { device.revoked = true; device.revokedAt = this.now(); this.save(); }
    return device;
  }
}
