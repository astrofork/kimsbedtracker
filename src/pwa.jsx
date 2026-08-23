import React, { useState, useEffect, useRef } from "react";

// ── Shared banner base ────────────────────────────────────────────────────────
// left:50% + translateX(-50%) + maxWidth keeps banners centred and
// constrained to the 480px app width on both mobile and wide desktop.
// Use slideUpCentered (not slideUp) — the centring transform: translateX(-50%) must
// live INSIDE the keyframe, otherwise the animation's translateY overwrites it and
// the banner ends up positioned at left:50% with no horizontal correction,
// rendering off-screen to the right on mobile.
const bannerBase = {
  position: "fixed",
  left: "50%", transform: "translate(-50%, 0)",
  width: "calc(100% - 32px)", maxWidth: 448,
  zIndex: 9999,
  borderRadius: 14, padding: "12px 16px",
  display: "flex", alignItems: "center", gap: 12,
  boxShadow: "0 4px 20px rgba(0,0,0,.15)",
  animation: "slideUpCentered .3s cubic-bezier(.2,.7,.3,1) both",
};

/* ── Shared: apply a pending update, then reload ──────────────────────────────
   A plain location.reload() is NOT enough to pick up a new deploy. When a new
   service worker is waiting, reloading keeps the OLD worker in control, so the
   page comes back running the same stale bundle it started with — the user sees
   a spinner and nothing changes.

   skipWaiting() is what actually swaps the controller: per the Activate
   algorithm, a worker activated with the skip-waiting flag set claims the
   clients the old worker controlled and fires `controllerchange` on them. (This
   is why the Reload button below works even though sw.js never calls
   clients.claim() — claim() is only needed for the first-ever install, where
   there is no previous controller to inherit from.)

   The timer is a belt-and-braces fallback: if `controllerchange` never arrives
   — no waiting worker races in, the message is dropped, an engine disagrees —
   the user still gets their refresh instead of a spinner that never resolves. */
export function reloadWithPendingUpdate(registration, onFailed) {
  let done = false;
  const go = () => { if (!done) { done = true; window.location.reload(); } };

  const waiting = registration?.waiting;
  if (!waiting || !("serviceWorker" in navigator)) { go(); return; }

  // Reload ONLY once the new worker is genuinely in charge. The previous version
  // also reloaded on a blind 2s timer, and that was the whole bug: on a slow or
  // busy device the timer won round, the page reloaded with the OLD worker still
  // controlling, the new one stayed `waiting` — so the update never applied and
  // the prompt reappeared. Tapping it again just re-ran the same race, which is
  // how a shipped fix could sit undelivered indefinitely.
  const settle = () => { cleanup(); go(); };
  const onControllerChange = () => settle();
  const onStateChange = () => { if (waiting.state === "activated") settle(); };
  function cleanup() {
    clearTimeout(timer);
    navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    waiting.removeEventListener("statechange", onStateChange);
  }

  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
  waiting.addEventListener("statechange", onStateChange);
  waiting.postMessage({ type: "SKIP_WAITING" });

  // Last resort, and deliberately NOT a reload: if the worker never takes over,
  // reloading changes nothing and would only spin the user through the same
  // prompt again. Say so instead and leave them on a working page.
  const timer = setTimeout(() => {
    if (done) return;
    cleanup();
    if (waiting.state === "activated" || navigator.serviceWorker.controller !== null && registration.active === waiting) go();
    else onFailed?.();
  }, 10000);
}

/* ── 1. Offline Banner ───────────────────────────────────────────────────────
   Slides in at the TOP whenever navigator.onLine is false.
   Auto-hides when connection returns.                                         */
export function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const on  = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online",  on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!offline) return null;

  return (
    <div style={{ ...bannerBase, top: "calc(var(--safe-top, 0px) + 12px)", background: "#1E293B", color: "#F8FAFC", fontSize: 13, fontWeight: 600, fontFamily: "system-ui,sans-serif" }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fb7185"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <line x1="1" y1="1" x2="23" y2="23"/>
        <path d="M16.7 16.7A8 8 0 0 0 5 5"/>
        <path d="M6.9 6.9A14 14 0 0 0 2 12c3 3.3 7 5 10 5"/>
        <path d="M10.7 10.7A4 4 0 0 1 15 15"/>
        <circle cx="12" cy="20" r="1"/>
      </svg>
      <span style={{ flex: 1 }}>You're offline — showing cached data</span>
    </div>
  );
}

/* ── 2. Update Toast ─────────────────────────────────────────────────────────
   Shown when a new service worker is waiting to activate.
   "Reload" sends SKIP_WAITING then refreshes the page.                       */
/* Dismissal is remembered against the specific waiting worker, not "forever".
 *
 * It used to live in component state, which died on remount — PwaManager is
 * rendered separately for Login and for each role (main.jsx), so simply logging
 * in brought the prompt straight back. The opposite failure is worse: a plain
 * "don't ask again" would opt that user out of every future fix, with no floor
 * on how stale they get. Keying it to the worker's script URL silences THIS
 * build while a genuinely newer one still asks.
 *
 * sessionStorage, not localStorage: it must not outlive the tab. Anything
 * dismissed here is applied on next launch by activateWaitingFromLastSession. */
const DISMISS_KEY = "pwa_update_dismissed";
function dismissedVersion() {
  try { return sessionStorage.getItem(DISMISS_KEY); } catch { return null; }
}
function rememberDismissal(v) {
  try { if (v) sessionStorage.setItem(DISMISS_KEY, v); } catch { /* private mode */ }
}

export function UpdateToast({ registration }) {
  const [show, setShow] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const regRef = useRef(registration);

  useEffect(() => {
    regRef.current = registration;
    if (!registration) return;
    const notDismissed = (w) => !!w && w.scriptURL !== dismissedVersion();
    if (notDismissed(registration.waiting)) { setShow(true); return; }
    const onUpdate = () => { if (notDismissed(registration.waiting)) setShow(true); };
    const onFound = () => {
      registration.installing?.addEventListener("statechange", onUpdate);
    };
    registration.addEventListener("updatefound", onFound);
    return () => {
      registration.removeEventListener("updatefound", onFound);
      registration.installing?.removeEventListener("statechange", onUpdate);
    };
  }, [registration]);

  // Shared with the pull-to-refresh gesture, so both routes to a refresh apply
  // a waiting worker the same way and can't drift apart.
  // Surfaces the failure instead of silently reloading into the same stale
  // bundle — see reloadWithPendingUpdate.
  // busy is never cleared on success on purpose: the page is about to reload, so
  // the button should stay pressed and spinning right up to the moment it goes.
  // Only a genuine failure releases it, and then the label says so.
  const reload = () => {
    if (busy) return;
    setFailed(false); setBusy(true);
    reloadWithPendingUpdate(regRef.current, () => { setBusy(false); setFailed(true); });
  };

  if (!show) return null;

  return (
    <div style={{
      ...bannerBase,
      bottom: "calc(80px + var(--safe-bottom, 0px))",
      background: "#0F172A", color: "#F8FAFC",
      fontSize: 13, fontWeight: 600, fontFamily: "system-ui,sans-serif", gap: 10,
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
        <path d="M21 3v5h-5"/>
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
        <path d="M3 21v-5h5"/>
      </svg>
      <span style={{ flex: 1 }}>
        {busy ? "Updating…" : failed ? "Update didn't apply — try again" : "New version available"}
      </span>
      <button className="upd-btn" onClick={reload} disabled={busy} aria-busy={busy || undefined}>
        {busy && <span className="dc-spinner" aria-hidden="true" />}
        {busy ? "Updating…" : "Reload"}
      </button>
      <button className="upd-x" disabled={busy}
        onClick={() => { rememberDismissal(regRef.current?.waiting?.scriptURL); setShow(false); }}
        aria-label="Dismiss">✕</button>
    </div>
  );
}

/* ── 2b. Pull to Refresh ─────────────────────────────────────────────────────
   The installed app runs `display: standalone` (public/manifest.json) — no
   address bar, no reload button — and styles.css sets `overscroll-behavior:none`
   on html/body/#root, which disables the browser's own pull-to-refresh. Between
   those two there is NO way for a phone user to refresh at all. This restores
   the gesture without giving back the rubber-band glow that setting removes.

   Deliberately a manual gesture, never automatic: a reload destroys every
   unsaved field in BedDetailSheet (IP, patient name, admission date, consultant
   — all local component state). Requiring a intentional 70px drag means it can't
   fire while someone is mid-admission, which an idle timer or a visibility hook
   could not promise. */
const PTR_THRESHOLD = 70;   // px of pull needed to arm a refresh
const PTR_MAX       = 110;  // px the indicator can travel
const PTR_SLOP      = 8;    // px of movement before we claim the gesture
const PTR_RESIST    = 0.5;  // finger travel → indicator travel, for a rubber feel

/** True when the touch began inside something that scrolls and is NOT at its own
 *  top — a modal's .sheet, a horizontally scrolling table. Pulling there means
 *  "scroll this", not "refresh the page". */
function insideScrolledContainer(target) {
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    if (!(el instanceof Element)) continue;
    if (el.scrollTop > 0) return true;
  }
  return false;
}

export function PullToRefresh({ registration }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const active = useRef(false);
  // Mirrors `pull` so touchend can read the current distance without doing work
  // inside a setState updater — updaters must stay pure, or a double-invoke
  // (StrictMode, or a future concurrent render) would fire the reload twice.
  const pullRef = useRef(0);
  const setPullBoth = (v) => { pullRef.current = v; setPull(v); };
  const regRef = useRef(registration);
  useEffect(() => { regRef.current = registration; }, [registration]);

  useEffect(() => {
    // Touch only. Desktop keeps Ctrl/Cmd+R and its window chrome, and adding a
    // drag handler there would fight text selection for no benefit.
    if (!("ontouchstart" in window) && !navigator.maxTouchPoints) return;

    const onStart = (e) => {
      if (refreshing) return;
      // Multi-touch is a pinch-zoom, not a pull.
      if (e.touches.length !== 1) { active.current = false; return; }
      // Only from the very top of the page — the app scrolls the window
      // (see useScrollRestore), so scrollY is the whole story.
      if (window.scrollY > 0) { active.current = false; return; }
      // An open modal usually means an open form; refreshing under it would
      // throw away what the user is in the middle of typing.
      if (document.querySelector(".overlay")) { active.current = false; return; }
      if (insideScrolledContainer(e.target)) { active.current = false; return; }
      startY.current = e.touches[0].clientY;
      active.current = true;
    };

    const onMove = (e) => {
      if (!active.current || refreshing || startY.current == null) return;
      // Scrolled away from the top mid-gesture, or a second finger landed —
      // hand the gesture back to the browser.
      if (window.scrollY > 0 || e.touches.length !== 1) {
        active.current = false; setPullBoth(0); return;
      }
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= PTR_SLOP) { setPullBoth(0); return; }
      // Claim the gesture only once it's clearly a downward pull, so ordinary
      // upward scrolling from the top is never swallowed. Requires a
      // non-passive listener, which is why these are attached by hand.
      if (e.cancelable) e.preventDefault();
      setPullBoth(Math.min(PTR_MAX, (dy - PTR_SLOP) * PTR_RESIST));
    };

    const onEnd = () => {
      if (!active.current || refreshing) { setPullBoth(0); return; }
      active.current = false;
      startY.current = null;
      if (pullRef.current >= PTR_THRESHOLD) {
        setPullBoth(PTR_THRESHOLD);   // hold the indicator up while the reload runs
        setRefreshing(true);
        // Applies a waiting service worker first — without that the reload would
        // come back on the same stale bundle. See reloadWithPendingUpdate.
        reloadWithPendingUpdate(regRef.current);
      } else {
        setPullBoth(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [refreshing]);

  if (pull <= 0 && !refreshing) return null;

  const armed = pull >= PTR_THRESHOLD;
  const progress = Math.min(1, pull / PTR_THRESHOLD);

  return (
    <div style={{
      position: "fixed",
      top: "calc(var(--safe-top, 0px) + 8px)",
      left: "50%",
      transform: `translate(-50%, ${pull - PTR_THRESHOLD}px)`,
      zIndex: 9998,
      width: 38, height: 38, borderRadius: "50%",
      background: "var(--panel, #fff)",
      border: "1px solid var(--line, #E2E8F0)",
      boxShadow: "0 4px 16px rgba(0,0,0,.15)",
      display: "flex", alignItems: "center", justifyContent: "center",
      // No transition while the finger is down — the indicator must track it
      // exactly; only the spring-back after release is animated.
      transition: active.current ? "none" : "transform .2s cubic-bezier(.2,.7,.3,1)",
      pointerEvents: "none",
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke={armed || refreshing ? "#0EA5E9" : "var(--ink-3, #94A3B8)"}
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        style={{
          // Before the threshold the arrow winds up with the pull; after it,
          // it spins — so "far enough" is legible without reading any text.
          animation: refreshing ? "spin .7s linear infinite" : "none",
          transform: refreshing ? "none" : `rotate(${progress * 270}deg)`,
          opacity: 0.4 + progress * 0.6,
        }}>
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
    </div>
  );
}

/* ── 3. Install Banner ───────────────────────────────────────────────────────
   Rendered directly inside Login.jsx — NOT in PwaManager.
   Behaviour:
     • Android/desktop: captures beforeinstallprompt, shows "Install" button.
     • iOS Safari: shows "Tap Share → Add to Home Screen" tip.
     • No localStorage — dismissal is session-only (React state).
       The banner disappears naturally when the user logs in because the
       Login component unmounts.
     • Never shows if already running in standalone (installed) mode.       */

function isIosSafari() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/chrome|crios|fxios/i.test(ua);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;
}

export function InstallBanner() {
  const [promptEvt, setPromptEvt] = useState(null);
  const [showIos,   setShowIos]   = useState(false);
  const [hidden,    setHidden]    = useState(false); // session-only hide via ✕

  useEffect(() => {
    if (isStandalone()) return;

    const handler = (e) => { e.preventDefault(); setPromptEvt(e); };
    window.addEventListener("beforeinstallprompt", handler);

    if (isIosSafari()) setShowIos(true);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const install = async () => {
    if (!promptEvt) return;
    promptEvt.prompt();
    const { outcome } = await promptEvt.userChoice;
    if (outcome === "accepted") setPromptEvt(null);
    // if declined, keep banner so user can try again later
  };

  if (isStandalone() || hidden)       return null;
  if (!promptEvt && !showIos)         return null;

  return (
    <div style={{
      ...bannerBase,
      // Login page has no navbar — sit 16px above the safe-area bottom
      bottom: "calc(16px + var(--safe-bottom, 0px))",
      background: "var(--panel, #fff)",
      border: "1px solid var(--line, #E2E8F0)",
      color: "var(--ink, #0F172A)",
      fontSize: 13,
      fontFamily: "system-ui,sans-serif",
      boxShadow: "0 4px 24px rgba(14,165,233,.15)",
    }}>
      <img src="/icons/icon-192.png" alt=""
           style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Install BedFlow</div>
        <div style={{ color: "var(--ink-2, #64748B)", fontSize: 12 }}>
          {promptEvt
            ? "Add to Home Screen for the best experience"
            : <>Tap <b>Share</b> → <b>Add to Home Screen</b></>}
        </div>
      </div>
      {promptEvt && (
        <button onClick={install} style={{
          background: "#0EA5E9", color: "#fff", border: "none",
          padding: "7px 14px", borderRadius: 9, fontSize: 12,
          fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
          fontFamily: "system-ui,sans-serif",
          boxShadow: "0 2px 8px rgba(14,165,233,.30)",
        }}>Install</button>
      )}
      {/* ✕ hides for this session only — no localStorage */}
      <button onClick={() => setHidden(true)} style={{
        background: "none", border: "none",
        color: "var(--ink-3, #94A3B8)", cursor: "pointer",
        padding: 4, lineHeight: 1, flexShrink: 0,
      }} aria-label="Dismiss">✕</button>
    </div>
  );
}

/* ── PwaManager — mounted on every app page (NOT login) ─────────────────────
   Contains OfflineBanner + UpdateToast + PullToRefresh.
   InstallBanner is handled separately inside Login.jsx.                      */
export function PwaManager() {
  const [reg, setReg] = useState(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then(setReg).catch(() => {});
  }, []);

  return (
    <>
      <OfflineBanner />
      <UpdateToast registration={reg} />
      {/* Passed the same registration as UpdateToast: a pull-to-refresh must
          apply a waiting update, not just re-render the stale bundle. It stays
          useful with no update pending — it's then an ordinary reload, which is
          the only one a standalone PWA otherwise has no affordance for. */}
      <PullToRefresh registration={reg} />
    </>
  );
}
