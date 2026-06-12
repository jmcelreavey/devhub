import type { Metadata } from "next";
import Script from "next/script";
import { DEFAULT_THEME_PRESET_ID, getThemeBootstrapInlineScript } from "@/lib/theme-presets";
import "./globals.css";
import { CollapsibleSidebar } from "@/components/CollapsibleSidebar";
import { MobileTopBar } from "@/components/MobileTopBar";
import { NotesOverlayProvider } from "@/components/NotesOverlayProvider";
import { TerminalDock } from "@/components/TerminalDock";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { DashboardShell } from "@/components/DashboardShell";
import { TabTitle } from "@/components/TabTitle";
import { ToastProvider } from "@/components/ToastProvider";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { HubTopBar } from "@/components/HubTopBar";
import { NavProgress } from "@/components/NavProgress";
import { PersistentChamber } from "@/components/PersistentChamber";
import { PersistentOpenCode } from "@/components/PersistentOpenCode";
import { MobileBottomShelf } from "@/components/MobileBottomShelf";
import { UiPrefsBootstrap } from "@/components/UiPrefsBootstrap";

export const metadata: Metadata = {
  title: {
    default: "DevHub",
    template: "%s · DevHub",
  },
  description: "Personal developer dashboard — repos, skills, actions, notes, and more.",
  keywords: ["developer", "dashboard", "devhub", "productivity"],
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "DevHub",
    title: "DevHub — Personal Developer Dashboard",
    description: "Personal developer dashboard — repos, skills, actions, notes, and more.",
  },
  twitter: {
    card: "summary",
    title: "DevHub — Personal Developer Dashboard",
    description: "Personal developer dashboard — repos, skills, actions, notes, and more.",
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className="h-full"
      data-theme="dark"
      data-theme-preset={DEFAULT_THEME_PRESET_ID}
      suppressHydrationWarning
    >
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        {/*
          Apply the saved theme before first paint to avoid a flash of the
          wrong palette. Falls back to dark when no choice is saved.
          Use next/script (not raw <script>) so React 19 / the App Router handle it correctly.
        */}
        <Script
          id="devhub-theme-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: getThemeBootstrapInlineScript(),
          }}
        />
        <meta name="theme-color" content="#111416" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#f7f8f9" media="(prefers-color-scheme: light)" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        className="h-full flex overflow-hidden"
        style={{ background: "var(--bg)", color: "var(--text)" }}
      >
        <ServiceWorkerRegister />
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
              {/* Mobile top bar — burger nav + Notes/Tasks/Diagrams panels */}
              <MobileTopBar />

              {/* Desktop topbar — breadcrumbs + actions */}
              <HubTopBar />

              <main className="flex-1 overflow-y-auto relative">
                  {children}
                  <PersistentChamber />
                  <PersistentOpenCode />
              </main>
            </div>

            <MobileBottomShelf />
            <NotesOverlayProvider />
            <TerminalDock />
            <PWAInstallPrompt />
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
