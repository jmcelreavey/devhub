import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth } from "@/lib/api-utils";
import { withMutex } from "@/lib/atomic-write";
import { getResourceRoot } from "@/lib/content/dirs";
import { execExternal } from "@/lib/exec-external";
import { paseoPassword, paseoWebOrigin } from "@/lib/paseo/client";
import { disablePaseoRelay, PASEO_DAEMON_LABEL, PASEO_SYSTEMD_UNIT, paseoCli, paseoRelayEnabled, readPaseoManaged, setDefaultPaseoProvider } from "@/lib/paseo/managed";
import { defaultPaseoProvider, listPaseoProviders } from "@/lib/paseo/providers";

import { checkPaseoUpdate, hasActivePaseoWork } from "@/lib/paseo/update";

export const dynamic = "force-dynamic";

const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];

/**
 * nextUrl reflects the server's bind address, not the caller. The Host header
 * carries the LAN address through the LAN proxy and can't be forged by a browser.
 */
function fromLocalBrowser(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (!host) return false;
  try { return LOOPBACK.includes(new URL(`http://${host}`).hostname); } catch { return false; }
}

async function healthy(): Promise<boolean> {
  try { return (await fetch(`${paseoWebOrigin()}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(3_000) })).ok; } catch { return false; }
}

/** Daemon status for the Connection tab. Provider errors are shown, not thrown. */
export async function GET(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const managed = readPaseoManaged();
    const running = await healthy();
    const providers = running ? await listPaseoProviders().catch(() => null) : null;
    return NextResponse.json({
      installed: Boolean(managed), running, version: managed?.version ?? null, web: paseoWebOrigin(),
      relayEnabled: managed ? paseoRelayEnabled(managed) : false,
      providers, defaultProvider: providers ? defaultPaseoProvider(providers) ?? null : null,
      authFailed: running && providers === null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read Paseo's status." }, { status: 503 });
  }
}

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup") }),
  z.object({ action: z.literal("update") }),
  z.object({ action: z.literal("check-update") }),
  z.object({ action: z.literal("restart") }),
  z.object({ action: z.literal("pair") }),
  z.object({ action: z.literal("unpair") }),
  z.object({ action: z.literal("default-provider"), provider: z.string().regex(/^[a-z][a-z0-9-]*$/).max(64) }),
]);

async function restart(): Promise<void> {
  if (process.platform === "linux") {
    await execExternal("/usr/bin/systemctl", ["--user", "restart", PASEO_SYSTEMD_UNIT], { timeoutMs: 60_000, label: "paseo:restart" });
  } else {
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("Managed Paseo needs launchd (macOS) or systemd (Linux).");
    await execExternal("/bin/launchctl", ["kickstart", "-k", `gui/${uid}/${PASEO_DAEMON_LABEL}`], { timeoutMs: 20_000, label: "paseo:restart" });
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await healthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Paseo did not become healthy after restarting.");
}

export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  // Setup runs installers and pairing returns a device secret: local dashboard only.
  if (!fromLocalBrowser(req)) return NextResponse.json({ error: "Manage Paseo from the local DevHub dashboard." }, { status: 403 });
  const parsed = await parseBody(req, inputSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  return withMutex("paseo:managed", async () => {
    try {
      if (input.action === "check-update") return NextResponse.json(await checkPaseoUpdate(true));
      if (input.action === "setup" || input.action === "update") {
        if (await healthy() && await hasActivePaseoWork()) return NextResponse.json({ error: "Finish or stop active chats before updating or reinstalling Paseo." }, { status: 409 });
        await execExternal(process.execPath, [path.join(getResourceRoot(), "scripts", "install-paseo.mjs"), ...(input.action === "update" ? ["--update"] : [])], { timeoutMs: 600_000, maxBuffer: 2_000_000, label: "paseo:setup" });
        return NextResponse.json({ ok: true });
      }
      const managed = readPaseoManaged();
      if (!managed) return NextResponse.json({ error: "Set up managed Paseo first." }, { status: 409 });
      if (input.action === "restart") { await restart(); return NextResponse.json({ ok: true }); }
      if (input.action === "default-provider") {
        const providers = await listPaseoProviders();
        if (!providers.some((p) => p.id === input.provider && p.ready)) return NextResponse.json({ error: "Choose an agent that's ready in Paseo." }, { status: 400 });
        await setDefaultPaseoProvider(input.provider);
        return NextResponse.json({ ok: true });
      }
      if (input.action === "unpair") {
        await disablePaseoRelay(managed);
        await restart();
        return NextResponse.json({ ok: true });
      }
      // Pairing enables the relay (outbound, end-to-end encrypted) and returns the pairing link.
      const { stdout } = await execExternal(process.execPath, [paseoCli(managed), "daemon", "pair", "--relay", "--json", "--home", managed.home], {
        timeoutMs: 30_000, label: "paseo:pair",
        // The CLI must authenticate to the running daemon; env keeps the password out of exec diagnostics.
        env: { ...process.env, PASEO_PASSWORD: paseoPassword() ?? "" },
      });
      const pairing = z.object({ relayEnabled: z.boolean(), url: z.string().url() }).parse(JSON.parse(stdout));
      return NextResponse.json({ url: pairing.url }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      // Setup output is diagnostics only; pairing output can hold the device secret, so it's never logged.
      if (input.action === "setup" || input.action === "update") console.error("[paseo] install failed", error instanceof Error ? error.message : error);
      const stderr = (error as { stderr?: unknown }).stderr;
      if (input.action === "update" && typeof stderr === "string" && /\b(?:ETARGET|E404)\b/.test(stderr)) {
        return NextResponse.json({ error: "This release or one of its dependencies is not available through Safe-Chain yet. Your installed Paseo is unchanged. Try again later." }, { status: 409 });
      }
      // Child output can include the pairing secret; never echo it.
      const hint = input.action === "setup" ? " Run npm run agents:install in the DevHub checkout for diagnostics." : "";
      return NextResponse.json({ error: `Could not ${input.action === "default-provider" ? "save the default agent" : input.action} Paseo.${hint}` }, { status: 503 });
    }
  });
}
