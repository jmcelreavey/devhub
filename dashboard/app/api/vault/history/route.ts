import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { listVaultFileHistory } from "@/lib/vault/file-history";
import { parseVaultId } from "@/lib/vault/vault-registry";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const vault = parseVaultId(req.nextUrl.searchParams.get("vault"));
  const filePath = (req.nextUrl.searchParams.get("path") ?? "").trim();
  if (!filePath) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "30");
  const history = await listVaultFileHistory(vault, filePath, limitRaw);
  return NextResponse.json(history);
}, "vault.history");
