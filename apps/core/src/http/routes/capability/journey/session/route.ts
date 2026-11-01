import { capabilityLabSessionSave } from "../../../../../../../../packages/shared/actions/capability";
import { capabilityLabSessionRead } from "../../../../../../../../packages/shared/actions/capability";
import { clearLabSession, readLabSession, writeLabSession } from "../../../../../lib/capability/journey";


export async function GET(req: Request) {
  const category = new URL(req.url).searchParams.get("category")?.trim();
  if (!category) return Response.json({ error: "category required" }, { status: 400 });

  return await capabilityLabSessionRead.handler({ category }, { execute: async () => {
    const session = readLabSession(category);
    return Response.json({ messages: session?.messages ?? [], updatedAt: session?.updatedAt ?? null });
  } }) as Response;
}

export async function POST(req: Request) {
  let body: { category?: string; messages?: unknown[]; clear?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const category = body.category?.trim();
  if (!category) return Response.json({ error: "category required" }, { status: 400 });


  return await capabilityLabSessionSave.handler({ category, messages: Array.isArray(body.messages) ? body.messages : [], clear: Boolean(body.clear) }, { execute: async () => {
    try {
      if (body.clear) {
        clearLabSession(category);
        return Response.json({ ok: true, cleared: true });
      }
      await writeLabSession(category, Array.isArray(body.messages) ? body.messages : []);
      return Response.json({ ok: true });
    } catch (err) {
      console.error("[api:capability:journey:session]", err);
      return Response.json({ error: String(err).slice(0, 200) }, { status: 500 });
    }
  } }) as Response;
}
