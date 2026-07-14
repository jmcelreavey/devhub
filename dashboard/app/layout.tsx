import type { Metadata, Viewport } from "next";
import {
  DEFAULT_THEME_MODE_SETTING,
  DEFAULT_THEME_PRESET_ID,
  getThemeBootstrapInlineScript,
  resolveMode,
} from "@/lib/theme-presets";
import "./globals.css";
// Machine-local palette + @font-face for the active branding plugin (empty baseline
// when none is enabled). Imported after globals so a plugin can override core tokens.
import "./plugin-branding.generated.css";
import { CollapsibleSidebar } from "@/components/CollapsibleSidebar";
import { MobileShell } from "@/components/MobileShell";
import { NotesOverlayProvider } from "@/components/NotesOverlayProvider";
import { TerminalDock } from "@/components/TerminalDock";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ThemeSystemSync } from "@/components/ThemeSystemSync";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { DashboardShell } from "@/components/DashboardShell";
import { TabTitle } from "@/components/TabTitle";
import { ToastProvider } from "@/components/ToastProvider";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { HubTopBar } from "@/components/HubTopBar";
import { NavProgress } from "@/components/NavProgress";
import { PersistentChamber } from "@/components/PersistentChamber";
import { PersistentOpenCode } from "@/components/PersistentOpenCode";
import { PersistentClaude } from "@/components/PersistentClaude";
import { PersistentRepoLearnDock } from "@/components/PersistentRepoLearnDock";
import { UiPrefsBootstrap } from "@/components/UiPrefsBootstrap";
import { KonamiPong } from "@/components/KonamiPong";

export const metadata: Metadata = {
  title: {
    default: "DevHub",
    template: "%s · DevHub",
  },
  description: "Personal developer dashboard - repos, skills, actions, notes, and more.",
  keywords: ["developer", "dashboard", "devhub", "productivity"],
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "DevHub",
    title: "DevHub - Personal Developer Dashboard",
    description: "Personal developer dashboard - repos, skills, actions, notes, and more.",
  },
  twitter: {
    card: "summary",
    title: "DevHub - Personal Developer Dashboard",
    description: "Personal developer dashboard - repos, skills, actions, notes, and more.",
  },
  icons: {
    icon: [
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icon-192.png",
    apple: "/icon-180.png",
  },
};

/**
 * Next 16's metadata system owns the <meta name="viewport"> and theme-color
 * tags — a hand-written <meta> in <head> is overridden by the framework
 * default. `viewportFit: "cover"` is required for env(safe-area-inset-*) to
 * resolve to non-zero values on notched iPhones / installed PWAs.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#111416" },
    { media: "(prefers-color-scheme: light)", color: "#f7f8f9" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className="h-full"
      data-theme={resolveMode(DEFAULT_THEME_MODE_SETTING)}
      data-theme-mode={DEFAULT_THEME_MODE_SETTING}
      data-theme-preset={DEFAULT_THEME_PRESET_ID}
      suppressHydrationWarning
    >
      <head>
        {/*
          Apply the saved theme (mode + preset, resolving "system") before first paint to
          avoid a flash of the wrong palette. Must be a raw inline <script> as the FIRST
          child of <head> so it runs synchronously during HTML parse - next/script's
          `beforeInteractive` can execute after the initial paint in the App Router, which
          caused a dark→light flash on reload.
        */}
        <script dangerouslySetInnerHTML={{ __html: getThemeBootstrapInlineScript() }} />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body
        className="h-full flex overflow-hidden"
        style={{ background: "var(--bg)", color: "var(--text)" }}
      >
        <ServiceWorkerRegister />
        <ThemeSystemSync />
        <ToastProvider>
          <ConfirmProvider>
            <NavProgress />
            <DashboardShell />
            <KeyboardShortcuts />
            <UiPrefsBootstrap />
            <TabTitle />

            {/* Desktop sidebar (collapsible) */}
            <CollapsibleSidebar />

            {/* Main area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              {/* Mobile chrome - top bar (burger drawer + search + overflow)
                  and the fixed bottom shelf, owned by one component. */}
              <MobileShell />

              {/* Desktop topbar - breadcrumbs + actions */}
              <HubTopBar />

              <main className="flex-1 overflow-y-auto relative">
                  {children}
                  <PersistentChamber />
                  <PersistentOpenCode />
                  <PersistentClaude />
              </main>
            </div>

            <PersistentRepoLearnDock />
            <NotesOverlayProvider />
            <TerminalDock />
            <PWAInstallPrompt />
            <KonamiPong />
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
