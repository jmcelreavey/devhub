/**
 * Shared secret-detection utilities for OpenCode config files.
 * Single source of truth used by the API route, collector, and validator
 * so the "raw secret" heuristic can't drift between the three enforcement points.
 */

export const ENV_TOKEN_EXACT = /^\{env:[A-Za-z_][A-Za-z0-9_]*\}$/;
export const SECRET_KEY = /(?:api[-_]?key|secret|token|password)/i;

export function isSecretLikeKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/**
 * True when a string value at a secret-like key looks like a raw secret:
 * not an `{env:VAR}` placeholder, not a URL, and long enough to be real.
 */
export function looksLikeRawSecret(key: string, value: string): boolean {
  return (
    isSecretLikeKey(key) &&
    !ENV_TOKEN_EXACT.test(value) &&
    value.trim().length >= 12 &&
    !/^https?:\/\//i.test(value)
  );
}

/**
 * Walk a JSON value and return the dotted path of the first raw secret found,
 * or null if none. A raw secret is a string that passes `looksLikeRawSecret`.
 */
export function findRawSecretPath(value: unknown, key = "", segs: string[] = []): string | null {
  if (typeof value === "string") {
    return looksLikeRawSecret(key, value) ? segs.join(".") : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = findRawSecretPath(value[i], key, [...segs, String(i)]);
      if (r !== null) return r;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const r = findRawSecretPath(v, k, [...segs, k]);
      if (r !== null) return r;
    }
  }
  return null;
}
