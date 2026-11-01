"use client";

import {
  gateAllows,
  settingsLinks,
  type SectionTab,
  type SetupGateStatus,
} from "../../../../packages/shared/ui-lib/navigation/nav";
import { useIsDesktopPointer } from "@/lib/hooks/use-is-mobile";
import { usePluginNav } from "@/lib/hooks/use-plugin-nav";
import { useSetupStatus } from "@/lib/hooks/use-setup-status";
import { ArrowRight } from "lucide-react";
import Link from "@/lib/navigation";
import { createContext, useContext, type ReactNode } from "react";
import styles from "./status.module.css";

const SETTINGS_VIEWS = [
  { id: "status", label: "Status", route: "/status" },
  { id: "logs", label: "Logs", route: "/logs", desktopOnly: true },
  { id: "actions", label: "Actions", route: "/actions", desktopOnly: true },
  { id: "setup", label: "Setup", route: "/setup" },
  { id: "recovery", label: "Recovery", route: "/recovery" },
  { id: "plugins", label: "Plugins", route: "/plugins" },
  { id: "skills", label: "Skills", route: "/skills" },
  { id: "proposals", label: "Skill proposals", route: "/skills/proposals" },
  { id: "changelog", label: "Changelog", route: "/changelog" },
] as const;

export type SettingsView = (typeof SETTINGS_VIEWS)[number]["id"];

const SettingsFrameContext = createContext(false);

function additionalSettingsTabs(
  tabs: readonly SectionTab[],
  setup: SetupGateStatus | null,
  desktop: boolean,
): SectionTab[] {
  return tabs.filter((tab) =>
    !SETTINGS_VIEWS.some((view) => view.route === tab.href)
    && gateAllows(tab.gate, setup)
    && (!tab.desktopOnly || desktop),
  );
}

export function SettingsLinks({ active }: { active: SettingsView }) {
  const desktop = useIsDesktopPointer();
  const setup = useSetupStatus();
  const { sections } = usePluginNav();
  const additionalTabs = additionalSettingsTabs(sections.system, setup ?? null, desktop);
  const moreLinks = settingsLinks().filter(
    (link) => !SETTINGS_VIEWS.some((view) => view.route === link.href)
      && !additionalTabs.some((tab) => tab.href === link.href),
  );

  return (
    <div className={styles.navigation}>
      <div className={styles.navigationTitle}>Settings</div>
      <nav aria-label="Settings views" className={`hub-tabs ${styles.navigationTabs}`}>
        {SETTINGS_VIEWS.filter((view) => !("desktopOnly" in view) || desktop).map((view) => (
          <Link
            key={view.id}
            href={view.route}
            prefetch={false}
            className="hub-tab"
            data-active={active === view.id}
            aria-current={active === view.id ? "page" : undefined}
          >
            {view.label}
          </Link>
        ))}
        {additionalTabs.map((tab) => (
          <Link key={tab.href} href={tab.href} prefetch={false} className="hub-tab">
            {tab.label}
          </Link>
        ))}
      </nav>
      {moreLinks.length > 0 && (
        <nav aria-label="More in Settings" className={styles.related}>
          {moreLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
              <ArrowRight size={12} aria-hidden />
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

export function SettingsFrame({ active, children }: { active: SettingsView; children: ReactNode }) {
  const nested = useContext(SettingsFrameContext);
  if (nested) return <>{children}</>;

  return (
    <SettingsFrameContext.Provider value>
      <div className={styles.frame}>
        <SettingsLinks active={active} />
        <div className={styles.frameContent}>{children}</div>
      </div>
    </SettingsFrameContext.Provider>
  );
}
