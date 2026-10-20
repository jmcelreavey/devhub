import { NextResponse, type NextRequest } from "next/server";
import { parseBody } from "@/lib/api-utils";
import { typesafeApiKey } from "@/lib/qa/credentials";
import { checkTypesafeKey } from "@/lib/qa/typesafe-key";
import { TypesafeCheckSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Tests the key in the form, or the saved one when the form is blank or masked. */
export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, TypesafeCheckSchema);
  if (!parsed.ok) return parsed.response;
  return NextResponse.json(await checkTypesafeKey(parsed.data.apiKey?.trim() || typesafeApiKey()));
}
