// Next.js calls this once on server start (Node runtime).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Advertise this instance before anything else, so an agent starting
  // alongside the server finds the right one rather than whichever DevHub
  // happens to hold port 1337.
  const { writeDashboardRuntime } = await import("./lib/dashboard-runtime");
  writeDashboardRuntime();
  // DEVHUB_SCHEDULER=0 for a second dashboard (a dev server beside the desktop
  // app): both read the same jobs.json, and one scheduler should own it.
  if (process.env.DEVHUB_SCHEDULER !== "0") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  } else {
    const { appendSchedulerLog } = await import("./lib/scheduler-log");
    appendSchedulerLog("info", "scheduler", "disabled by DEVHUB_SCHEDULER=0 — another DevHub process owns scheduled jobs");
  }
  const { startShareExpiry } = await import("./lib/share/share-expiry");
  startShareExpiry();
  const { startAutoPrReviewPoller } = await import("./lib/github/auto-pr-review-poller");
  startAutoPrReviewPoller();
  // URL-based MCP clients need a listener; off with DEVHUB_MCP_HTTP=0.
  const { startMcpHttpPeer } = await import("./lib/mcp-http-peer");
  void startMcpHttpPeer().catch((err: unknown) => {
    console.error("[mcp-http] could not start:", err);
  });
}
