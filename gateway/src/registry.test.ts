import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Registry, PAIR_TTL, REGISTRY_SAVE_MS, REVOKED_RETENTION_MS } from "./registry.ts";
import { Challenge, validPublicKey } from "./auth.ts";
import { TokenBucket } from "./rate-limit.ts";
import { requireSsoOff } from "./sso.ts";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const binding = { teamId: "T1", userId: "U1", userName: "one", dmChannelId: "D1" };
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("registry and pairing", () => {
  it.each(["accepted", "declined", "expired"] as const)("retains %s handoff receipts for at least seven days under receipt churn and reload", (status) => {
    let now = 100;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-retention-")); roots.push(root);
    const file = path.join(root, "registry.json");
    const registry = new Registry(file, () => now);
    const receipt = { kind: "handoff" as const, handoffId: "accepted", toUserId: "U2", toDeviceId: "two", expiresAt: now + 86400_000, status, byUserId: "U2", deviceId: "one", userId: "U1", channel: "D2", ts: "0.000" };
    registry.rememberReceipt(receipt);
    now += 7 * 86400_000;
    for (let index = 1; index <= 20_000; index++) registry.rememberReceipt({ deviceId: "one", userId: "U1", channel: "C1", ts: index + ".000" });
    registry.flush();
    expect(registry.handoff("accepted")).toEqual(receipt);
    expect(new Registry(file, () => now).handoff("accepted")).toEqual(receipt);
    expect(registry["receipts"].size).toBe(20_000);
    now += 86400_000;
    registry.rememberReceipt({ deviceId: "one", userId: "U1", channel: "C1", ts: "20001.000" });
    expect(registry.handoff("accepted")).toBeUndefined();
  });
  it("refuses new handoffs at capacity rather than evicting retained ownership receipts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-capacity-")); roots.push(root);
    const file = path.join(root, "registry.json");
    const receipts = Array.from({ length: 20_000 }, (_, index) => ({ kind: "handoff", handoffId: "handoff-" + index, toUserId: "U2", toDeviceId: "two", expiresAt: 86400_100, status: "accepted", byUserId: "U2", deviceId: "one", userId: "U1", channel: "D2", ts: index + ".000" }));
    fs.writeFileSync(file, JSON.stringify({ devices: [], pending: [], receipts }));
    const registry = new Registry(file, () => 100);
    expect(registry.canRememberHandoff()).toBe(false);
    expect(() => registry.rememberReceipt({ ...registry.handoff("handoff-0")!, handoffId: "overflow", ts: "20001.000" })).toThrow("capacity");
    expect(registry["receipts"].size).toBe(20_000);
    expect(registry.handoff("handoff-0")).toBeDefined();
    expect(registry.handoff("overflow")).toBeUndefined();
  });
  it("persists only collaboration metadata and rebuilds global thread and handoff indexes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-collaboration-")); roots.push(root);
    const file = path.join(root, "registry.json"); const registry = new Registry(file, () => 100);
    const owner = registry.register(publicKey, "Laptop"); registry.link(owner.code, binding);
    const receiver = registry.register(publicKey, "Receiver"); registry.link(receiver.code, { ...binding, userId: "U2", dmChannelId: "D2" });
    const ask = { kind: "ask" as const, askId: "ask-one", helperUserId: "U2", expiresAt: 86400_100, deviceId: owner.deviceId, userId: "U1", channel: "C1", ts: "1.000" };
    const handoff = { kind: "handoff" as const, handoffId: "handoff-one", toUserId: "U2", toDeviceId: receiver.deviceId, expiresAt: 86400_100, status: "accepted" as const, byUserId: "U2", deviceId: owner.deviceId, userId: "U1", channel: "D2", ts: "2.000" };
    registry.rememberReceipt(ask); registry.rememberReceipt(handoff);
    registry.rememberReceipt({ deviceId: owner.deviceId, userId: "U1", channel: "C1", ts: "3.000", threadTs: "1.000" });
    registry.flush();
    const reloaded = new Registry(file);
    expect(reloaded.thread("C1", "1.000")).toEqual(ask);
    expect(reloaded.ask("ask-one")).toEqual(ask);
    expect(reloaded.handoff("handoff-one")).toEqual(handoff);
    expect(reloaded.botThread(owner.deviceId, "U1", "C1", "1.000")).toBe(true);
    expect(fs.readFileSync(file, "utf8")).not.toMatch(/blocks|text|bundle|question/);
    expect(() => registry.rememberReceipt({ ...ask, text: "Never persist this" } as typeof ask)).toThrow("Invalid receipt metadata");
  });
  it.each([
    { kind: "other" }, { helperUserId: 1 }, { askId: [] }, { handoffId: {} }, { toUserId: 2 }, { toDeviceId: 2 },
    { expiresAt: null }, { expiresAt: "tomorrow" }, { expiresAt: -1 }, { expiresAt: 1.5 }, { groupDm: "true" }, { groupDm: true },
    { status: "anything" }, { status: ["pending"] }, { byUserId: "U3" }, { kind: "ask" }, { kind: "handoff", toUserId: "U1" },
    { blocks: [] }, { text: "Content is not metadata" }, { threadTs: 123 }, { channel: "evil" },
  ])("quarantines malformed optional receipt metadata: %j", (change) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-receipt-corrupt-")); roots.push(root);
    const file = path.join(root, "registry.json");
    const receipt = { kind: "handoff", handoffId: "handoff-one", toUserId: "U2", toDeviceId: "receiver", expiresAt: 86400_100, status: "pending", deviceId: "owner", userId: "U1", channel: "D2", ts: "1.000", ...change };
    fs.writeFileSync(file, JSON.stringify({ devices: [], pending: [], receipts: [receipt] }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = new Registry(file);
    expect(registry.receipt("D2", "1.000")).toBeUndefined();
    expect(fs.readdirSync(root).some((name) => name.startsWith("registry.json.corrupt-"))).toBe(true);
  });
  it("bounds all receipt indexes and drops stale collaboration IDs on replacement", () => {
    const registry = new Registry();
    registry.rememberReceipt({ kind: "ask", askId: "old-ask", helperUserId: "U2", expiresAt: 1000, deviceId: "one", userId: "U1", channel: "C1", ts: "0.000" });
    for (let index = 1; index <= 20_000; index++) registry.rememberReceipt({ deviceId: "one", userId: "U1", channel: "C1", ts: `${index}.000` });
    expect(registry.ask("old-ask")).toBeUndefined(); expect(registry.thread("C1", "0.000")).toBeUndefined();
    expect(registry["threadOwners"].size).toBe(20_000);
    registry.rememberReceipt({ kind: "handoff", handoffId: "old-handoff", toUserId: "U2", toDeviceId: "two", expiresAt: 1000, status: "pending", deviceId: "one", userId: "U1", channel: "D2", ts: "1.000" });
    registry.rememberReceipt({ deviceId: "two", userId: "U2", channel: "D2", ts: "1.000" });
    expect(registry.handoff("old-handoff")).toBeUndefined();
    expect(registry.thread("D2", "1.000")?.deviceId).toBe("two");
  });
  it("indexes receipts, batches posts and lastSeen writes, and flushes on demand", async () => {
    vi.useFakeTimers(); let now = 100;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-batched-")); roots.push(root);
    const file = path.join(root, "registry.json");
    const registry = new Registry(file, () => now);
    const pending = registry.register(publicKey, "Laptop"); registry.link(pending.code, binding);
    const rename = vi.spyOn(fs, "renameSync");
    now += 30_000;
    for (let index = 0; index < 1000; index++) {
      registry.seen(pending.deviceId);
      registry.rememberReceipt({ deviceId: pending.deviceId, userId: "U1", channel: "C1", ts: `${index}.000`, threadTs: "0.000" });
    }
    expect(rename).not.toHaveBeenCalled();
    expect(registry.receipt("C1", "999.000")?.deviceId).toBe(pending.deviceId);
    expect(registry.botThread(pending.deviceId, "U1", "C1", "0.000")).toBe(true);
    await vi.advanceTimersByTimeAsync(REGISTRY_SAVE_MS);
    expect(rename).toHaveBeenCalledOnce();
    expect(new Registry(file).member("T1", "U1")?.lastSeen).toBe(now);
    expect(new Registry(file).receipt("C1", "999.000")).toBeDefined();
    registry.rememberReceipt({ deviceId: pending.deviceId, userId: "U1", channel: "C1", ts: "1001.000" }); registry.flush();
    expect(rename).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(REGISTRY_SAVE_MS); expect(rename).toHaveBeenCalledTimes(2);
  });
  it("bounds receipts and replaces duplicate timestamps without retaining stale ownership", () => {
    const registry = new Registry();
    for (let index = 0; index < 20_001; index++) registry.rememberReceipt({ deviceId: "one", userId: "U1", channel: "C1", ts: `${index}.000` });
    expect(registry.receipt("C1", "0.000")).toBeUndefined();
    expect(registry.botThread("one", "U1", "C1", "0.000")).toBe(false);
    expect(registry.receipt("C1", "20000.000")).toBeDefined();
    registry.rememberReceipt({ deviceId: "one", userId: "U1", channel: "C1", ts: "20000.000" });
    expect(registry.receipt("C1", "20000.000")?.userId).toBe("U1");
    registry.rememberReceipt({ deviceId: "two", userId: "U2", channel: "C1", ts: "20000.000", threadTs: "123.000" });
    expect(registry.botThread("one", "U1", "C1", "20000.000")).toBe(false);
    expect(registry.botThread("two", "U2", "C1", "123.000")).toBe(true);
    registry.rememberReceipt({ deviceId: "two", userId: "U2", channel: "C1", ts: "20000.000" });
    expect(registry.botThread("two", "U2", "C1", "123.000")).toBe(true);
  });
  it("keeps at most five revoked devices per member and removes them after thirty days", () => {
    let now = 100;
    const registry = new Registry(undefined, () => now);
    for (let index = 0; index < 12; index++) { const pending = registry.register(publicKey, "Laptop"); registry.link(pending.code, binding); now++; }
    registry.flush();
    expect(registry.list("T1").filter((entry) => entry.revoked).length).toBeLessThanOrEqual(5);
    now += REVOKED_RETENTION_MS + 1;
    const next = registry.register(publicKey, "New"); registry.link(next.code, { ...binding, userId: "U2" }); registry.flush();
    expect(registry.list("T1").some((entry) => entry.revoked)).toBe(false);
  });
  it.each(["private broken JSON", JSON.stringify({ devices: [{}], pending: [] })])("quarantines corrupt registries and logs metadata only", (content) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-corrupt-")); roots.push(root);
    const file = path.join(root, "registry.json"); fs.writeFileSync(file, content);
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = new Registry(file, () => 123);
    expect(registry.list("T1")).toEqual([]);
    expect(fs.readdirSync(root).some((name) => name.startsWith("registry.json.corrupt-123"))).toBe(true);
    expect(JSON.stringify(warning.mock.calls)).toContain("REGISTRY CORRUPT");
    expect(JSON.stringify(warning.mock.calls)).not.toContain(content);
    expect(registry.register(publicKey, "Laptop")).toBeDefined();
  });
  it("persists metadata atomically with private permissions and no credentials", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-registry-")); roots.push(root);
    const file = path.join(root, "registry.json");
    const registry = new Registry(file, () => 100);
    const pairing = registry.register(publicKey, "Laptop");
    expect(pairing.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(pairing.expiresAt).toBe(100 + PAIR_TTL);
    expect(registry.link(pairing.code.toLowerCase(), binding)?.device.userId).toBe("U1");
    expect(new Registry(file).member("T1", "U1")?.publicKey).toBe(publicKey);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(root)).toEqual(["registry.json"]);
    expect(JSON.stringify(registry.list("T1"))).not.toContain(publicKey);
    registry.rememberReceipt({ deviceId: pairing.deviceId, userId: "U1", channel: "C1", ts: "1.000" });
    registry.flush();
    expect(new Registry(file).receipt("C1", "1.000")?.deviceId).toBe(pairing.deviceId);
  });
  it("expires at ten minutes and rejects a consumed pairing replay", () => {
    let now = 100;
    const registry = new Registry(undefined, () => now);
    const first = registry.register(publicKey, "Laptop");
    now += PAIR_TTL;
    expect(registry.key(first.deviceId)).toBeUndefined();
    expect(registry.link(first.code, binding)).toBeUndefined();
    const next = registry.register(publicKey, "Laptop");
    expect(registry.link(next.code, binding)).toBeDefined();
    expect(registry.link(next.code, { ...binding, userId: "U2" })).toBeUndefined();
  });
  it("exhausts pending keys after five failed attempts", () => {
    const registry = new Registry(); const pending = registry.register(publicKey, "Laptop");
    for (let attempt = 0; attempt < 5; attempt++) registry.failedAttempt(pending.deviceId);
    expect(registry.key(pending.deviceId)).toBeUndefined();
    expect(registry.link(pending.code, binding)).toBeUndefined();
  });
  it("replaces the previous device for that member without affecting another team", () => {
    const registry = new Registry();
    const first = registry.register(publicKey, "Old"); registry.link(first.code, binding);
    const other = registry.register(publicKey, "Other team"); registry.link(other.code, { ...binding, teamId: "T2" });
    const next = registry.register(publicKey, "New");
    expect(registry.link(next.code, binding)?.replaced?.deviceId).toBe(first.deviceId);
    expect(registry.key(first.deviceId)).toBeUndefined();
    expect(registry.member("T2", "U1")?.deviceId).toBe(other.deviceId);
    expect(registry.revoke("T1", "U1")?.deviceId).toBe(next.deviceId);
    expect(registry.key(next.deviceId)).toBeUndefined();
  });
  it("rejects non-Ed25519 and malformed keys", () => {
    expect(validPublicKey("invalid")).toBe(false);
    expect(validPublicKey(generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" }).toString())).toBe(false);
    expect(() => new Registry().register("bad", "Laptop")).toThrow();
  });
});

describe("single-use Ed25519 challenge", () => {
  const signature = (challenge: Challenge, timestamp: number, deviceId = "device") => sign(null, Buffer.from(`${challenge.nonce}|${deviceId}|${timestamp}`), keys.privateKey).toString("base64");
  it("accepts a valid signature once", () => {
    const challenge = new Challenge(() => 1000); const signed = signature(challenge, 1000);
    expect(challenge.verify("device", publicKey, 1000, signed)).toBe(true);
    expect(challenge.verify("device", publicKey, 1000, signed)).toBe(false);
  });
  it("consumes bad signatures and binds the device id", () => {
    const challenge = new Challenge(() => 1000);
    expect(challenge.verify("other", publicKey, 1000, signature(challenge, 1000))).toBe(false);
    expect(challenge.verify("device", publicKey, 1000, signature(challenge, 1000))).toBe(false);
  });
  it.each([-60001, 60001])("rejects timestamp skew %s", (skew) => {
    const challenge = new Challenge(() => 100000);
    expect(challenge.verify("device", publicKey, 100000 + skew, signature(challenge, 100000 + skew))).toBe(false);
  });
  it("rejects old challenges even with a fresh timestamp", () => {
    let now = 1000; const challenge = new Challenge(() => now); now += 60001;
    expect(challenge.verify("device", publicKey, now, signature(challenge, now))).toBe(false);
  });
});

it("paces each user independently and refills the bucket", () => {
  let now = 0; const limit = new TokenBucket(2, 60000, () => now);
  expect(limit.take("one")).toBe(true); expect(limit.take("one")).toBe(true); expect(limit.take("one")).toBe(false);
  expect(limit.take("two")).toBe(true); now = 30000; expect(limit.take("one")).toBe(true); expect(limit.take("one")).toBe(false);
});

it("fails closed if the unimplemented SSO hook is enabled", () => {
  expect(() => requireSsoOff("off")).not.toThrow(); expect(() => requireSsoOff("on")).toThrow("not implemented");
});
