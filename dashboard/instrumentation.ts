// Next.js calls this once on server start (Node runtime).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
  const { startShareExpiry } = await import("./lib/share/share-expiry");
  startShareExpiry();
}
