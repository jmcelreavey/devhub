import { opencodeGet, opencodePut } from "../../../../../../packages/shared/actions/agent-cli";
import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "../../../lib/notes/dir";
import { withErrorHandler } from "../../../lib/api-utils";
import {
  listOpencodeSecretEnvNames,
  sharedOpencodeConfigPath,
} from "../../../lib/sync/opencode-config";
import { findRawSecretPath } from "../../../lib/opencode/secrets";


export const GET = withErrorHandler(async () => {
  return await opencodeGet.handler(opencodeGet.input.parse({}), { execute: readOpencode }) as Response;
}, "opencode");

function readOpencode() {
  const repoRoot = getRepoRoot();
  const file = sharedOpencodeConfigPath(repoRoot);
  const exists = fs.existsSync(file);
  const content = exists ? fs.readFileSync(file, "utf-8") : "";
  const envNames = listOpencodeSecretEnvNames(repoRoot);
  const unresolved = envNames.filter((n) => !(process.env[n] ?? "").trim());
  return Response.json({ exists, content, envNames, unresolved });
}

export const PUT = withErrorHandler(async (req: Request) => {
  const input = opencodePut.input.parse({ body: await req.json() });
  return await opencodePut.handler(input, { execute: ({ body }) => writeOpencode(body) }) as Response;
}, "opencode");

function writeOpencode(rawBody: unknown) {
  const body = rawBody as { content?: string };
  const content = body.content;
  if (typeof content !== "string" || !content.trim()) {
    return Response.json({ error: "Content required" }, { status: 400 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return Response.json(
      { error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return Response.json({ error: "OpenCode config must be a JSON object." }, { status: 400 });
  }
  const rawPath = findRawSecretPath(parsed);
  if (rawPath) {
    return Response.json(
      { error: `Refusing to save a raw secret at "${rawPath}". Use an {env:VAR} placeholder instead.` },
      { status: 400 },
    );
  }
  const file = sharedOpencodeConfigPath(getRepoRoot());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.endsWith("\n") ? content : content + "\n", "utf-8");
  return Response.json({ ok: true });
}
