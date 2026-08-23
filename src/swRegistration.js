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
/* An update that arrived in an EARLIER session is applied here, silently, with
 * no prompt.
 *
 * The prompt exists so the app never reloads under someone mid-task — a good
 * rule during a session, and the wrong one at startup, where nothing is in
 * progress. Without this there is no floor on how stale a client may get: a user
 * who dismissed the prompt once (or whose reload lost the activation race) could
 * keep running a weeks-old bundle forever, quietly missing every fix shipped
 * since. That is not hypothetical — it is how a deployed fix reached the server
 * but never reached the people hitting the bug.
 *
 * Safe precisely because it is startup: no form is half-filled, no modal is
 * open, and the page has not rendered yet, so activation costs the user nothing.
 * `waiting` is only ever set by a worker that already downloaded and installed
 * in a previous visit — this starts nothing new and makes no request. */
function activateWaitingFromLastSession(reg) {
  if (!reg) return;
  // register() can resolve before the browser has attached an existing waiting
  // worker, so checking once here misses it. serviceWorker.ready settles after
  // the registration is fully populated — check both, and take whichever finds
  // it first (applyWaiting is idempotent).
  applyWaiting(reg);
  navigator.serviceWorker.ready.then(applyWaiting).catch(() => {});
}

let applied = false;
function applyWaiting(reg) {
  if (applied || !reg?.waiting) return;
  // The controller swap does not reload the page by itself, and the shell that
  // is already parsed came from the old bundle — so take the reload too. It is
  // an unnoticeable one at startup, before anything is on screen.
  applied = true;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  }, { once: true });
  reg.waiting.postMessage({ type: "SKIP_WAITING" });
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  if (!registration) {
    registration = navigator.serviceWorker.register(SW_URL, SW_OPTIONS).then((reg) => {
      activateWaitingFromLastSession(reg);
      return reg;
    }).catch((err) => {
      console.warn(`[pwa] service worker registration failed for ${SW_URL}:`, err);
      registration = null; // let a later caller retry
      return null;
    });
  }
  return registration;
}
