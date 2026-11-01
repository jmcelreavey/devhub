import { z } from "zod";
import { withErrorHandler } from "../../../lib/api-utils";
import { formatZodError } from "../../../lib/schemas";
import { resolveEntityContext } from "../../../lib/entity-links/resolve";
import { isSafeNotePath } from "../../../../../../packages/shared/ui-lib/entity-links/build-ref";
import { entityLinksResolve } from "../../../../../../packages/shared/actions/entity-links";

const QuerySchema = entityLinksResolve.input
  .extend({
    id: z.string().min(1).max(400),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    label: z.string().max(200).optional(),
    href: z.string().max(1000).optional(),
    meetingTitle: z.string().max(200).optional(),
    prRepo: z.string().max(200).optional(),
    prNumber: z.coerce.number().int().positive().optional(),
    /** 2 also returns `expanded` — what the direct links themselves link to. */
    depth: z.coerce.number().int().min(1).max(2).optional(),
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
    return Response.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const result = await entityLinksResolve.handler(parsed.data, {
    execute: ({ kind, id }) => resolveEntityContext(kind, id, parsed.data),
  });
  return Response.json(result);
}, "entity-links.get");
