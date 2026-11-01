import { lazy, Suspense, type ComponentType } from "react";
import { useLocation, useParams, useRouteError, type RouteObject } from "react-router-dom";
import PluginsError from "../../app/plugins/error";
import RuntimeError from "../../app/plugins/runtime/[name]/error";
import { SettingsFrame } from "../../app/status/SettingsLinks";
import { PageSkeleton } from "../../components/ui/PageSkeleton";
import "../../app/plugins/plugins.css";

const PluginsPage = lazy(() => import("../../app/plugins/client").then((module) => ({ default: module.PluginsPage })));
const RuntimePage = lazy(() => import("../../app/plugins/runtime/[name]/runtime-page"));

function PageError({ view: View }: { view: ComponentType<{ error: Error; reset: () => void }> }) {
  const cause = useRouteError();
  const error = cause instanceof Error ? cause : new Error("Couldn't load this page.");
  return <View error={error} reset={() => window.location.reload()} />;
}

function RuntimeRoute() {
  const { name = "" } = useParams();
  const { search } = useLocation();
  const page = new URLSearchParams(search).get("page") ?? "";
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RuntimePage key={`${name}:${search}`} name={name} initialPage={page} initialSearch={search} />
    </Suspense>
  );
}

export const routes: RouteObject[] = [
  {
    path: "/plugins",
    caseSensitive: true,
    element: <SettingsFrame active="plugins"><Suspense fallback={<PageSkeleton />}><PluginsPage /></Suspense></SettingsFrame>,
    errorElement: <PageError view={PluginsError} />,
  },
  {
    path: "/plugins/runtime/:name",
    caseSensitive: true,
    element: <RuntimeRoute />,
    errorElement: <PageError view={RuntimeError} />,
  },
];
