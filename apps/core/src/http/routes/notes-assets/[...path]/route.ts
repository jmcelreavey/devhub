import { assertNoteAssetRelPath, contentTypeForAssetPath } from "../../../../lib/notes-assets/index";
import { getStorage } from "../../../../lib/storage-server";
import { httpAction } from "../../../../lib/actions/http";
import { noteAssetRead, type NoteAssetReader, type NoteAssetReadResult } from "../../../../../../../packages/shared/actions/note-assets";

type Params = { params: Promise<{ path: string[] }> };


const readAsset = httpAction<typeof noteAssetRead.input, NoteAssetReader, NoteAssetReadResult, [Params]>(noteAssetRead, {
  input: async (_req, { params }: Params) => ({ path: (await params).path.join("/") }),
  context: () => ({ readAsset: (path) => getStorage().readAsset(path), normalize: assertNoteAssetRelPath }),
  response: ({ path, data }) => {
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": contentTypeForAssetPath(path),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  },
});

export async function GET(request: Request, context: Params): Promise<Response> {
  const { path } = await context.params;
  try {
    assertNoteAssetRelPath(path.join("/"));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid asset path" }, { status: 400 });
  }
  return readAsset(request, context);
}
