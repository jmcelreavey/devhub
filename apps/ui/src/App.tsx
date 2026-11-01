import { AppProviders } from "../components/shell/AppProviders";
import { FetchError } from "../components/ui/FetchError";
import { Outlet } from "../lib/navigation";
import { redirect, useLoaderData, useRevalidator, type LoaderFunctionArgs } from "react-router-dom";
import { normalizeJiraDomain } from "../lib/utils";

export async function loadApp({ request }: LoaderFunctionArgs) {
  try {
    const response = await fetch("/api/desktop/first-run", {
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
    });
    if (!response.ok) throw new Error("Setup status unavailable");
    const status: unknown = await response.json();
    if (!status || typeof status !== "object" || !("desktop" in status) || !("completed" in status)
      || typeof status.desktop !== "boolean" || typeof status.completed !== "boolean") {
      throw new Error("Invalid setup status");
    }
    if (request.signal.aborted) throw request.signal.reason;
    const domain = "jiraDomain" in status && typeof status.jiraDomain === "string" ? status.jiraDomain : "";
    (window as Window & { __DEVHUB_JIRA_DOMAIN?: string }).__DEVHUB_JIRA_DOMAIN = normalizeJiraDomain(domain);
    if (status.desktop && !status.completed && new URL(request.url).pathname !== "/setup") return redirect("/setup");
    return { error: false };
  } catch (error) {
    if (request.signal.aborted) throw error;
    return { error: true };
  }
}

export function App() {
  const { error } = useLoaderData() as { error: boolean };
  const { revalidate } = useRevalidator();
  return (
    <>
      <a href="#main-content" className="skip-link" tabIndex={0}>
        Skip to main content
      </a>
      <AppProviders>{error ? <div className="page-wrapper"><FetchError message="Couldn't check setup status." onRetry={() => void revalidate()} /></div> : <Outlet />}</AppProviders>
    </>
  );
}
