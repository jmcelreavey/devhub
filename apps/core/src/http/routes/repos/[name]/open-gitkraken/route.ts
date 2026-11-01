import { localOps } from "@devhub/core/local/ops/index";
import path from "node:path";
import fs from "node:fs";
import { repoOpenGitkraken } from "../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../lib/actions/http";
import { getReposScanDir } from "../../../../../lib/repos/index";

type Params = { params: Promise<{ name: string }> };

/** Open a local repo in GitKraken via the gitkraken:// URL scheme (macOS)
 *  or the `-p` CLI flag (Linux). The URL scheme routes through the OS handler
 *  so it works whether GitKraken is already running or not. */
export async function POST(req: Request, { params }: Params) {
  const { name } = await params;
  return httpAction(repoOpenGitkraken, {
    input: () => ({ name }),
    context: () => ({ open: async (repo) => {
      const response = await openGitkraken(repo);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function openGitkraken(name: string) {
  const scanDir = getReposScanDir();
  const repoPath = path.resolve(path.join(scanDir, name));
  if (path.dirname(repoPath) !== path.resolve(scanDir) || !fs.existsSync(repoPath)) {
    return Response.json({ error: "Unknown repo" }, { status: 404 });
  }
  try {
    if (process.platform === "darwin") {
      const uri = `gitkraken://repo${encodeURI(repoPath)}`;
      localOps.spawn("open", [uri], { detached: true, stdio: "ignore" }).unref();
    } else {
      localOps.spawn("gitkraken", ["-p", repoPath], { detached: true, stdio: "ignore" }).unref();
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
