/** Screen changes belong to a browser action. Agents receive links they can report. */
export function hasBrowserNavigationIntent(headers: Headers): boolean {
  return headers.get("sec-fetch-site") === "same-origin" && headers.get("x-devhub-client") !== "mcp";
}
