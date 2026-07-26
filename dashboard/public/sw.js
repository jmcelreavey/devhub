/*
 * DevHub service worker — offline-capable (R8).
 *
 * Replaces a pass-through worker that existed only to satisfy Chromium's
 * "installable PWA needs a fetch handler" rule. It cached nothing, so losing
 * the server gave a browser error page rather than the app.
 *
 * Strategy per request class, because one strategy for everything is how
 * service workers end up serving stale JavaScript against fresh HTML:
 *
 *   /_next/static/*   cache-first, permanently. These filenames are
 *                     content-hashed, so a changed file is a changed URL and
 *                     stale content is impossible by construction.
 *   navigations       network-first, falling back to the cached page, then to
 *                     the offline shell. You get the last-known page rather
 *                     than a browser error.
 *   GET /api/*        network-first with a cache fallback, tagged so the UI can
 *                     tell the data is stale.
 *   everything else   network, falling back to cache.
 *
 * Mutating requests are never cached or replayed. Silently re-sending a POST
 * the user believes failed is far worse than surfacing an error.
 */

const VERSION = "v2";
const STATIC_CACHE = `devhub-static-${VERSION}`;
const PAGES_CACHE = `devhub-pages-${VERSION}`;
const API_CACHE = `devhub-api-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const CURRENT_CACHES = new Set([STATIC_CACHE, PAGES_CACHE, API_CACHE]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES_CACHE);
      // Only the offline shell is precached. A precached route list would go
      // stale every time a route is added, and there are 35 of them.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" })).catch(() => {});
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions, or they accumulate forever.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("devhub-") && !CURRENT_CACHES.has(n))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Content-hashed build output: safe to serve from cache indefinitely. */
function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName, { tagStale = false } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(request);
    if (!hit) throw err;
    if (!tagStale) return hit;
    // Let the app distinguish last night's data from live data.
    const headers = new Headers(hit.headers);
    headers.set("X-DevHub-Stale", "1");
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never interfere with anything that changes state.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Server-sent events must stream, not be buffered through the Cache API —
  // this app uses SSE for live run logs and terminal output.
  if (request.headers.get("accept") === "text/event-stream") return;

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, PAGES_CACHE).catch(async () => {
        const cache = await caches.open(PAGES_CACHE);
        return (await cache.match(OFFLINE_URL)) ?? Response.error();
      }),
    );
    return;
  }

  if (isApi(url)) {
    event.respondWith(
      networkFirst(request, API_CACHE, { tagStale: true }).catch(
        () =>
          new Response(JSON.stringify({ error: "Offline and no cached copy of this request." }), {
            status: 503,
            headers: { "Content-Type": "application/json", "X-DevHub-Stale": "1" },
          }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(async () => {
      const hit = await caches.match(request);
      return hit ?? Response.error();
    }),
  );
});
