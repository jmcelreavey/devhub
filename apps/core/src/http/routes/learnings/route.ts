import { learningsList } from "../../../../../../packages/shared/actions/workspace";
import path from "node:path";
import { getNotesDir } from "../../../lib/notes/dir";
import { listLearningEntries, readLearningDetail } from "../../../lib/learnings/index";


function learningsDir(): string {
  return path.join(getNotesDir(), "learnings");
}

export async function GET(req: Request) {
  return await learningsList.handler({ category: new URL(req.url).searchParams.get("category") ?? undefined }, { execute: () => {
    const dir = learningsDir();
    const category = new URL(req.url).searchParams.get("category");

    if (category) {
      const detail = readLearningDetail(dir, category);
      if (!detail) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(detail);
    }

    return Response.json({ entries: listLearningEntries(dir) });
  } }) as Response;
}
