import { notesMediaIndex, notesMediaSearch } from "../../../../../../../packages/shared/actions/notes-media";
import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { indexStoredMedia, mediaOcrSearch } from "../../../../lib/notes/media-ocr";
export const GET = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (query.length > 300) return Response.json({ error: "Search is too long." }, { status: 400 });
  const input = notesMediaSearch.input.parse({ query });
  return await notesMediaSearch.handler(input, {
    execute: async ({ query: value }) => Response.json(await mediaOcrSearch(value), { headers: { "Cache-Control": "no-store" } }),
  }) as Response;
}, "notes-media.search");
export const POST = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  return await notesMediaIndex.handler(notesMediaIndex.input.parse({}), {
    execute: async () => Response.json({ queued: await indexStoredMedia() }, { status: 202 }),
  }) as Response;
}, "notes-media.index");
