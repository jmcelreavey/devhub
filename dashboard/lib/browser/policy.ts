import { lookup } from "node:dns/promises";
import net from "node:net";
import { z } from "zod";

export const StartBrowserSchema = z.object({
  taskId: z.string().min(1).max(200), runId: z.string().min(1).max(200),
  origins: z.array(z.string().max(500)).min(1).max(12),
  persistent: z.boolean().default(false), consent: z.literal(true),
}).strict();

export function publicAddress(address: string): boolean {
  if (net.isIP(address) === 6) {
    // Fail closed on mapped IPv4, transition, local, documentation and multicast ranges.
    return /^2[0-9a-f]{3}:/i.test(address) && !/^200[12]:|^2001:db8:/i.test(address);
  }
  if (net.isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0 || b === 2)) || (a === 198 && [18, 19, 51].includes(b))
    || (a === 203 && b === 0));
}
export function siteOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a full HTTPS site address."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash
    || !url.hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)
    || net.isIP(url.hostname.replace(/^\[|\]$/g, ""))) throw new Error("Approve an HTTPS site origin with no path, credentials or custom port.");
  return url.origin;
}
export async function validatePublicSite(origin: string): Promise<string[]> {
  const hostname = new URL(siteOrigin(origin)).hostname;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([lookup(hostname, { all: true }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Site lookup timed out.")), 2000); })]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error("Private and local network sites are unavailable to this browser.");
  return addresses.map(({ address }) => address);
}
export function approvedUrl(value: string, origins: readonly string[]): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && origins.includes(url.origin);
  } catch { return false; }
}
