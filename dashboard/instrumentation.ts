// Next.js calls this once on server start (Node runtime).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Advertise this instance before anything else, so an agent starting
  // alongside the server finds the right one rather than whichever DevHub
  // happens to hold port 1337.
  const { writeDashboardRuntime } = await import("./lib/dashboard-runtime");
  writeDashboardRuntime();
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
  const { startShareExpiry } = await import("./lib/share/share-expiry");
  startShareExpiry();
  // URL-based MCP clients need a listener; off with DEVHUB_MCP_HTTP=0.
  const { startMcpHttpPeer } = await import("./lib/mcp-http-peer");
  void startMcpHttpPeer().catch((err: unknown) => {
    console.error("[mcp-http] could not start:", err);
  });
}
