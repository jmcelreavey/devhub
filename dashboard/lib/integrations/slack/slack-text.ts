/**
 * Turns Slack's wire format back into text a person wrote: `&amp;`/`&lt;`/`&gt;` entities, `<@U…>`
 * mentions, `<#C…|name>` channels, `<url|label>` and bare `<url>` links. Used before anything from a
 * message is saved (a task answer) so the note never holds Slack markup.
 */
export function normalizeSlackCommand(raw: string, botUserId: string): string {
  const leading = /^\s*<@([A-Z0-9]+)(?:\|[^>]*)?>\s*/.exec(raw);
  return leading?.[1] === botUserId ? raw.slice(leading[0].length) : raw;
}

export function unescapeSlackText(raw: string): string {
  return raw
    .replace(/<@([UW][A-Z0-9]+)(?:\|([^>]*))?>/g, (_match, id: string, name?: string) => `@${name?.trim() || id}`)
    .replace(/<#([CG][A-Z0-9]+)(?:\|([^>]*))?>/g, (_match, id: string, name?: string) => `#${name?.trim() || id}`)
    .replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]*))?>/g, (_match, label?: string) => label?.trim() || "@group")
    .replace(/<!date\^[^|>]*\|([^>]*)>/g, "$1")
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, "@$1")
    .replace(/<((?:https?|mailto|tel):[^|>\s]+)\|([^>]+)>/g, (_match, url: string, label: string) => {
      const target = url.replace(/^(?:mailto|tel):/, "");
      return label.trim() === target ? target : `${label.trim()} (${target})`;
    })
    .replace(/<((?:https?|mailto|tel):[^|>\s]+)>/g, (_match, url: string) => url.replace(/^(?:mailto|tel):/, ""))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const ACK_WORDS = new Set(["thanks", "thank", "thx", "ty", "cheers", "ok", "okay", "nice", "great", "cool", "perfect", "awesome", "ta"]);
const ACK_FILLER = new Set(["you", "so", "much", "very", "a", "lot", "again", "mate", "all"]);
const MAX_ACK_WORDS = 5;

/**
 * "thanks", "ok", "cheers", "thank you so much", or nothing but emoji / `:shortcodes:`. These carry
 * no request, so they must not become a task answer and must not cost a Jev or model call.
 */
export function isAcknowledgement(raw: string): boolean {
  const text = unescapeSlackText(raw).toLowerCase()
    .replace(/:[a-z0-9_+'-]+(?:::skin-tone-\d)?:/g, " ")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣]/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ").trim();
  if (!raw.trim()) return false;
  if (!text) return true;
  const words = text.split(" ");
  if (words.length > MAX_ACK_WORDS) return false;
  return words.some((word) => ACK_WORDS.has(word)) && words.every((word) => ACK_WORDS.has(word) || ACK_FILLER.has(word));
}
