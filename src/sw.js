import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute }                                      from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate, CacheFirst }                      from "workbox-strategies";
import { ExpirationPlugin }                                                    from "workbox-expiration";
import { BackgroundSyncPlugin }                                                from "workbox-background-sync";

// ── Precache all Vite-built assets (manifest injected by vite-plugin-pwa) ───
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── Navigation: serve app shell; fully offline via offline.html fallback ─────
const appShellHandler = createHandlerBoundToURL("/index.html");
const navigationRoute  = new NavigationRoute(appShellHandler, {
  denylist: [/^\/offline\.html$/, /^\/api\//],
});
registerRoute(navigationRoute);

// ── API calls: NetworkFirst with 6 s timeout ─────────────────────────────────
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  new NetworkFirst({
    cacheName: "bedflow-api",
    networkTimeoutSeconds: 6,
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 5 * 60 }), // 5 min
    ],
  })
);

// ── Google Fonts stylesheets: StaleWhileRevalidate ───────────────────────────
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new StaleWhileRevalidate({ cacheName: "google-fonts-stylesheets" })
);

// ── Google Fonts files: CacheFirst (30 days) ─────────────────────────────────
registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "google-fonts-webfonts",
    plugins: [
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
);

// ── App icons & static images: CacheFirst ────────────────────────────────────
registerRoute(
  ({ url }) => url.pathname.startsWith("/icons/"),
  new CacheFirst({
    cacheName: "bedflow-icons",
    plugins: [
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
);

// ── Skip-waiting: triggered by update notification UI ────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// ── Push notifications (preserved from original sw.js) ───────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data.json(); } catch { data = { title: "BedFlow", body: event.data?.text() || "" }; }
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || "bedflow",
    requireInteraction: !!data.requireInteraction,
    renotify: true,
    vibrate: data.alarm ? [400, 150, 400, 150, 400] : [200],
    data: { url: "/" },
  };
  event.waitUntil(self.registration.showNotification(data.title || "BedFlow", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
