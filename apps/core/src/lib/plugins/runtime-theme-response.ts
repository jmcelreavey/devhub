/** WebKit probes media with byte ranges before it will decode a sound. */
export function runtimeThemeResponse(bytes: Uint8Array, mime: string, range: string | null): Response {
  const headers = new Headers({
    "Content-Type": mime,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Accept-Ranges": "bytes",
  });
  if (range === null) {
    headers.set("Content-Length", String(bytes.length));
    return new Response(new Uint8Array(bytes), { headers });
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const first = match?.[1] ? Number(match[1]) : undefined;
  const last = match?.[2] ? Number(match[2]) : undefined;
  const start = first ?? Math.max(0, bytes.length - (last ?? 0));
  const end = first === undefined || last === undefined ? bytes.length - 1 : Math.min(last, bytes.length - 1);
  if (!match || (first === undefined && last === undefined) || (first === undefined && last === 0)
    || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || (first !== undefined && !Number.isSafeInteger(first)) || (last !== undefined && !Number.isSafeInteger(last))
    || start < 0 || start >= bytes.length || end < start) {
    headers.set("Content-Range", `bytes */${bytes.length}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers });
}
