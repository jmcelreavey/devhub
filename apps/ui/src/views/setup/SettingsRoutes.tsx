import { lazy, Suspense, type ComponentType } from "react";
import SetupLoading from "../../../app/setup/loading";
import { SettingsFrame, type SettingsView } from "../../../app/status/SettingsLinks";
import Loading from "../../../app/status/loading";
import { useSearchParams } from "../../../lib/navigation";

const Status = lazy(() => import("../../../app/status/client"));
const Setup = lazy(() => import("../../../app/setup/client"));
const Actions = lazy(() => import("../../../app/actions/client"));
const Logs = lazy(() => import("../../../app/logs/client"));
const Plugins = lazy(() => import("./SettingsPlugins"));
const Recovery = lazy(() => import("../../../app/recovery/RecoveryPage").then(
  ({ RecoveryPage }) => ({ default: RecoveryPage }),
));
const Skills = lazy(() => import("../../../app/skills/client"));
const Proposals = lazy(() => import("../../../app/skills/proposals/client"));
const Changelog = lazy(() => import("../../../components/releases/ReleaseNotes").then(
  ({ ChangelogView }) => ({ default: ChangelogView }),
));

const VIEWS = {
  status: Status,
  logs: Logs,
  actions: Actions,
  setup: Setup,
  recovery: Recovery,
  plugins: Plugins,
  skills: Skills,
  proposals: Proposals,
  changelog: Changelog,
} satisfies Record<SettingsView, ComponentType>;

export function SetupRoute() {
  return (
    <>
      <title>Setup · DevHub</title>
      <SettingsFrame active="setup">
        <Suspense fallback={<SetupLoading />}><Setup /></Suspense>
      </SettingsFrame>
    </>
  );
}

export function StatusRoute() {
  const params = useSearchParams();
  const requested = params.getAll("view");
  const active = requested.length === 1 && Object.hasOwn(VIEWS, requested[0])
    ? requested[0] as SettingsView
    : "status";
  const View = VIEWS[active];

  return (
    <>
      <title>Settings · DevHub</title>
      <SettingsFrame active={active}>
        <Suspense fallback={<Loading />}><View /></Suspense>
      </SettingsFrame>
    </>
  );
}
