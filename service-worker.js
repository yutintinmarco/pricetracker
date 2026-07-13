const CACHE_NAME = "barcode-price-tracker-v68-clean-home-toolbar";
const ASSET_VERSION = "v68";

const APP_SHELL = [
  "./",
  "./index.html",
  `./firebase-config.js?v=${ASSET_VERSION}`,
  `./cloud-profile-service.js?v=${ASSET_VERSION}`,
  `./firebase-service.js?v=${ASSET_VERSION}`,
  `./cloud-sync-service.js?v=${ASSET_VERSION}`,
  `./cloud-image-service.js?v=${ASSET_VERSION}`,
  `./schema-service.js?v=${ASSET_VERSION}`,
  `./data-service.js?v=${ASSET_VERSION}`,
  `./backup-service.js?v=${ASSET_VERSION}`,
  `./image-store.js?v=${ASSET_VERSION}`,
  `./manifest.webmanifest?v=${ASSET_VERSION}`,
  `./icon.svg?v=${ASSET_VERSION}`
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

  // Firebase CDN and other cross-origin resources are handled by the browser.
  if (url.origin !== self.location.origin) return;

  // Explicit cache-busting navigation always goes directly to the network.
  if (url.searchParams.has("nocache")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(networkFirst(request, ["./index.html", "./"]));
    return;
  }

  // App code and configuration must be network-first. This prevents a new
  // index.html from running against an older cached firebase-service.js.
  const appCode =
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "manifest" ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".webmanifest");

  if (appCode) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request, fallbackKeys = []) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const exact = await cache.match(request);
    if (exact) return exact;

    for (const key of fallbackKeys) {
      const fallback = await cache.match(key);
      if (fallback) return fallback;
    }

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
