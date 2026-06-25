import fs from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Trims `process.env[key]`; returns `fallback` when missing or empty after trim. */
export function envTrimOrDefault(key: string, fallback: string): string {
  return (process.env[key] ?? "").trim() || fallback;
}

/**
 * Tailscale (and other VPNs) squat in the CGNAT range 100.64.0.0/10.
 * `os.networkInterfaces()` lists tailscale0/utun alongside physical NICs, so
 * we filter by address range to keep from binding the dashboard to the tailnet.
 */
export function isCgnat(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

const VIRTUAL_IFACE = /^(docker|br-|veth|virbr|ll\d|bridge|tap|zt|wg)/i;
// Physical NICs win the sort so Wi-Fi/Ethernet beats random virtual adapters.
const PHYSICAL_PREF = ["en0", "en1", "en2", "eth0", "enp", "wlan", "Wi-Fi"];

/**
 * Best-effort LAN IPv4: first non-loopback, non-CGNAT address on a non-virtual
 * interface. Returns null when offline (no usable address). Physical NIC names
 * are preferred so Wi-Fi wins over the bridges Docker/VMs spin up.
 */
export function detectLanIp(): string | null {
  const ifaces = networkInterfaces();
  const candidates: { iface: string; ip: string }[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs || VIRTUAL_IFACE.test(name)) continue;
    for (const a of addrs) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (isCgnat(a.address)) continue; // ponytail: skip Tailscale/VPN CGNAT
      candidates.push({ iface: name, ip: a.address });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((x, y) => {
    const rank = (iface: string): number => {
      const i = PHYSICAL_PREF.findIndex((p) => iface.startsWith(p));
      return i === -1 ? 99 : i;
    };
    return rank(x.iface) - rank(y.iface);
  });
  return candidates[0].ip;
}

/**
 * Resolves the magic values `auto`/`lan` to the current LAN IP, so a DHCP lease
 * change is picked up on the next cold start with no .env.local edit and no
 * restart loop. Falls back to 127.0.0.1 (with a stderr warning) when no LAN IP
 * is present, so the server still boots offline instead of crashing.
 */
export function resolveBindHost(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (v !== "auto" && v !== "lan") return raw.trim();
  const ip = detectLanIp();
  if (ip) return ip;
  process.stderr.write(
    "[bind-host] DEVHUB_BIND_HOST=auto but no LAN IPv4 found; falling back to 127.0.0.1\n",
  );
  return "127.0.0.1";
}

// ponytail: self-check — CGNAT filter is the security-critical bit, so it gets
// one runnable assertion. Run: `tsx dashboard/scripts/load-env-local-into-process.ts`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const assert = (cond: boolean, msg: string): void => {
    if (!cond) {
      process.stderr.write(`FAIL: ${msg}\n`);
      process.exit(1);
    }
  };
  assert(isCgnat("100.100.1.1"), "100.100.1.1 must be CGNAT");
  assert(isCgnat("100.127.255.255"), "100.127.255.255 must be CGNAT");
  assert(!isCgnat("100.63.255.255"), "100.63.255.255 must NOT be CGNAT");
  assert(!isCgnat("100.128.0.0"), "100.128.0.0 must NOT be CGNAT");
  assert(!isCgnat("192.168.1.50"), "192.168.1.50 must NOT be CGNAT");
  assert(!isCgnat("10.0.0.1"), "10.0.0.1 must NOT be CGNAT");
  assert(resolveBindHost("0.0.0.0") === "0.0.0.0", "passthrough 0.0.0.0");
  assert(resolveBindHost("  127.0.0.1 ") === "127.0.0.1", "passthrough trims");
  const auto = resolveBindHost("auto");
  assert(/^\d{1,3}(\.\d{1,3}){3}$/.test(auto), `auto => '${auto}', expected IPv4`);
  process.stdout.write(`OK — detectLanIp()=${detectLanIp() ?? "null"}, auto=>${auto}\n`);
}

/**
 * Loads `dashboard/.env.local` then `.env` into `process.env`, only for keys
 * that are not already set in the parent environment.
 *
 * Used by dev/start wrappers so `DEVHUB_BIND_HOST` / `OPENCHAMBER_HOST` from
 * Setup apply before `next dev` / OpenChamber spawn (npm script expansion does
 * not read `.env.local`).
 */
export function loadEnvLocalIntoProcessIfUnset(envDir: string): void {
  for (const name of [".env.local", ".env"] as const) {
    const file = path.join(envDir, name);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
