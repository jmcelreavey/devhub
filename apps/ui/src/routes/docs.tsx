import { lazy, Suspense, useEffect, useMemo } from "react";
import { Navigate, Outlet, useLocation, useOutletContext, useParams, type RouteObject } from "react-router-dom";
import { DiagramsShell } from "../../components/diagrams/DiagramsShell";
import { DocArticleView } from "../../components/docs/DocArticleView";
import { DocsLandingPage } from "../../components/docs/DocsLandingPage";
import { DocsSectionPage } from "../../components/docs/DocsSectionPage";
import { DocsShell } from "../../components/docs/DocsShell";
import { FetchError } from "../../components/ui/FetchError";
import { RouteLoading } from "../../components/ui/RouteLoading";
import { VaultEditorPage } from "../../components/vault/VaultEditorPage";
import { DIAGRAM_ROOT_AREA_ID, diagramBrowseModelFromTree } from "../../lib/diagrams/diagram-browse";
import { extractDiagramsTree, type DiagramTreeEntry } from "../../../../packages/shared/ui-lib/diagrams/utils";
import { defaultFetcher, useLive } from "../../lib/hooks/use-fetch";
import type { DocDetail, DocSectionGroup, DocSummary } from "../../../core/src/lib/docs/doc-types";
import type { DocSectionMeta } from "../../../../packages/shared/ui-lib/docs/doc-sections";

const DiagramsIndex = lazy(() => import("../../app/diagrams/client"));
const DiagramEditor = lazy(() => import("../../app/diagrams/[...path]/client"));

interface DocsIndexData {
  sections: DocSectionGroup[];
  recent: DocSummary[];
  totalDocs: number;
}

interface DocsDetailData {
  detail: DocDetail | null;
  section: { meta: DocSectionMeta; docs: DocSummary[]; prev: DocSectionMeta | null; next: DocSectionMeta | null } | null;
}

function DocsLayout() {
  const { data, error, mutate } = useLive<DocsIndexData>("/api/docs/tree?view=index");
  useEffect(() => {
    const refresh = () => { void mutate(); };
    window.addEventListener("devhub:docs-tree-changed", refresh);
    return () => window.removeEventListener("devhub:docs-tree-changed", refresh);
  }, [mutate]);
  if (!data && error) return <FetchError message="Could not load docs." onRetry={() => { void mutate(); }} />;
  if (!data) return <RouteLoading />;
  const groups = data.sections.map((section) => ({
    id: section.meta.id,
    label: section.meta.label,
    secondary: section.meta.secondary,
    docs: section.docs.filter((doc) => !doc.draft).map(({ slug, title, href, description }) => ({ slug, title, href, description })),
  })).filter((group) => group.docs.length > 0);
  return <DocsShell groups={groups}><Outlet context={data} /></DocsShell>;
}

function DocsIndex() {
  const data = useOutletContext<DocsIndexData>();
  return <DocsLandingPage {...data} />;
}

function DocsDetail() {
  const { pathname, search, hash } = useLocation();
  let path: string[] | null = null;
  try { path = pathname.slice("/docs/".length).split("/").map(decodeURIComponent); } catch { /* Invalid address. */ }
  const slug = path?.join("/");
  const { data, error, mutate } = useLive<DocsDetailData>(slug ? `/api/docs/tree?view=detail&slug=${encodeURIComponent(slug)}` : null, { keepPreviousData: false });
  useEffect(() => {
    const refresh = () => { void mutate(); };
    window.addEventListener("devhub:docs-tree-changed", refresh);
    return () => window.removeEventListener("devhub:docs-tree-changed", refresh);
  }, [mutate]);
  if (!path || !slug) return <FetchError message="This doc address is invalid." />;
  if (!data && error) return <FetchError message="Could not load this doc." onRetry={() => { void mutate(); }} />;
  if (!data) return <RouteLoading />;
  if (data.section) return <DocsSectionPage {...data.section} />;
  const query = new URLSearchParams(search);
  if (!data.detail && query.get("edit") !== "1") {
    query.set("edit", "1");
    return <Navigate replace to={{ pathname, search: `?${query}`, hash }} />;
  }
  if (!data.detail || query.get("edit") === "1") {
    return <VaultEditorPage key={slug} vault="docs" path={path} readHref={data.detail?.href} />;
  }
  return <DocArticleView detail={data.detail} />;
}

async function fetchDiagramTree(url: string): Promise<DiagramTreeEntry[]> {
  const data = await defaultFetcher(url);
  if (!Array.isArray(data)) throw new Error("Invalid diagram tree");
  return data as DiagramTreeEntry[];
}

function DiagramsLayout() {
  const { data, error, mutate } = useLive<DiagramTreeEntry[]>("/api/tree", { fetcher: fetchDiagramTree });
  const groups = useMemo(() => {
    const model = diagramBrowseModelFromTree(extractDiagramsTree(data ?? []));
    return model.areas
      .filter((area) => area.id !== DIAGRAM_ROOT_AREA_ID)
      .map((area) => ({
        id: area.id,
        label: area.label,
        items: area.diagrams.map((diagram) => ({
          slug: diagram.path,
          title: diagram.name,
          href: diagram.href,
        })),
      }));
  }, [data]);

  useEffect(() => {
    const refresh = () => { void mutate().catch(() => {}); };
    window.addEventListener("devhub:notes-tree-changed", refresh);
    return () => window.removeEventListener("devhub:notes-tree-changed", refresh);
  }, [mutate]);

  if (!data && error) {
    return <FetchError message="Couldn't load diagrams." onRetry={() => { void mutate().catch(() => {}); }} />;
  }
  if (!data) return <RouteLoading variant="block" />;

  return <DiagramsShell groups={groups}><Outlet context={{ tree: data, loadError: !!error, reload: () => mutate().catch(() => undefined) }} /></DiagramsShell>;
}

function DiagramEditorRoute() {
  const params = useParams();
  const { pathname } = useLocation();
  try {
    const path = pathname.slice("/diagrams/".length).split("/").map(decodeURIComponent);
    return <DiagramEditor key={params["*"]} path={path} />;
  } catch {
    return <FetchError message="This diagram address is invalid." />;
  }
}

export const routes: RouteObject[] = [{
  path: "/docs",
  element: <DocsLayout />,
  children: [
    { index: true, element: <DocsIndex /> },
    { path: "*", element: <DocsDetail /> },
  ],
}, {
  path: "/diagrams",
  element: <DiagramsLayout />,
  children: [
    {
      index: true,
      element: <Suspense fallback={<RouteLoading variant="block" />}><DiagramsIndex /></Suspense>,
    },
    {
      path: "*",
      element: <Suspense fallback={<RouteLoading variant="block" />}><DiagramEditorRoute /></Suspense>,
    },
  ],
}];
