import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { useLocation, useParams, useRouteError, type RouteObject } from "react-router-dom";
import { RouteLoading } from "../../components/ui/RouteLoading";
import ReposError from "../../app/repos/error";
import RepoError from "../../app/repos/[name]/error";
import RepoGitError from "../../app/repos/[name]/git/error";
import LearnError from "../../app/repos/learn/[name]/error";
import OwnError from "../../app/own/[owner]/[name]/error";
import PrsError from "../../app/prs/error";
import ReviewError from "../../app/review/error";
import RepError from "../../app/review/rep/error";
import ConventionsError from "../../app/conventions/error";
import { useSearchParams } from "../../lib/navigation";

const ReposPage = lazy(() => import("../../app/repos/client"));
const RepoHub = lazy(() => import("../../app/repos/[name]/client").then((module) => ({ default: module.RepoHub })));
const RepoGitPage = lazy(() => import("../../app/repos/[name]/git/client").then((module) => ({ default: module.RepoGitPage })));
const LearnScreen = lazy(() => import("../../app/repos/learn/[name]/client").then((module) => ({ default: module.LearnScreen })));
const OwnerRepoPage = lazy(() => import("../../app/own/[owner]/[name]/client"));
const PrsPage = lazy(() => import("../../app/prs/client"));
const WorkPage = lazy(() => import("../../app/work/client"));
const ConventionsPage = lazy(() => import("../../app/conventions/client"));
const NotFound = lazy(() => import("../../app/not-found"));

function Page({ title, children }: { title: string; children: ReactNode }) {
  return <><title>{title} · DevHub</title><Suspense fallback={<RouteLoading />}>{children}</Suspense></>;
}

function PageError({ view: View }: { view: ComponentType<{ error: Error; reset: () => void }> }) {
  const cause = useRouteError();
  const error = cause instanceof Error ? cause : new Error("Couldn't load this page.");
  return <View error={error} reset={() => window.location.reload()} />;
}

function useValidParams() {
  const params = useParams();
  const { pathname } = useLocation();
  try {
    // Router params are already decoded; validate the raw URL without decoding twice.
    decodeURIComponent(pathname);
    return params;
  } catch {
    return null;
  }
}

function RepoPage({ git = false }: { git?: boolean }) {
  const params = useValidParams();
  if (!params?.name) return <Page title="Not found"><NotFound /></Page>;
  return <Page title={params.name}>{git ? <RepoGitPage name={params.name} /> : <RepoHub name={params.name} />}</Page>;
}

function LearnPage() {
  const params = useValidParams();
  const search = useSearchParams();
  if (!params?.name) return <Page title="Not found"><NotFound /></Page>;
  return (
    <Page title={`Learn · ${params.name}`}>
      <LearnScreen
        name={params.name}
        focusLab={search.get("lab")?.trim() || undefined}
        domain={search.get("domain")?.trim() || undefined}
        ownedRepo={search.get("owned")?.trim() || undefined}
      />
    </Page>
  );
}

function OwnPage() {
  const params = useValidParams();
  if (!params?.owner || !params.name) return <Page title="Not found"><NotFound /></Page>;
  return <Page title={params.name}><OwnerRepoPage owner={params.owner} name={params.name} /></Page>;
}

export const routes: RouteObject[] = [
  { path: "/repos", element: <Page title="Repos"><ReposPage /></Page>, errorElement: <PageError view={ReposError} /> },
  { path: "/repos/:name", element: <RepoPage />, errorElement: <PageError view={RepoError} /> },
  { path: "/repos/:name/git", element: <RepoPage git />, errorElement: <PageError view={RepoGitError} /> },
  { path: "/repos/learn/:name", element: <LearnPage />, errorElement: <PageError view={LearnError} /> },
  { path: "/own/:owner/:name", element: <OwnPage />, errorElement: <PageError view={OwnError} /> },
  { path: "/prs", element: <Page title="PRs"><PrsPage /></Page>, errorElement: <PageError view={PrsError} /> },
  { path: "/review", element: <Page title="Weekly review"><WorkPage initialTab="review" /></Page>, errorElement: <PageError view={ReviewError} /> },
  { path: "/review/rep", element: <Page title="Daily rep"><WorkPage initialTab="rep" /></Page>, errorElement: <PageError view={RepError} /> },
  { path: "/conventions", element: <Page title="Conventions"><ConventionsPage /></Page>, errorElement: <PageError view={ConventionsError} /> },
];
