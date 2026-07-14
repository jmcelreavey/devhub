import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { getRepoRoot } from "@/lib/content-dirs";
import { detectMaterializeDrift } from "@/lib/plugins/materialize-honesty";

export const GET = withErrorHandler(async () => {
  const report = detectMaterializeDrift(getRepoRoot());
  return NextResponse.json(report);
}, "status/materialized");
