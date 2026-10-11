import { randomBytes, timingSafeEqual } from "node:crypto";

export class BrowserLease {
  mode: "human" | "agent" | "taking-control" | "stopped" = "human";
  expiresAt = 0;
  private token = "";
  private generation = 0;
  private running?: Promise<unknown>;

  get revision() { return this.generation; }
  grant(expectedRevision = this.generation): string {
    if (this.mode !== "human" || expectedRevision !== this.generation) throw new Error("Browser control changed. Resume again from DevHub.");
    this.generation++;
    this.token = randomBytes(32).toString("base64url");
    this.expiresAt = Date.now() + 15 * 60_000;
    this.mode = "agent";
    return this.token;
  }
  credential(): string {
    this.check(this.token);
    return this.token;
  }
  check(token: string) {
    if (this.mode !== "agent" || Date.now() >= this.expiresAt || token.length !== this.token.length
      || !timingSafeEqual(Buffer.from(token), Buffer.from(this.token))) throw new Error("Browser access expired or was revoked. Resume from DevHub.");
  }
  async execute<T>(token: string, operation: (check: () => void) => Promise<T>): Promise<T> {
    this.check(token);
    if (this.running) throw new Error("Another browser command is still running. Observe again after it settles.");
    const generation = this.generation;
    const check = () => { this.check(token); if (generation !== this.generation) throw new Error("Browser control changed."); };
    const running = Promise.resolve().then(() => { check(); return operation(check); });
    this.running = running;
    try { const result = await running; check(); return result; }
    finally { if (this.running === running) this.running = undefined; }
  }
  async executeHuman<T>(operation: (check: () => void) => Promise<T>): Promise<T> {
    const generation = this.generation;
    const check = () => {
      if (this.mode !== "human" || generation !== this.generation) throw new Error("Human control changed. Take control again.");
    };
    check();
    if (this.running) throw new Error("Browser input is still running.");
    const running = Promise.resolve().then(() => { check(); return operation(check); });
    this.running = running;
    try { const result = await running; check(); return result; }
    finally { if (this.running === running) this.running = undefined; }
  }
  async takeover(): Promise<number> {
    if (this.mode === "stopped") return this.generation;
    this.mode = "taking-control"; this.token = ""; this.expiresAt = 0;
    const revision = ++this.generation;
    try { await this.running; } catch { /* The caller receives its operation failure; takeover still waits for it. */ }
    if (revision === this.generation) this.mode = "human";
    return revision;
  }
  async stop() {
    this.mode = "stopped"; this.token = ""; this.expiresAt = 0; this.generation++;
    try { await this.running; } catch { /* A stopped lease cannot be granted again. */ }
  }
}
