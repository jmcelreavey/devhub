/** Shared by the PTY listener and its same-origin connection metadata. */
export function terminalPort(env: Partial<NodeJS.ProcessEnv> = process.env): number {
  const value = env.TERMINAL_PORT?.trim() || "1339";
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("TERMINAL_PORT must be an integer between 1 and 65535");
  }
  return port;
}
