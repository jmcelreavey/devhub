/**
 * A usage loader failure with a cause short and safe enough to show: no tokens,
 * no response bodies. The card shows `reason` behind Details; the server log
 * keeps the full error.
 */
export class UsageLoadError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message);
    this.name = "UsageLoadError";
  }
}
