// Next.js calls this once on server start (Node runtime).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureTasksMigrated } = await import("./lib/tasks/storage");
  // Awaited: Next holds requests until register() settles, so the first Today
  // render sees migrated items rather than an empty list. A failure must not
  // keep the server down; readers still serve whatever items exist.
  await ensureTasksMigrated().catch((err: unknown) => {
    console.error("[tasks] migration failed:", err);
  });
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
  if (primary) {
    const { startAgentReconciliation } = await import("./lib/paseo/lifecycle");
    startAgentReconciliation();
    const { startAgentCliUpdates } = await import("./lib/paseo/agent-cli-updates");
    startAgentCliUpdates();
    const { startPendingPaseoRestart } = await import("./lib/paseo/pending-restart");
    startPendingPaseoRestart();
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
  // A verification server must not expire the user's live links.
  if (primary) {
    const { startShareExpiry } = await import("./lib/share/share-expiry");
    startShareExpiry();
  }
  // URL-based MCP clients need a listener; off with DEVHUB_MCP_HTTP=0.
  const { startMcpHttpPeer } = await import("./lib/mcp-http-peer");
  void startMcpHttpPeer().catch((err: unknown) => {
    console.error("[mcp-http] could not start:", err);
  });
}
