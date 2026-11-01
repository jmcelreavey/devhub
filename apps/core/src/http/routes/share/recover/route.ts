import { shareRecover } from "../../../../../../../packages/shared/actions/share";
import { emitCoreEvent } from "@devhub/core/events/core-events";
import { withErrorHandler, parseBody } from "../../../../lib/api-utils";
import { ShareCreateSchema } from "../../../../lib/schemas";
import { mapGithubCliError } from "../../../../lib/gh-exec";
import { parseVaultId } from "../../../../lib/vault/vault-registry";
import { recoverShareFromGist, ShareRecoverError } from "../../../../lib/share/share-recover";
import { listShareStatuses } from "../../../../lib/share/share-content";

export const POST = withErrorHandler(async (req: Request) => {
  const parsed = await parseBody(req, ShareCreateSchema);
  if (!parsed.ok) return parsed.response;
  return await shareRecover.handler({ ...parsed.data, vault: parseVaultId(parsed.data.vault) }, { execute: async () => {
  const vault = parseVaultId(parsed.data.vault);
  const sharePath = parsed.data.path;

  try {
    const record = await recoverShareFromGist(vault, sharePath);
    emitCoreEvent(vault === "docs" ? "recall" : "notes");
    const status = listShareStatuses().find((row) => row.key === record.key);
    return Response.json({ share: status ?? { ...record, stale: false, missing: false } });
  } catch (err) {
    if (err instanceof ShareRecoverError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    const { status, error } = mapGithubCliError(err, "Failed to recover from gist");
    return Response.json({ error }, { status });
  }
  } }) as Response;
}, "share.recover");
