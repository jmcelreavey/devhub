/** Shared by Setup's form and its Test route; safe to import in the browser. */
/** Setup opens straight on the QA (Jev) step. */
export const JEV_SETUP_HREF = "/setup?step=jev";
export const TYPESAFE_KEYS_URL = "https://console.typesafe.ai/keys";

/** Same rules as TypeSafe's SDK: no whitespace, control or non-ASCII characters. */
export function typesafeKeyFormatError(raw: string): string | null {
  const key = raw.trim();
  if (!key) return "Paste a TypeSafe API key.";
  if (!/^[\x21-\x7e]+$/.test(key)) return "That key has spaces or unusual characters. Copy it again from the TypeSafe console.";
  if (key.length < 16) return "That key looks too short. Copy the whole key from the TypeSafe console.";
  return null;
}

export interface TypesafeCheckResult { ok: boolean; code: "connected" | "missing_key" | "bad_format" | "auth_failed" | "unreachable" | "http_error"; message: string }

/**
 * A free, authenticated call: GET /v1/models lists the models the key can use and
 * spends no tokens. Never echoes the key or the response body.
 */
export async function checkTypesafeKey(key: string | undefined, fetchImpl: typeof fetch = fetch): Promise<TypesafeCheckResult> {
  if (!key?.trim()) return { ok: false, code: "missing_key", message: "No TypeSafe API key yet. Paste one above." };
  const formatError = typesafeKeyFormatError(key);
  if (formatError) return { ok: false, code: "bad_format", message: formatError };
  let res: Response;
  try {
    res = await fetchImpl("https://api.typesafe.ai/v1/models", { headers: { Authorization: `Bearer ${key.trim()}`, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  } catch {
    return { ok: false, code: "unreachable", message: "Couldn't reach TypeSafe. Check your connection and try again." };
  }
  if (res.ok) return { ok: true, code: "connected", message: "Key works. QA runs are using it." };
  if (res.status === 401 || res.status === 403) return { ok: false, code: "auth_failed", message: "TypeSafe rejected this key. Create a new one in the TypeSafe console." };
  return { ok: false, code: "http_error", message: `TypeSafe returned HTTP ${res.status}. Try again in a minute.` };
}
