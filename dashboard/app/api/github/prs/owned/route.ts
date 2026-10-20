import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { loadOwnedPrs } from "@/lib/github/owned-prs-load";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler<[request?: Request]>(async () => NextResponse.json(await loadOwnedPrs()), "github.prs.owned");
