import { setupTypesafeCheck } from "../../../../../../../../packages/shared/actions/setup";
import { parseBody } from "../../../../../lib/api-utils";
import { typesafeApiKey } from "../../../../../lib/qa/credentials";
import { checkTypesafeKey } from "../../../../../../../../packages/shared/ui-lib/qa/typesafe-key";
import { TypesafeCheckSchema } from "../../../../../lib/schemas";



/** Tests the key in the form, or the saved one when the form is blank or masked. */
export async function POST(req: Request) {
  const parsed = await parseBody(req, TypesafeCheckSchema);
  if (!parsed.ok) return parsed.response;
  return await setupTypesafeCheck.handler({ body: parsed.data }, {
    execute: async ({ body }) => {
      const input = body as typeof parsed.data;
      return Response.json(await checkTypesafeKey(input.apiKey?.trim() || typesafeApiKey()));
    },
  }) as Response;
}
