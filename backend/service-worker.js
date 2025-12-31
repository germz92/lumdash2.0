const CACHE_NAME = "event-dashboard-cache-v5";
const urlsToCache = [
  "/",
  "/index.html",
  "/dashboard.html",
  "/assets/logo.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting(); // 🔥 Immediately activate this version
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key); // 🔥 Delete old caches
          }
        })
      )
    )
  );
  self.clients.claim(); // 🔥 Take control of all pages
});

self.addEventListener("fetch", (event) => {
  // Skip caching for CSS files
  if (event.request.url.endsWith('.css')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
