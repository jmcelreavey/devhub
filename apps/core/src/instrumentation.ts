// Initialise core services before accepting requests.
export async function register() {
  const { ensureTasksMigrated } = await import("./domains/tasks/storage");
  // Awaited before the server accepts requests, so the first Today
  // render sees migrated items rather than an empty list. A failure must not
  // keep the server down; readers still serve whatever items exist.
  await ensureTasksMigrated().catch((err: unknown) => {
    console.error("[tasks] migration failed:", err);
  });
  // DEVHUB_SCHEDULER=0 marks a second dashboard (a dev server beside the
  // desktop app, the installer's self-test): both read the same jobs.json,
  // and one process should own the background work.
  const checkout = process.env.DEVHUB_CHECKOUT_DEV === "1";
  const primary = checkout ? process.env.DEVHUB_SCHEDULER === "1" : process.env.DEVHUB_SCHEDULER !== "0";
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
    // Stdio MCP servers whose client died before they learned to exit on their own.
    const { reapOrphanMcpServers } = await import("./lib/mcp/reap-orphan-mcp");
    void reapOrphanMcpServers();
    const { startAgentReconciliation } = await import("./lib/paseo/lifecycle");
    startAgentReconciliation();
    const { startAgentCliUpdates } = await import("./lib/paseo/agent-cli-updates");
    startAgentCliUpdates();
    const { startPendingPaseoRestart } = await import("./lib/paseo/pending-restart");
    startPendingPaseoRestart();
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
    // Same single-owner rule: it writes the shared task sidecars.
    const { startTaskPrWatcher } = await import("./domains/tasks/task-pr-watch");
    startTaskPrWatcher();
    const { startRuntimeServices } = await import("./lib/plugins/runtime-supervisor");
    startRuntimeServices();
    const { startAutoPrReviewPoller } = await import("./lib/github/auto-pr-review-poller");
    startAutoPrReviewPoller();
    // Storyboard auto mode: advances tasks the user started on auto (persisted, so it resumes after a restart).
    const { startStoryboardAutoTicker } = await import("./lib/storyboard/auto-ticker");
    startStoryboardAutoTicker();
  } else if (checkout) {
    console.info("[scheduler] disabled for checkout dev — set DEVHUB_SCHEDULER=1 to run scheduled jobs");
  } else {
    const { appendSchedulerLog } = await import("@devhub/core/scheduler/log");
    appendSchedulerLog("info", "scheduler", "disabled by DEVHUB_SCHEDULER=0 — enable it on one DevHub process to run scheduled jobs");
  }
  // A verification server must not expire the user's live links.
  if (primary) {
    const { startShareExpiry } = await import("./lib/share/share-expiry");
    startShareExpiry();
  }
  // Checkout MCP follows the same opt-in as its shared background work.
  if (!checkout || primary) {
    const { startMcpHttpPeer } = await import("./lib/mcp-http-peer");
    void startMcpHttpPeer().catch((err: unknown) => {
      console.error("[mcp-http] could not start:", err);
    });
  }
}
