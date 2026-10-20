import { createPublicKey, randomBytes, verify } from "node:crypto";

export function validPublicKey(publicKey: string): boolean {
  try { return publicKey.length <= 1000 && createPublicKey(publicKey).asymmetricKeyType === "ed25519"; }
  catch { return false; }
}

export class Challenge {
  readonly nonce = randomBytes(32).toString("hex");
  private used = false;
  private readonly issuedAt: number;
  private readonly now: () => number;

  constructor(now = Date.now) { this.now = now; this.issuedAt = now(); }

  verify(deviceId: string, publicKey: string, timestamp: number, signature: string): boolean {
    if (this.used) return false;
    this.used = true;
    if (!Number.isSafeInteger(timestamp) || Math.abs(this.now() - timestamp) > 60_000 || this.now() - this.issuedAt > 60_000) return false;
    try { return verify(null, Buffer.from(`${this.nonce}|${deviceId}|${timestamp}`), publicKey, Buffer.from(signature, "base64")); }
    catch { return false; }
  }
}
