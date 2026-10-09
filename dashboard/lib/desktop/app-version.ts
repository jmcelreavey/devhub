/** App version as the desktop launcher passed it, not a value baked in at build time. */
export function readAppVersion(env: NodeJS.ProcessEnv = process.env): string {
  const value = env["DEVHUB_VERSION"];
  if (typeof value === "string" && value.trim()) return value.trim();
  return "unknown";
}
