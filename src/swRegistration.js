/* Single source of truth for registering the service worker.
 *
 * The URL differs between dev and prod, which is easy to get wrong:
 *   • Production build → vite-plugin-pwa emits the real Workbox worker as
 *     /sw.js (`filename: "sw.js"` in vite.config.js), a classic script.
 *   • Dev server       → there is no /sw.js. The plugin serves a dev worker at
 *     /dev-sw.js?dev-sw, and because devOptions.type is "module" it MUST be
 *     registered with { type: "module" }.
 *
 * Registering "/sw.js" in dev doesn't fail loudly — Vite's SPA fallback answers
 * with index.html, and the browser rejects it for having a text/html MIME type.
 * The page then has no controlling service worker at all, which silently costs
 * you the install prompt (Chrome won't fire beforeinstallprompt without one),
 * offline support, and push. Keeping the URL in one place is what stops that
 * from drifting back.
 *
 * The registration is also memoized. main.jsx registers on load and push.js
 * registers again after login; both now share one in-flight promise instead of
 * calling navigator.serviceWorker.register() twice for the same scope.
 */

export const SW_URL = import.meta.env.DEV ? "/dev-sw.js?dev-sw" : "/sw.js";
const SW_OPTIONS = import.meta.env.DEV ? { type: "module" } : { type: "classic" };

let registration = null;

/** Resolves to the ServiceWorkerRegistration, or null if unsupported/failed.
 *  Never throws — callers treat "no service worker" as a degraded but working
 *  app (the UI must not break just because push or offline is unavailable). */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  if (!registration) {
    registration = navigator.serviceWorker.register(SW_URL, SW_OPTIONS).catch((err) => {
      console.warn(`[pwa] service worker registration failed for ${SW_URL}:`, err);
      registration = null; // let a later caller retry
      return null;
    });
  }
  return registration;
}
