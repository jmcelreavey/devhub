import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { renameTag } from "@/lib/tags";

export const dynamic = "force-dynamic";

const RenameSchema = z.object({
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
});

/**
 * POST /api/tags/rename { from, to } — rewrites `#from` → `#to` across task
 * texts and note bodies. Boundary-lookahead replace; `#auth-old` survives a
 * rename of `#auth`.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = await parseBody(req, RenameSchema);
  if (!parsed.ok) return parsed.response;
  const { from, to } = parsed.data;
  try {
    const result = await renameTag(from, to);
    return NextResponse.json({ from, to, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Rename failed" },
      { status: 400 },
    );
  }
}, "tags.rename");
