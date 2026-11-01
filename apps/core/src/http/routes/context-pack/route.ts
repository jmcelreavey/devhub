import { contextPack } from "../../../../../../packages/shared/actions/workspace";
import { withErrorHandler } from "../../../lib/api-utils";
import { buildContextPack, formatContextPackMarkdown } from "../../../lib/context-pack/index";
import { buildStandupQuery } from "@shared/standup/params";


async function fetchStandupMarkdown(origin: string): Promise<string | null> {
  const qs = buildStandupQuery();
  const r = await fetch(`${origin}/api/standup/markdown?${qs}`, { cache: "no-store" });
  if (!r.ok) return null;
  const data = (await r.json()) as { markdown?: string };
  return data.markdown ?? null;
}

export const GET = withErrorHandler(async (req: Request) => {
  return await contextPack.handler({ format: new URL(req.url).searchParams.get("format") ?? undefined }, { execute: async () => {
    const format = new URL(req.url).searchParams.get("format");
    const origin = new URL(req.url).origin;
    const pack = await buildContextPack(() => fetchStandupMarkdown(origin));

    if (format === "markdown") {
      return Response.json({ markdown: formatContextPackMarkdown(pack), pack });
    }
    return Response.json(pack);
  } }) as Response;
}, "context pack");
