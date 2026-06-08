import { NextResponse } from "next/server";
import { getVaultTree } from "@/lib/vault/create-vault-routes";
import { withErrorHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async () => {
  try {
    return NextResponse.json(await getVaultTree("docs"));
  } catch (err) {
    console.error("[api:docs/tree]", err);
    return NextResponse.json([]);
  }
}, "docs.tree");
