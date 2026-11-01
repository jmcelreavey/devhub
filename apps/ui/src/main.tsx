import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, loadApp } from "./App";
import { RouteLoading } from "../components/ui/RouteLoading";
import { createBrowserRouter, RouterProvider } from "../lib/navigation";
import { Navigate, useLocation, useRouteError } from "react-router-dom";
import { routes } from "./routes";
import NotFound from "../app/not-found";
import { FetchError } from "../components/ui/FetchError";
import { RouteError } from "../components/ui/RouteError";
import { useLive } from "../lib/hooks/use-fetch";
import { applyLogoChoice } from "../lib/themes/brand-mark";
import {
  applyThemeSelection,
  sanitizeModeSetting,
  sanitizePreset,
  THEME_MODE_KEY,
  THEME_PRESET_KEY,
} from "../lib/themes/presets";
import "../app/globals.css";
import "../components/releases/releases.css";

let mode: string | null = null;
let preset: string | null = null;
let logo: string | null = null;
try {
  mode = localStorage.getItem(THEME_MODE_KEY);
  preset = localStorage.getItem(THEME_PRESET_KEY);
  logo = localStorage.getItem("devhub-logo-icon");
} catch {
  // Use the built-in defaults when storage is unavailable.
}
applyThemeSelection({ mode: sanitizeModeSetting(mode), preset: sanitizePreset(preset) }, { persist: false, notify: false });
applyLogoChoice(logo);

const root = document.getElementById("root")!;

function UnknownRoute() {
  const { pathname, search, hash } = useLocation();
  const { data, error, mutate } = useLive<{ alias: { name: string; page: string } | null }>(`/api/plugins/navigation?alias=${encodeURIComponent(pathname)}`, { keepPreviousData: false });
  if (error) return <FetchError message={error.message || "Could not resolve this address."} onRetry={() => { void mutate(); }} />;
  if (!data) return <RouteLoading />;
  if (!data.alias) return <NotFound />;
  const params = new URLSearchParams(search);
  params.set("page", data.alias.page);
  return <Navigate replace to={{ pathname: `/plugins/runtime/${encodeURIComponent(data.alias.name)}`, search: `?${params}`, hash }} />;
}

function AppError() {
  const cause = useRouteError();
  const error = cause instanceof Error ? cause : new Error("Could not load this page.");
  return <RouteError error={error} reset={() => window.location.reload()} />;
}

const router = createBrowserRouter([{
  element: <App />,
  errorElement: <AppError />,
  loader: loadApp,
  hydrateFallbackElement: <RouteLoading />,
  shouldRevalidate: ({ currentUrl, nextUrl, defaultShouldRevalidate }) =>
    currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search ? false : defaultShouldRevalidate,
  children: [
    ...routes,
    {
      path: "*",
      element: <UnknownRoute />,
    },
  ],
}]);

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
