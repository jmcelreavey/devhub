import changelog from "../../../../CHANGELOG.md?raw";
import desktopConfig from "../../../../desktop/src-tauri/tauri.conf.json";
import { normaliseReleaseVersion, parseChangelog } from "@shared/release-notes/index.mjs";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const requested = new URL(request.url).searchParams.get("version");
  const version = requested === null ? null : normaliseReleaseVersion(requested);
  if (requested !== null && !version) return Response.json({ error: "Invalid release version." }, { status: 400 });
  try {
    const releases = parseChangelog(changelog);
    return Response.json({
      currentVersion: normaliseReleaseVersion(process.env.DEVHUB_VERSION) ?? desktopConfig.version,
      releases: version ? releases.filter((release) => release.version === version) : releases,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Release notes:", error);
    return Response.json({ error: "Release notes could not be loaded." }, { status: 500 });
  }
}
