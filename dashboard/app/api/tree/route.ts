import { NextResponse } from "next/server";
import { getVaultTree } from "@/lib/vault/create-vault-routes";

export const dynamic = "force-dynamic";

export const GET = async () => {
  try {
    return NextResponse.json(await getVaultTree("notes"));
  } catch (err) {
    console.error("[api:tree]", err);
    return NextResponse.json([]);
  }
};
