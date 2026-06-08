import { NextResponse } from "next/server";
import {
  createMasterList,
  getMasterForNotePath,
  listMasterLists,
} from "@/lib/checklists/storage";
import { normalizeScopePath } from "@/lib/checklists/paths";
import { MasterListCreateSchema, formatZodError } from "@/lib/schemas";
import { withErrorHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (req: Request) => {
  const notePath = new URL(req.url).searchParams.get("notePath")?.trim();
  const masters = listMasterLists();
  if (!notePath) return NextResponse.json(masters);

  const master = getMasterForNotePath(notePath, masters);
  return NextResponse.json(master ? [master] : []);
}, "collections.get");

export const POST = withErrorHandler(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const parsed = MasterListCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  try {
    const master = await createMasterList({
      name: parsed.data.name,
      scopePath: normalizeScopePath(parsed.data.scopePath),
      icon: parsed.data.icon,
    });
    return NextResponse.json(master, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create master list";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}, "collections.post");
