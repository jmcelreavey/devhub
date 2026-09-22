// Next.js calls this once on server start (Node runtime).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // DEVHUB_SCHEDULER=0 marks a second dashboard (a dev server beside the
  // desktop app, the installer's self-test): both read the same jobs.json,
  // and one process should own the background work.
  const primary = process.env.DEVHUB_SCHEDULER !== "0";
  // Advertise this instance before anything else, so an agent starting
  // alongside the server finds the right one rather than whichever DevHub
  // happens to hold port 1337. Only the primary does: MCP follows the
  // advertisement, and terminal proposals live in one server's memory, so
  // agents routed to a secondary nobody has open queue work that never starts.
  if (primary) {
    const { writeDashboardRuntime } = await import("./lib/dashboard-runtime");
    writeDashboardRuntime();
  }
  const { startAionReconciliation } = await import("./lib/aionui/lifecycle");
  startAionReconciliation();
  if (primary) {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
    // Same single-owner rule: it writes the shared task sidecars.
    const { startTaskPrWatcher } = await import("./lib/tasks/task-pr-watch");
    startTaskPrWatcher();
    const { startAutoPrReviewPoller } = await import("./lib/github/auto-pr-review-poller");
    startAutoPrReviewPoller();
  } else {
    const { appendSchedulerLog } = await import("./lib/scheduler-log");
    appendSchedulerLog("info", "scheduler", "disabled by DEVHUB_SCHEDULER=0 — another DevHub process owns scheduled jobs");
  }
  const { startShareExpiry } = await import("./lib/share/share-expiry");
  startShareExpiry();
  // URL-based MCP clients need a listener; off with DEVHUB_MCP_HTTP=0.
  const { startMcpHttpPeer } = await import("./lib/mcp-http-peer");
  void startMcpHttpPeer().catch((err: unknown) => {
    console.error("[mcp-http] could not start:", err);
  });
}
