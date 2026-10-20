export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly capacity: number;
  private readonly periodMs: number;
  private readonly now: () => number;

  constructor(capacity = 20, periodMs = 60_000, now = Date.now) {
    this.capacity = capacity;
    this.periodMs = periodMs;
    this.now = now;
  }

  take(key: string): boolean {
    const at = this.now();
    for (const [id, bucket] of this.buckets) if (at - bucket.at > this.periodMs * 2) this.buckets.delete(id);
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, at };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (at - bucket.at) * this.capacity / this.periodMs);
    bucket.at = at;
    if (!this.buckets.has(key) && this.buckets.size >= 10_000) return false;
    this.buckets.set(key, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens--;
    return true;
  }
}
