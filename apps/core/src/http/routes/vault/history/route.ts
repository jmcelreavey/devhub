import { withErrorHandler } from "../../../../lib/api-utils";
import { listVaultFileHistory } from "../../../../lib/vault/file-history";
import { parseVaultId } from "../../../../lib/vault/vault-registry";
import { vaultHistory } from "../../../../../../../packages/shared/actions/vault";

export const GET = withErrorHandler(async (req: Request) => {
  const vault = parseVaultId(new URL(req.url).searchParams.get("vault"));
  const filePath = (new URL(req.url).searchParams.get("path") ?? "").trim();
  if (!filePath) {
    return Response.json({ error: "path required" }, { status: 400 });
  }

  const input = vaultHistory.input.parse({
    vault,
    path: filePath,
    limit: new URL(req.url).searchParams.get("limit") ?? "30",
  });
  const history = await vaultHistory.handler(input, { list: listVaultFileHistory });
  return Response.json(history);
}, "vault.history");
