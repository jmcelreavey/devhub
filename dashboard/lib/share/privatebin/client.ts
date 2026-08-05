import { encryptPaste, type EncryptOptions, type PasteExpiry } from "./crypto";

/**
 * Talk to a PrivateBin instance. The instance only ever sees ciphertext — see
 * `crypto.ts` — so the only thing configurable here is which one to use.
 *
 * https://github.com/PrivateBin/PrivateBin/wiki/API
 */

const DEFAULT_INSTANCE = "https://privatebin.net";

/** Instances cap paste size; the default in PrivateBin's config is 10 MB. */
const MAX_PASTE_BYTES = 8 * 1024 * 1024;

const REQUEST_TIMEOUT_MS = 20_000;

/** Configured instance, without a trailing slash. */
export function instanceUrl(): string {
  const configured = process.env.PRIVATEBIN_URL?.trim();
  return (configured && configured.length > 0 ? configured : DEFAULT_INSTANCE).replace(/\/+$/, "");
}

interface CreateResponse {
  status: number;
  id?: string;
  deletetoken?: string;
  message?: string;
}

export interface CreatedPaste {
  pasteId: string;
  deleteToken: string;
  /** Full share URL including the key fragment. Never log this. */
  url: string;
}

export interface CreatePasteOptions extends EncryptOptions {
  expire?: PasteExpiry;
}

/**
 * A note about the `#-` in the URL.
 *
 * A burn-after-reading link pasted into Slack gets fetched by Slack's unfurler
 * before any human opens it, which burns the paste and hands the recipient a
 * 404. Outlook and most corporate link scanners do the same. PrivateBin > 1.7
 * added a URL variant for exactly this: a `-` immediately after the `#` makes
 * the page ask for confirmation instead of decrypting on load, so a scanner
 * that executes the JavaScript still does not consume the paste.
 *
 * Older instances ignore the dash and simply behave as before, so this is safe
 * to always emit. Do not "tidy up" the stray dash.
 */
function pasteUrl(base: string, id: string, key: string): string {
  return `${base}/?${id}#-${key}`;
}

async function postJson(body: unknown): Promise<CreateResponse> {
  const base = instanceUrl();
  let res: Response;
  try {
    res = await fetch(`${base}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Required by the JSON API — without it PrivateBin serves HTML.
        "X-Requested-With": "JSONHttpRequest",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "is unreachable";
    throw new Error(`${base} ${reason}. Check the instance is up, or set PRIVATEBIN_URL.`);
  }

  if (!res.ok) {
    throw new Error(`${base} returned ${res.status} ${res.statusText}`);
  }

  const parsed = (await res.json().catch(() => null)) as CreateResponse | null;
  if (!parsed || typeof parsed.status !== "number") {
    throw new Error(`${base} returned an unexpected response — is it a PrivateBin instance?`);
  }
  if (parsed.status !== 0) {
    throw new Error(parsed.message ?? "PrivateBin rejected the paste");
  }
  return parsed;
}

/** Encrypt `text` locally and store the ciphertext on the configured instance. */
export async function createPaste(
  text: string,
  options: CreatePasteOptions = {},
): Promise<CreatedPaste> {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_PASTE_BYTES) {
    throw new Error(
      `Note is ${(bytes / 1024 / 1024).toFixed(1)} MB — too large to share (limit ${MAX_PASTE_BYTES / 1024 / 1024} MB).`,
    );
  }

  const { payload, key } = encryptPaste(text, options);
  const created = await postJson(payload);
  if (!created.id || !created.deletetoken) {
    throw new Error("PrivateBin did not return a paste id — cannot build a link");
  }

  return {
    pasteId: created.id,
    deleteToken: created.deletetoken,
    url: pasteUrl(instanceUrl(), created.id, key),
  };
}

/**
 * Revoke a paste before it is read. Tolerates an already-gone paste, since a
 * burn-after-reading paste that the recipient opened is *supposed* to be gone
 * and revoking it afterwards is not an error worth surfacing.
 */
export async function deletePaste(pasteId: string, deleteToken: string): Promise<void> {
  try {
    await postJson({ pasteid: pasteId, deletetoken: deleteToken });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not found|does not exist|404|expired|unknown paste/i.test(message)) return;
    throw err;
  }
}
