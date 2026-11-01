/** Keep browser timeout internals out of recoverable request errors. */
export function requestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === "TimeoutError") return "This request took too long. Retry to load it again.";
  return error instanceof Error && error.message ? error.message : fallback;
}
