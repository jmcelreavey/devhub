/** Durable idempotency claims for agent submissions; the first claimant wins. */
export interface RequestClaimStore {
  read(hash: string): Promise<string | null>;
  claim(hash: string, runId: string): Promise<string>;
  /** Release only the caller's claim when no submission was attempted. */
  release(hash: string, runId: string): Promise<void>;
}
