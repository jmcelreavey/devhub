/**
 * Expose localhost-only DevHub services on one non-Tailscale LAN IP.
 *
 * Next/OpenCode/OpenChamber/terminal stay bound to 127.0.0.1 so the Electron
 * app can always use localhost. This process adds LAN listeners only when
 * DEVHUB_LAN_PROXY_HOST is set, usually to `auto` from /setup.
 */
import net from "node:net";
import process from "node:process";
import { isCgnat, resolveBindHost } from "./load-env-local-into-process";
import { loadEnvWithOnePasswordFallback } from "./op-secrets";

interface PortProxy {
  label: string;
  port: number;
}

function log(message: string): void {
  process.stdout.write(`[lan] ${message}\n`);
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function parsePort(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? String(fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function startProxy({ label, port }: PortProxy, host: string): net.Server {
  const server = net.createServer((client) => {
    const upstream = net.connect({ host: "127.0.0.1", port });
    client.pipe(upstream).pipe(client);

    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });

  server.on("error", (err) => {
    log(`${label} proxy failed on ${host}:${port}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });

  server.listen(port, host, () => {
    log(`${label}: ${host}:${port} -> 127.0.0.1:${port}`);
  });

  return server;
}

async function main(): Promise<void> {
  await loadEnvWithOnePasswordFallback(process.cwd());

  const bindHost = process.env.DEVHUB_BIND_HOST?.trim().toLowerCase();
  const legacyAuto = bindHost === "auto" || bindHost === "lan";
  const raw = process.env.DEVHUB_LAN_PROXY_HOST?.trim() || (legacyAuto ? bindHost : "");
  if (!raw) {
    log("disabled (DEVHUB_LAN_PROXY_HOST not set)");
    return;
  }

  const host = resolveBindHost(raw);
  if (isLoopback(host) || host === "0.0.0.0" || isCgnat(host)) {
    throw new Error(`Refusing to expose LAN proxy on '${host}'`);
  }

  /**
   * The terminal port is deliberately absent.
   *
   * Port 1339 is an unauthenticated PTY — connecting to it gets you an
   * interactive login shell as this user. Proxying that onto a LAN address
   * hands a shell to everyone on the coffee shop Wi-Fi, and no amount of
   * "it's my own network" makes that a reasonable default. LAN mode exists so
   * you can read your dashboard from a phone; it was never worth a remote
   * shell.
   *
   * The terminal dock connects to `window.location.hostname`, so over LAN it
   * simply fails to connect rather than silently working. That is the correct
   * outcome, and `lan-port-proxy.test.ts` asserts 1339 stays out of this list.
   */
  const proxies: PortProxy[] = [
    { label: "dashboard", port: parsePort("PORT", 1337) },
    { label: "openchamber", port: parsePort("OPENCHAMBER_PORT", 1336) },
  ];

  for (const proxy of proxies) startProxy(proxy, host);
}

main().catch((err) => {
  log(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
