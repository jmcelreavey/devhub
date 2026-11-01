import fs from "node:fs";
import { desktopSelftestRoundtrip } from "../../../../../../../packages/shared/actions/desktop";
import path from "node:path";
import { isAuthenticatedDesktopRequest, isDesktopSession } from "@devhub/core/local/terminal/bootstrap-auth";
import { getAppDataDir } from "../../../../lib/desktop/runtime-paths";

/**
 * Storage round-trip for the packaged `--self-test`.
 *
 * The self-test needs to prove the app can actually write and read user data in
 * the bundle it just built — a server that boots but cannot persist a note is a
 * server that passes every other check and is useless.
 *
 * Two constraints make this safe to ship:
 *
 * - It requires the desktop token, so it does not exist in browser mode and
 *   cannot be reached by a page in a normal browser.
 * - It writes one file, under `<app-data>/.selftest/`, and deletes it. During a
 *   real self-test that app-data directory is a temporary one, so this never
 *   touches anything the user owns.
 */


export async function GET(req: Request) {
  if (!isDesktopSession() || !isAuthenticatedDesktopRequest(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return await desktopSelftestRoundtrip.handler({}, { execute: roundtrip }) as Response;
}

function roundtrip() {
  const dir = path.join(getAppDataDir(), ".selftest");
  const file = path.join(dir, `roundtrip-${process.pid}.json`);
  const payload = { writtenAt: new Date().toISOString(), pid: process.pid };

  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(payload), "utf-8");
    const readBack = JSON.parse(fs.readFileSync(file, "utf-8")) as typeof payload;
    const ok = readBack.writtenAt === payload.writtenAt && readBack.pid === payload.pid;
    return Response.json({ ok, dir, verified: ok });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    // Leaving debris behind would make a second self-test run against a dirty
    // tree, which is the difference between "passes twice" and "passes twice
    // for the same reason".
    try {
      fs.rmSync(file, { force: true });
      fs.rmdirSync(dir);
    } catch {
      /* best effort */
    }
  }
}
