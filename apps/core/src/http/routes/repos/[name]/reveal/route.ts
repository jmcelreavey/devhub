import { repoReveal } from "../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../lib/actions/http";
import path from "node:path";
import fs from "node:fs";
import { getReposScanDir } from "../../../../../lib/repos/index";
import { revealPath, revealPathLabel } from "../../../../../lib/reveal-path";

type Params = { params: Promise<{ name: string }> };

/** Open a local repo folder in Finder / Explorer / the system file manager. */
export async function POST(req: Request, { params }: Params) {
  const { name } = await params;
  return httpAction(repoReveal, {
    input: () => ({ name }),
    context: () => ({ reveal: async () => {
      const result = revealRepo(name);
      return { status: result.status, body: await result.json() };
    } }),
    response: (result) => Response.json(result.response.body, { status: result.response.status }),
  })(req);
}

function revealRepo(name: string): Response {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.includes("..")) {
    return Response.json({ error: "Invalid repo name" }, { status: 400 });
  }
  const scanDir = getReposScanDir();
  const repoPath = path.resolve(path.join(scanDir, name));
  if (path.dirname(repoPath) !== path.resolve(scanDir) || !fs.existsSync(repoPath)) {
    return Response.json({ error: "Unknown repo" }, { status: 404 });
  }
  try {
    revealPath(repoPath);
    return Response.json({ ok: true, path: repoPath, label: revealPathLabel() });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
