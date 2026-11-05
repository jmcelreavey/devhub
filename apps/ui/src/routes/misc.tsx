import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Navigate, useLocation, useRouteError, type RouteObject } from "react-router-dom";
import CalendarError from "../../app/calendar/error";
import CalendarLoading from "../../app/calendar/loading";
import DbError from "../../app/db/error";
import DbLoading from "../../app/db/loading";
import EditorError from "../../app/editor/error";
import EditorLoading from "../../app/editor/loading";
import LearningsError from "../../app/learnings/error";
import LearningsLoading from "../../app/learnings/loading";
import QaError from "../../app/qa/error";
import QaLoading from "../../app/qa/loading";
import RadarError from "../../app/radar/error";
import RadarLoading from "../../app/radar/loading";
import SearchError from "../../app/search/error";
import SearchLoading from "../../app/search/loading";
import SharedError from "../../app/shared/error";
import SharedLoading from "../../app/shared/loading";
import VoiceError from "../../app/voice/error";
import VoiceLoading from "../../app/voice/loading";

const CalendarPage = lazy(() => import("../../app/calendar/client"));
const DbPage = lazy(() => import("../../app/db/client"));
const EditorPage = lazy(() => import("../../app/editor/client"));
const LearningsPage = lazy(() => import("../../app/learnings/client"));
const QaPage = lazy(() => import("../../app/qa/client"));
const RadarPage = lazy(() => import("../../app/radar/client"));
const SearchPage = lazy(() => import("../views/misc/SearchPage"));
const SharedPage = lazy(() => import("../../app/shared/client"));
const VoicePage = lazy(() => import("../../app/voice/client"));

function Page({ title, loading, children }: { title: string; loading: ReactNode; children: ReactNode }) {
  return <><title>{title} · DevHub</title><Suspense fallback={loading}>{children}</Suspense></>;
}

function PageError({ view: View }: { view: ComponentType<{ error: Error; reset: () => void }> }) {
  const cause = useRouteError();
  const error = cause instanceof Error ? cause : new Error("Couldn't load this page.");
  return <View error={error} reset={() => window.location.reload()} />;
}

function RecallRedirect() {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  params.set("mode", "recall");
  return <Navigate to={{ pathname: "/search", search: `?${params}`, hash }} replace />;
}

export const routes: RouteObject[] = [
  { path: "/briefing", element: <Navigate to="/work" replace /> },
  { path: "/calendar", element: <Page title="Calendar" loading={<CalendarLoading />}><CalendarPage /></Page>, errorElement: <PageError view={CalendarError} /> },
  { path: "/db", element: <Page title="Databases" loading={<DbLoading />}><DbPage /></Page>, errorElement: <PageError view={DbError} /> },
  { path: "/editor", element: <Page title="Editor" loading={<EditorLoading />}><EditorPage /></Page>, errorElement: <PageError view={EditorError} /> },
  { path: "/learnings", element: <Page title="Learnings" loading={<LearningsLoading />}><LearningsPage /></Page>, errorElement: <PageError view={LearningsError} /> },
  { path: "/qa", element: <Page title="QA lab" loading={<QaLoading />}><QaPage /></Page>, errorElement: <PageError view={QaError} /> },
  { path: "/radar", element: <Page title="Radar" loading={<RadarLoading />}><RadarPage /></Page>, errorElement: <PageError view={RadarError} /> },
  { path: "/search", element: <Page title="Search" loading={<SearchLoading />}><SearchPage /></Page>, errorElement: <PageError view={SearchError} /> },
  { path: "/recall", element: <RecallRedirect /> },
  { path: "/shared", element: <Page title="Live links" loading={<SharedLoading />}><SharedPage /></Page>, errorElement: <PageError view={SharedError} /> },
  { path: "/voice", element: <Page title="My voice" loading={<VoiceLoading />}><VoicePage /></Page>, errorElement: <PageError view={VoiceError} /> },
];
