import { repoNotes } from "../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../lib/actions/http";
import { withErrorHandler } from "../../../../../lib/api-utils";
import { loadIndex } from "../../../../../lib/recall/store";
import { resolveScannedRepo } from "../../../../../lib/repos/scanned-repo";


export const GET = withErrorHandler(
  async (req: Request, { params }: { params: Promise<{ name: string }> }) => {
    const { name } = await params;
    return httpAction(repoNotes, {
      input: () => ({ name }),
      context: () => ({ read: readNotes }),
      response: (result) => Response.json(result.body, { status: result.status }),
    })(req);
  },
  "repos.notes",
);

async function readNotes(name: string) {
  if (!resolveScannedRepo(name)) {
    return { status: 404, body: { error: "Repo not found" } };
  }

  const index = loadIndex();
  if (!index) return { status: 200, body: { notes: [] } };

  const key = `repo:${name}`;
  const notes = new Map<string, { slug: string; href: string; title: string }>();
  for (const chunk of index.chunks) {
    if (!chunk.refs.includes(key)) continue;
    if (chunk.sourceKind !== "note" && chunk.sourceKind !== "learning") continue;
    if (notes.has(chunk.sourceId)) continue;
    notes.set(chunk.sourceId, {
      slug: chunk.sourceId,
      href: chunk.href ?? `/notes/${chunk.sourceId}`,
      title: chunk.title.split(" — ")[0],
    });
  }

  return { status: 200, body: { notes: [...notes.values()] } };
}
