import { lazy, Suspense, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { SettingsFrame, type SettingsView } from "../../app/status/SettingsLinks";
import { RouteLoading } from "../../components/ui/RouteLoading";

const ActionsPage = lazy(() => import("../../app/actions/client"));
const LogsPage = lazy(() => import("../../app/logs/client"));
const RecoveryPage = lazy(() => import("../../app/recovery/RecoveryPage").then(module => ({ default: module.RecoveryPage })));
const SkillsPage = lazy(() => import("../../app/skills/client"));
const SkillProposalsPage = lazy(() => import("../../app/skills/proposals/client"));
const ChangelogView = lazy(() => import("../../components/releases/ReleaseNotes").then(module => ({ default: module.ChangelogView })));
function Page({ active, children }: { active: SettingsView; children: ReactNode }) {
  return <SettingsFrame active={active}><Suspense fallback={<RouteLoading />}>{children}</Suspense></SettingsFrame>;
}

export const routes: RouteObject[] = [
  { path: "/actions", element: <Page active="actions"><ActionsPage /></Page> },
  { path: "/changelog", element: <Page active="changelog"><ChangelogView /></Page> },
  { path: "/logs", element: <Page active="logs"><LogsPage /></Page> },
  { path: "/recovery", element: <Page active="recovery"><RecoveryPage /></Page> },
  { path: "/skills", element: <Page active="skills"><SkillsPage /></Page> },
  { path: "/skills/proposals", element: <Page active="proposals"><SkillProposalsPage /></Page> },
];
