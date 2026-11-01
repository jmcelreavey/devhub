import { capabilityCompleteLab } from "../../../../../../../../packages/shared/actions/capability";
import { markLabComplete } from "../../../../../lib/capability/journey";


export async function POST(req: Request) {
  let body: { category?: string; done?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const category = body.category?.trim();
  if (!category) return Response.json({ error: "category required" }, { status: 400 });

  return await capabilityCompleteLab.handler({ category, done: body.done !== false }, { execute: async () => {
    try {
      const record = await markLabComplete(category, body.done !== false);
      if (!record) return Response.json({ error: "Lab not found" }, { status: 404 });
      return Response.json({ category: record.category, done: record.done, completedAt: record.completedAt });
    } catch (err) {
      console.error("[api:capability:journey:complete]", err);
      return Response.json({ error: String(err).slice(0, 200) }, { status: 500 });
    }
  } }) as Response;
}
