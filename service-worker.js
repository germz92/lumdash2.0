// Minimal service worker with no caching
const CACHE_NAME = "event-dashboard-no-cache";

self.addEventListener("install", (event) => {
  self.skipWaiting(); // Activate this version immediately
  console.log('Service worker installed - no caching active');
});

self.addEventListener("activate", (event) => {
  // Clear any existing caches
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          console.log("Deleting cache:", cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      console.log("All caches cleared - no caching active");
      return self.clients.claim();
    })
  );
});

// Fetch event - don't cache anything, always use network
self.addEventListener("fetch", (event) => {
  // Let the browser handle all requests normally
  // This disables any service worker caching
  console.log("Service worker fetch event for:", event.request.url);
  
  // Important: Pass through the request to the network
  event.respondWith(fetch(event.request));
});

// Handle push notifications
self.addEventListener('push', function(event) {
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: `assets/favicon.png`,
    badge: `assets/favicon.png`,
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});

// Handle PWA visibility changes to save page state
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'PAGE_VISIBILITY_CHANGE') {
    // The main app will send us visibility changes
    // We can use this to trigger page state saves
    console.log('[SW] Page visibility changed:', event.data.hidden);
  }
});
