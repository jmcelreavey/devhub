import path from "node:path";
import { z } from "zod";
import { parseBody, requireDashboardAuth } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { paseoManagedActions, paseoManagedInput, paseoManagedStatus } from "../../../../../../../packages/shared/actions/paseo";
import { withMutex } from "../../../../lib/atomic-write";
import { getResourceRoot } from "../../../../lib/content/dirs";
import { execExternal } from "../../../../lib/exec-external";
import { emitCoreEvent } from "@devhub/core/events/core-events";
import { paseoPassword, paseoWebOrigin } from "../../../../lib/paseo/client";
import { disablePaseoRelay, PASEO_DAEMON_LABEL, PASEO_SYSTEMD_UNIT, paseoCli, paseoRelayEnabled, readPaseoManaged, setDefaultPaseoProvider } from "../../../../lib/paseo/managed";
import { defaultPaseoProvider, listPaseoProviders } from "../../../../lib/paseo/providers";

import { checkPaseoUpdate, hasActivePaseoWork } from "../../../../lib/paseo/update";
import { clearPaseoRestartPending, paseoHealthy as healthy, paseoRestartPending } from "../../../../lib/paseo/pending-restart";
import { missingPaseoUnitBinary } from "../../../../lib/paseo/unit-health";
import { describeAgentSetup } from "../../../../lib/paseo/agent-setup";
import { paseoUserMessage } from "../../../../lib/paseo/user-message";
import { withPaseo } from "../../../../lib/paseo/client";
import { repairOpenCodeDevhubMcp } from "../../../../lib/sync/mcp";


const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];

/**
 * nextUrl reflects the server's bind address, not the caller. The Host header
 * carries the LAN address through the LAN proxy and can't be forged by a browser.
 */
function fromLocalBrowser(req: Request): boolean {
  const host = req.headers.get("host");
  if (!host) return false;
  try { return LOOPBACK.includes(new URL(`http://${host}`).hostname); } catch { return false; }
}

/** Daemon status for the Connection tab. Provider errors are shown, not thrown. */
export async function GET(req: Request) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return httpAction(paseoManagedStatus, {
    input: () => ({}),
    context: () => ({ execute: managedStatus }),
    response: (response) => response as Response,
  })(req);
}

async function managedStatus() {
  try {
    const managed = readPaseoManaged();
    const running = await healthy();
    const providers = running ? await listPaseoProviders().catch(() => null) : null;
    const setup = running ? null : await describeAgentSetup(false);
    return Response.json({
      installed: Boolean(managed), running, version: managed?.version ?? null, web: paseoWebOrigin(),
      setupMessage: setup?.message ?? null,
      setupDetail: setup?.detail ?? null,
      setupHref: setup?.setupHref ?? null,
      setupBlocked: setup ? setup.blocker !== null && setup.blocker !== "paseo" : false,
      relayEnabled: managed ? paseoRelayEnabled(managed) : false,
      providers, defaultProvider: providers ? defaultPaseoProvider(providers) ?? null : null,
      authFailed: running && providers === null,
      unitBinaryMissing: managed ? missingPaseoUnitBinary() : null,
      restartPending: running && Boolean(managed) && paseoRestartPending(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read Paseo's status." }, { status: 503 });
  }
}

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
    if (await healthy()) { clearPaseoRestartPending(); return; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Paseo did not become healthy after restarting.");
}

export async function POST(req: Request) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  // Setup runs installers and pairing returns a device secret: local dashboard only.
  if (!fromLocalBrowser(req)) return Response.json({ error: "Manage Paseo from the local DevHub dashboard." }, { status: 403 });
  const parsed = await parseBody(req, paseoManagedInput);
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  return httpAction(paseoManagedActions[input.action], {
    input: () => input,
    context: () => ({ execute: () => withMutex("paseo:managed", async () => {
    let mayHaveChanged = false;
    try {
      if (input.action === "repair-opencode-mcp") {
        mayHaveChanged = true;
        repairOpenCodeDevhubMcp();
        // Paseo keeps the provider snapshot from its last probe; ask it to look again.
        const refreshed = await healthy() && await withPaseo(({ api }) => api.providers.refresh()).then(() => true, () => false);
        return Response.json({ ok: true, restartRequired: !refreshed && Boolean(readPaseoManaged()) });
      }
      if (input.action === "check-update") { mayHaveChanged = true; return Response.json(await checkPaseoUpdate(true)); }
      if (input.action === "setup" || input.action === "update") {
        if (input.action === "update") {
          const update = await checkPaseoUpdate();
          if (!update.canUpdate || update.installable !== input.version) return Response.json({ error: "The update is no longer available. Check for updates again." }, { status: 409 });
        }
        if (await healthy() && await hasActivePaseoWork()) return Response.json({ error: "Finish or stop active chats before updating or reinstalling Paseo." }, { status: 409 });
        mayHaveChanged = true;
        await execExternal(process.execPath, [path.join(getResourceRoot(), "scripts", "install-paseo.mjs"), ...(input.action === "update" ? ["--update", input.version] : [])], { timeoutMs: 600_000, maxBuffer: 2_000_000, label: "paseo:setup" });
        return Response.json({ ok: true });
      }
      const managed = readPaseoManaged();
      if (!managed) return Response.json({ error: "Set up managed Paseo first." }, { status: 409 });
      if ((input.action === "restart" || input.action === "unpair") && await healthy() && await hasActivePaseoWork()) {
        return Response.json({ error: "Finish or stop active chats before restarting Paseo." }, { status: 409 });
      }
      if (input.action === "restart") { mayHaveChanged = true; await restart(); return Response.json({ ok: true }); }
      if (input.action === "default-provider") {
        const providers = await listPaseoProviders();
        if (!providers.some((p) => p.id === input.provider && p.ready)) return Response.json({ error: "Choose an agent that's ready in Paseo." }, { status: 400 });
        mayHaveChanged = true;
        await setDefaultPaseoProvider(input.provider);
        return Response.json({ ok: true });
      }
      if (input.action === "unpair") {
        mayHaveChanged = true;
        await disablePaseoRelay(managed);
        await restart();
        return Response.json({ ok: true });
      }
      // Pairing enables the relay (outbound, end-to-end encrypted) and returns the pairing link.
      mayHaveChanged = true;
      const { stdout } = await execExternal(process.execPath, [paseoCli(managed), "daemon", "pair", "--relay", "--json", "--home", managed.home], {
        timeoutMs: 30_000, label: "paseo:pair",
        // The CLI must authenticate to the running daemon; env keeps the password out of exec diagnostics.
        env: { ...process.env, PASEO_PASSWORD: paseoPassword() ?? "" },
      });
      const pairing = z.object({ relayEnabled: z.boolean(), url: z.string().url() }).parse(JSON.parse(stdout));
      return Response.json({ url: pairing.url }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (input.action === "repair-opencode-mcp") return Response.json({ error: "Could not repair DevHub's MCP entry. Check ~/.config/opencode/opencode.json: command must be a non-empty string array, environment values must be strings, and enabled must be true or false." }, { status: 400 });
      // Setup output is diagnostics only; pairing output can hold the device secret, so it's never logged.
      if (input.action === "setup" || input.action === "update") console.error("[paseo] install failed", error instanceof Error ? error.message : error);
      // Only messages written for the user are echoed; setup output is diagnostics.
      const userMessage = paseoUserMessage(error);
      if (userMessage) return Response.json({ error: userMessage }, { status: 409 });
      // Child output can include the pairing secret; never echo it.
      const hint = input.action === "setup" ? " Check npm in Setup → Tools, then retry from Agents → Connection. Setup diagnostics are in the server log." : "";
      return Response.json({ error: `Could not ${input.action === "default-provider" ? "save the default agent" : input.action} Paseo.${hint}` }, { status: 503 });
    } finally {
      // An action can change state before failing, such as unpairing before a restart fails.
      if (mayHaveChanged) emitCoreEvent("paseo");
    }
    }) }),
    response: (response) => response as Response,
  })(req);
}
