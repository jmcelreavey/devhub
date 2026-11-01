import { getVaultTree } from "../../../../lib/vault/create-vault-routes";
import { withErrorHandler } from "../../../../lib/api-utils";
import { docsList } from "../../../../../../../packages/shared/actions/docs";
import { getDocDetail, getDocIndex, getRecentDocs, getSectionDetail } from "../../../../lib/docs/doc-index";


export const GET = withErrorHandler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  if (params.get("view") === "index") {
    const index = getDocIndex();
    return Response.json({ sections: index.sections, recent: getRecentDocs(4), totalDocs: index.docs.filter((doc) => !doc.draft).length });
  }
  if (params.get("view") === "detail") {
    const slug = params.get("slug") ?? "";
    const detail = getDocDetail(slug);
    const section = !detail && !slug.includes("/") ? getSectionDetail(slug) : null;
    return Response.json({ detail, section });
  }
  try {
    const tree = await docsList.handler(docsList.input.parse({}), { list: () => getVaultTree("docs") });
    return Response.json(tree);
  } catch (err) {
    console.error("[api:docs/tree]", err);
    return Response.json([]);
  }
}, "docs.tree");
