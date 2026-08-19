/* Service worker for MAKOTI TRADERS PWA
 *
 * Strategy:
 * - Navigations (HTML): network-first, falling back to the cached app shell so the
 *   app still opens offline.
 * - Same-origin static assets: cache-first (build files are content-hashed, so a
 *   bump of CACHE_NAME on deploy invalidates stale entries).
 * - Cross-origin requests (Deriv WS API, GTM, LiveChat, fonts, CDNs): never touched,
 *   always go straight to the network.
 */
const CACHE_NAME = 'makoti-traders-v1';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(['./', './manifest.webmanifest']))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Only cache full (200) responses — 206 partials can't be cached.
                    if (response.status === 200) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
                    }
                    return response;
                })
                .catch(() => caches.match(request).then((cached) => cached || caches.match('./')))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
                // Range requests (videos, wasm) come back as 206 — skip them.
                if (response.status === 200) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
                }
                return response;
            });
        })
    );
});
