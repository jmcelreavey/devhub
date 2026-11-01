import { capabilityScan } from "../../../../../../../packages/shared/actions/capability";
import { z } from "zod";
import { runScan } from "../../../../lib/capability/scan";


const ScanSchema = capabilityScan.input.extend({ githubLimit: z.number().int().positive().optional() });

export async function POST(req: Request) {
  // An absent or empty body is meaningful here: it means a local-only scan.
  // `.catch(() => ({}))` preserves that while still rejecting malformed shapes.
  const raw = await req.json().catch(() => ({}));
  const parsed = ScanSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }

  return await capabilityScan.handler(parsed.data, { execute: async () => {
    const body = parsed.data;

    try {
      const result = await runScan({
        includeGithub: body.includeGithub === true,
        githubLimit: body.githubLimit,
        githubFilter: body.githubFilter,
      });
      return Response.json(result);
    } catch (err) {
      console.error("[api:capability:scan]", err);
      return Response.json({ error: "Scan failed", detail: String(err).slice(0, 240) }, { status: 500 });
    }
  } }) as Response;
}
