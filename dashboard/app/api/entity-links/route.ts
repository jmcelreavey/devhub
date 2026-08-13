import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandler } from "@/lib/api-utils";
import { formatZodError } from "@/lib/schemas";
import { resolveEntityLinks } from "@/lib/entity-links/resolve";
import { isSafeNotePath } from "@/lib/entity-links/build-ref";

const QuerySchema = z
  .object({
    kind: z.enum(["task", "meeting", "pr", "note", "diagram", "calendar", "jira", "repo"]),
    id: z.string().min(1).max(400),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    label: z.string().max(200).optional(),
    href: z.string().max(1000).optional(),
    meetingTitle: z.string().max(200).optional(),
    prRepo: z.string().max(200).optional(),
    prNumber: z.coerce.number().int().positive().optional(),
  })
  // Note / diagram ids are vault paths that become filenames server-side.
  .refine((q) => (q.kind !== "note" && q.kind !== "diagram") || isSafeNotePath(q.id), {
    path: ["id"],
    message: "id must be a vault-relative path",
  });

export const GET = withErrorHandler(async (req: Request) => {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const result = resolveEntityLinks(parsed.data.kind, parsed.data.id, parsed.data);
  return NextResponse.json(result);
}, "entity-links.get");
