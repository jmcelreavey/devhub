/**
 * Failures whose text is safe and useful to show as-is ("enter your existing
 * password", "port in use"). Everything else from an installer is diagnostics
 * and may carry secrets, so the route keeps it in the server log.
 */
export const USER_MESSAGE_PREFIX = "DEVHUB_USER_MESSAGE: ";

export class PaseoUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaseoUserError";
  }
}

/** The safe message carried by an error: thrown directly, or printed by `install-paseo.mjs` on stderr. */
export function paseoUserMessage(error: unknown): string | null {
  if (error instanceof PaseoUserError) return error.message;
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  if (typeof stderr !== "string") return null;
  for (const line of stderr.split(/\r?\n/)) {
    if (line.startsWith(USER_MESSAGE_PREFIX)) {
      const message = line.slice(USER_MESSAGE_PREFIX.length).trim();
      if (message) return message.slice(0, 400);
    }
  }
  return null;
}
