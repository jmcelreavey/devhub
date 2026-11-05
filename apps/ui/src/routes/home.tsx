import { lazy, Suspense } from "react";
import {
  Navigate,
  useLocation,
  type RouteObject,
} from "react-router-dom";
import { RouteLoading } from "../../components/ui/RouteLoading";
import { SkeletonRows } from "../../components/ui/SkeletonRows";
import { legacyTodayHref } from "../../lib/home-redirect";

const WorkPage = lazy(() => import("../../app/work/client"));
const AgentsPage = lazy(() => import("../../app/agents/client"));

function AgentsLoading() {
  return <div role="status" aria-label="Loading Agents" aria-busy="true">
    <div className="flex items-center gap-4 px-4 border-b border-border bg-bg-surface" style={{ height: 40 }} aria-hidden="true">
      {[48, 40, 40, 72].map((width, index) => <span key={index} className="skeleton" style={{ width, height: 12 }} />)}
    </div>
    <div className="p-4" aria-hidden="true"><SkeletonRows count={1} height={96} /></div>
  </div>;
}

function HomeRoute() {
  const { search, hash } = useLocation();
  const href = legacyTodayHref(search, hash);
  if (href) return <Navigate to={href} replace />;
  return <Navigate to="/work" replace />;
}

function TodayRoute() {
  const { search, hash } = useLocation();
  return <Navigate to={legacyTodayHref(search, hash) ?? "/work"} replace />;
}

export const routes: RouteObject[] = [
  { path: "/", element: <HomeRoute /> },
  { path: "/today", element: <TodayRoute /> },
  { path: "/notifications", element: <Navigate to="/work" replace /> },
  { path: "/work", element: <Suspense fallback={<RouteLoading titleWidth={120} rows={4} rowHeight={52} />}><WorkPage /></Suspense> },
  { path: "/storyboard", element: <Suspense fallback={<RouteLoading />}><WorkPage initialTab="board" /></Suspense> },
  { path: "/agents", element: <Suspense fallback={<AgentsLoading />}><AgentsPage /></Suspense> },
];
