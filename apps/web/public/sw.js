/* MICE AI Operations OS — minimal service worker (§18.16).
 * - App shell: network-first for navigations (falls back to cached index.html offline)
 * - Static assets: stale-while-revalidate
 * - /api/* is never cached (field-panel writes are queued in IndexedDB by the app itself,
 *   because iOS Safari has no Background Sync; the app flushes the queue on 'online').
 * - Web Push (§15): 'push' shows the notification (critical → requireInteraction, digest replaces the previous digest
 *   via tag); 'notificationclick' acknowledges a critical notification (signed ack link) and focuses / opens the decision inbox.
 */
const CACHE = 'mice-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-180.png', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

self.addEventListener('message', (event) => {
  // The page asks connected clients to flush the offline queue (e.g. after SW wakes up online).
  if (event.data === 'flush-queue') {
    self.clients.matchAll().then((clients) => clients.forEach((c) => c.postMessage('flush-queue')));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'MICE OS', body: event.data ? event.data.text() : '' };
  }
  const critical = data.priority === 'critical';
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';
  event.waitUntil(
    self.registration.showNotification(data.title || 'MICE OS', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      requireInteraction: critical,
      data: { url, ack: typeof data.ack === 'string' && data.ack.startsWith('/api/push/ack/') ? data.ack : null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  // §15: opening a critical notification acknowledges it (stops the WhatsApp / SMS fallback)
  const ack = event.notification.data && event.notification.data.ack;
  if (ack) fetch(ack, { method: 'POST' }).catch(() => {});
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          return c.focus().then((w) => (w && 'navigate' in w ? w.navigate(target) : w));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

// The browser rotated the subscription: re-subscribe needs the JWT, so let an open window redo it on next load.
self.addEventListener('pushsubscriptionchange', () => {
  self.clients.matchAll({ type: 'window' }).then((clients) => clients.forEach((c) => c.postMessage('push-resubscribe')));
});
