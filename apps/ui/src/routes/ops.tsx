import { Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import ActionsPage from "../../app/actions/client";
import LogsPage from "../../app/logs/client";
import { RecoveryPage } from "../../app/recovery/RecoveryPage";
import SkillsPage from "../../app/skills/client";
import SkillProposalsPage from "../../app/skills/proposals/client";
import { SettingsFrame } from "../../app/status/SettingsLinks";
import { ChangelogView } from "../../components/releases/ReleaseNotes";
import { BootScreen } from "../../components/ui/BootScreen";

export const routes: RouteObject[] = [
  { path: "/actions", element: <SettingsFrame active="actions"><ActionsPage /></SettingsFrame> },
  { path: "/changelog", element: <SettingsFrame active="changelog"><ChangelogView /></SettingsFrame> },
  { path: "/logs", element: <SettingsFrame active="logs"><LogsPage /></SettingsFrame> },
  { path: "/recovery", element: <SettingsFrame active="recovery"><RecoveryPage /></SettingsFrame> },
  {
    path: "/skills",
    element: (
      <SettingsFrame active="skills">
        <Suspense fallback={<BootScreen state="loading" />}>
          <SkillsPage />
        </Suspense>
      </SettingsFrame>
    ),
  },
  { path: "/skills/proposals", element: <SettingsFrame active="proposals"><SkillProposalsPage /></SettingsFrame> },
];
