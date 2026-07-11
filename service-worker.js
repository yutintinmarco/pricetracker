const CACHE_NAME = "barcode-price-tracker-v53-task3b";
const APP_SHELL = [
  "./",
  "./index.html",
  "./firebase-config.js",
  "./cloud-profile-service.js",
  "./firebase-service.js",
  "./schema-service.js",
  "./data-service.js",
  "./backup-service.js",
  "./image-store.js",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const freshRequests = APP_SHELL.map(
        (url) => new Request(url, { cache: "reload" })
      );
      return cache.addAll(freshRequests);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Do not intercept Google Fonts, ZXing, Firebase, or any other cross-origin request.
  if (url.origin !== self.location.origin) return;

  // Explicit cache-busting URLs must always go straight to the network.
  if (url.searchParams.has("nocache")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  // HTML/navigation requests use network-first so a broken old index.html
  // cannot remain stuck in the cache after an update.
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Same-origin static assets use stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });

    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all([
        cache.put("./index.html", response.clone()),
        cache.put("./", response.clone())
      ]);
    }

    return response;
  } catch (error) {
    const cached =
      (await caches.match("./index.html")) ||
      (await caches.match("./"));

    if (cached) return cached;

    return new Response("App 暫時未能載入，請檢查網絡後再試。", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request, { cache: "no-cache" })
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || networkPromise || fetch(request);
}
