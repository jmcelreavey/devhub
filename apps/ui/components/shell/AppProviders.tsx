"use client";

import { Suspense, type ReactNode } from "react";
import { RuntimeBrandProvider } from "@/components/shell/RuntimeBrandProvider";
import { AgentLaunchSheet } from "@/components/agents/AgentLaunchSheet";
import { PackagedCheckoutBanner } from "@/components/desktop/PackagedCheckoutBanner";
import { UpdateBanner } from "@/components/desktop/UpdateBanner";
import { ReleaseNotesProvider, WhatsNewBanner } from "@/components/releases/ReleaseNotes";
import { NotesOverlayProvider } from "@/components/notes/NotesOverlayProvider";
import { WorkflowNotifications } from "@/components/tasks/WorkflowNotifications";
import { PersistentAgents } from "@/components/persistent/PersistentAgents";
import { PersistentRepoLearnDock } from "@/components/persistent/PersistentRepoLearnDock";
import { CollapsibleSidebar } from "@/components/shell/CollapsibleSidebar";
import { ConfirmProvider } from "@/components/shell/ConfirmDialog";
import { DashboardShell } from "@/components/shell/DashboardShell";
import { ExternalLinks } from "@/components/shell/ExternalLinks";
import { HubTopBar } from "@/components/shell/HubTopBar";
import { KeyboardShortcuts } from "@/components/shell/KeyboardShortcuts";
import { MobileShell } from "@/components/shell/MobileShell";
import { NavProgress } from "@/components/shell/NavProgress";
import { RouteUsageRecorder } from "@/components/shell/RouteUsageRecorder";
import { ServiceWorkerRegister } from "@/components/shell/ServiceWorkerRegister";
import { TabTitle } from "@/components/shell/TabTitle";
import { TerminalDock } from "@/components/shell/TerminalDock";
import { TerminalTranscriptModal } from "@/components/shell/TerminalTranscriptModal";
import { ThemeSystemSync } from "@/components/shell/ThemeSystemSync";
import { GraphiteGate } from "@/components/graphite/GraphiteGate";
import { ThemeEffectsGate } from "@/components/themes/ThemeEffectsGate";
import { RuntimeThemes } from "@/components/themes/RuntimeThemes";
import { BootScreenProvider } from "@/components/ui/BootScreen";
import { ToastProvider } from "@/components/shell/ToastProvider";
import { UiPrefsBootstrap } from "@/components/shell/UiPrefsBootstrap";
import { WorkspaceTabPanels, WorkspaceTabsProvider, WorkspaceTabStrip } from "@/components/shell/WorkspaceTabs";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <RuntimeBrandProvider>
      <ServiceWorkerRegister />
      <Suspense fallback={null}>
        <RouteUsageRecorder />
      </Suspense>
      <ThemeSystemSync />
      <RuntimeThemes />
      <GraphiteGate />
      <ThemeEffectsGate />
      <ToastProvider>
        <ConfirmProvider>
          <Suspense fallback={null}>
            <WorkspaceTabsProvider>
              <ReleaseNotesProvider>
                <NavProgress />
                <DashboardShell />
                <KeyboardShortcuts />
                <ExternalLinks />
                <UiPrefsBootstrap />
                <TabTitle />

                {/* Desktop sidebar (collapsible) */}
                <CollapsibleSidebar />

                {/* Main area */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                  <MobileShell />

                  {/* Desktop topbar - breadcrumbs + actions */}
                  <Suspense fallback={null}>
                    <HubTopBar />
                  </Suspense>
                  <WorkspaceTabStrip />

                  {/* Renders nothing outside the packaged desktop app. Placed above
                      <main> rather than inside it so it never scrolls away mid-download. */}
                  <UpdateBanner />
                  <WhatsNewBanner />
                  <PackagedCheckoutBanner />

                  <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto relative">
                    <BootScreenProvider>
                      <WorkspaceTabPanels>{children}</WorkspaceTabPanels>
                    </BootScreenProvider>
                    <PersistentAgents />
                    <WorkflowNotifications />
                  </main>
                </div>

                <PersistentRepoLearnDock />
                <NotesOverlayProvider />
                <TerminalDock />
                <AgentLaunchSheet />
                <TerminalTranscriptModal />
              </ReleaseNotesProvider>
            </WorkspaceTabsProvider>
          </Suspense>
        </ConfirmProvider>
      </ToastProvider>
    </RuntimeBrandProvider>
  );
}
