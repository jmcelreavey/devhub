import { capabilityDigestGenerate } from "../../../../../../../packages/shared/actions/capability";
import { capabilityDigestRead } from "../../../../../../../packages/shared/actions/capability";
import { listDigests, readLatestDigest, runDigest } from "../../../../lib/capability/digest";


export async function GET() {
  return await capabilityDigestRead.handler({}, { execute: async () => {
    return Response.json({ latest: readLatestDigest(), digests: listDigests() });
  } }) as Response;
}

export async function POST(req: Request) {
  let body: { includeGithub?: boolean; githubFilter?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // empty body is fine — defaults to a local-only digest
  }

  return await capabilityDigestGenerate.handler({ includeGithub: body?.includeGithub === true, githubFilter: body?.githubFilter }, { execute: async () => {
    try {
      const digest = await runDigest({
        includeGithub: body.includeGithub === true,
        githubFilter: body.githubFilter?.trim() || undefined,
      });
      return Response.json(digest);
    } catch (err) {
      console.error("[api:capability:digest]", err);
      return Response.json({ error: String(err).slice(0, 200) }, { status: 500 });
    }
  } }) as Response;
}
