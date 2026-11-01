export type ActionResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; error: string; status: number };
