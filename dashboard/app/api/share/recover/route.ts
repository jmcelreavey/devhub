import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { withErrorHandler, parseBody } from "@/lib/api-utils";
import { ShareCreateSchema } from "@/lib/schemas";
import { mapGithubCliError } from "@/lib/gh-exec";
import { getVault, parseVaultId } from "@/lib/vault/vault-registry";
import { recoverShareFromGist, ShareRecoverError } from "@/lib/share/share-recover";
import { listShareStatuses } from "@/lib/share/share-content";

export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = await parseBody(req, ShareCreateSchema);
  if (!parsed.ok) return parsed.response;
  const vault = parseVaultId(parsed.data.vault);
  const sharePath = parsed.data.path;

  try {
    const record = await recoverShareFromGist(vault, sharePath);
    for (const p of getVault(vault).revalidatePaths) {
      revalidatePath(p);
    }
    const status = listShareStatuses().find((row) => row.key === record.key);
    return NextResponse.json({ share: status ?? { ...record, stale: false, missing: false } });
  } catch (err) {
    if (err instanceof ShareRecoverError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const { status, error } = mapGithubCliError(err, "Failed to recover from gist");
    return NextResponse.json({ error }, { status });
  }
}, "share.recover");
