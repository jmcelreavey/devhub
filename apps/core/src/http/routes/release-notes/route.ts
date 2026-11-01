import { readFile } from "node:fs/promises";
import path from "node:path";
import { httpAction } from "../../../lib/actions/http";
import { getResourceRoot } from "../../../lib/content/dirs";
import { releaseNotesHistory } from "../../../../../../packages/shared/actions/release-notes";
import desktopConfig from "../../../../../desktop/src-tauri/tauri.conf.json";
import { normaliseReleaseVersion, parseChangelog } from "../../../../../../packages/shared/release-notes/index.mjs";


export async function GET(request: Request): Promise<Response> {
  const requested = new URL(request.url).searchParams.get("version");
  const version = requested === null ? null : normaliseReleaseVersion(requested);
  if (requested !== null && !version) return Response.json({ error: "Invalid release version." }, { status: 400 });
  try {
    const changelog = await readFile(path.join(getResourceRoot(), "CHANGELOG.md"), "utf8");
    return await httpAction(releaseNotesHistory, {
      input: () => ({ version: version ?? undefined }),
      context: () => ({ read: () => parseChangelog(changelog) }),
      response: (releases) => Response.json({
      currentVersion: normaliseReleaseVersion(process.env.DEVHUB_VERSION) ?? desktopConfig.version,
      releases,
    }, { headers: { "Cache-Control": "no-store" } }),
    })(request);
  } catch (error) {
    console.error("Release notes:", error);
    return Response.json({ error: "Release notes could not be loaded." }, { status: 500 });
  }
}
