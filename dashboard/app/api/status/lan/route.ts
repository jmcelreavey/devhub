import os from "node:os";
import { NextResponse } from "next/server";

/** Prefer typical client-facing interfaces (best-effort; order varies by OS). */
function scoreInterfaceName(name: string): number {
  const lower = name.toLowerCase();
  if (lower === "en0") return 0;
  if (lower.startsWith("en")) return 1;
  if (lower.startsWith("eth")) return 2;
  if (lower.startsWith("wlan") || lower.startsWith("wl")) return 3;
  return 10;
}

function getLanIPv4Addresses(): string[] {
  const nets = os.networkInterfaces();
  const pairs: { iface: string; address: string }[] = [];
  if (!nets) return [];

  for (const [iface, infos] of Object.entries(nets)) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      pairs.push({ iface, address: info.address });
    }
  }

  pairs.sort((a, b) => {
    const byIface = scoreInterfaceName(a.iface) - scoreInterfaceName(b.iface);
    if (byIface !== 0) return byIface;
    return a.iface.localeCompare(b.iface);
  });

  const seen = new Set<string>();
  const out: string[] = [];
  for (const { address } of pairs) {
    if (seen.has(address)) continue;
    seen.add(address);
    out.push(address);
  }
  return out;
}

export async function GET() {
  return NextResponse.json({ addresses: getLanIPv4Addresses() });
}
