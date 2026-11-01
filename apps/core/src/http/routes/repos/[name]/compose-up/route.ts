import { localOps } from "@devhub/core/local/ops/index";
import path from "node:path";
import fs from "node:fs";
import { repoComposeUp } from "../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../lib/actions/http";
import { getReposScanDir } from "../../../../../lib/repos/index";

type Params = { params: Promise<{ name: string }> };

/**
 * The deliberately boring docker button: `docker compose up -d` in the repo
 * root, nothing fancier. Repos needing env juggling or profiles should use
 * the terminal — this is for the happy path.
 */
export async function POST(req: Request, { params }: Params) {
  const { name } = await params;
  return httpAction(repoComposeUp, {
    input: () => ({ name }),
    context: () => ({ run: async (repo) => {
      const response = await composeUp(repo);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function composeUp(name: string) {
  const scanDir = getReposScanDir();
  const repoPath = path.resolve(path.join(scanDir, name));
  if (path.dirname(repoPath) !== path.resolve(scanDir) || !fs.existsSync(repoPath)) {
    return Response.json({ error: "Unknown repo" }, { status: 404 });
  }

  return new Promise<Response>((resolve) => {
    const child = localOps.spawn("docker", ["compose", "up", "-d"], {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      child.kill();
      resolve(
        Response.json(
          { error: "docker compose up timed out after 120s", output: out.slice(-2000) },
          { status: 504 },
        ),
      );
    }, 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Response.json({ ok: true, output: out.slice(-2000) }));
      } else {
        resolve(
          Response.json(
            { error: `docker compose exited with code ${code}`, output: out.slice(-2000) },
            { status: 500 },
          ),
        );
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(Response.json({ error: err.message }, { status: 500 }));
    });
  });
}
