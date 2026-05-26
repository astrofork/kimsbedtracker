import React, { useState, useEffect, useRef } from "react";

// ── Shared slide-in style ─────────────────────────────────────────────────────
const bannerBase = {
  position: "fixed", left: "50%", transform: "translateX(-50%)",
  zIndex: 9999, maxWidth: 440, width: "calc(100% - 32px)",
  borderRadius: 14, padding: "12px 16px",
  display: "flex", alignItems: "center", gap: 12,
  boxShadow: "0 4px 20px rgba(0,0,0,.18)",
  animation: "slideUp .3s cubic-bezier(.2,.7,.3,1) both",
};

/* ── 1. Offline Banner ───────────────────────────────────────────────────────
   Appears at the top whenever navigator.onLine is false.
   Auto-hides when connection returns.                                         */
export function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const on  = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  if (!offline) return null;

  return (
    <div style={{
      ...bannerBase,
      top: 12,
      background: "#1E293B",
      color: "#F8FAFC",
      fontSize: 13,
      fontWeight: 600,
      fontFamily: "system-ui, sans-serif",
    }}>
      {/* wifi-off icon */}
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
   Shown when a new service worker is waiting.
   "Reload" sends SKIP_WAITING then refreshes.                                */
export function UpdateToast({ registration }) {
  const [show, setShow] = useState(false);
  const regRef = useRef(registration);

  useEffect(() => {
    regRef.current = registration;
    if (!registration) return;

    // Already a waiting worker when we mounted
    if (registration.waiting) { setShow(true); return; }

    // Or a new worker arrives later
    const onUpdate = () => { if (registration.waiting) setShow(true); };
    registration.addEventListener("updatefound", () => {
      registration.installing?.addEventListener("statechange", onUpdate);
    });
  }, [registration]);

  const reload = () => {
    regRef.current?.waiting?.postMessage({ type: "SKIP_WAITING" });
    // Wait for the new SW to take control, then reload
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
  };

  if (!show) return null;

  return (
    <div style={{
      ...bannerBase,
      bottom: 90,
      background: "#0F172A",
      color: "#F8FAFC",
      fontSize: 13,
      fontWeight: 600,
      fontFamily: "system-ui, sans-serif",
      gap: 10,
    }}>
      {/* refresh icon */}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
        <path d="M21 3v5h-5"/>
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
        <path d="M3 21v-5h5"/>
      </svg>
      <span style={{ flex: 1 }}>New version available</span>
      <button
        onClick={reload}
        style={{
          background: "#0EA5E9", color: "#fff", border: "none",
          padding: "6px 14px", borderRadius: 8, fontSize: 12,
          fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Reload
      </button>
      <button
        onClick={() => setShow(false)}
        style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", padding: 4, lineHeight: 1 }}
        aria-label="Dismiss"
      >✕</button>
    </div>
  );
}

/* ── 3. Install Banner ───────────────────────────────────────────────────────
   Android / Desktop: captures beforeinstallprompt, shows "Add to Home Screen".
   iOS Safari:        shows tap-Share instructions once, dismissible.
   Stores dismissal so it never nags again.                                   */
const DISMISS_KEY = "pwa_install_dismissed";

function isIosSafari() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/chrome|crios|fxios/i.test(ua);
}

function isInStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

export function InstallBanner() {
  const [promptEvt, setPromptEvt]   = useState(null); // Android/desktop
  const [showIos,   setShowIos]     = useState(false);
  const [dismissed, setDismissed]   = useState(() => !!localStorage.getItem(DISMISS_KEY));

  useEffect(() => {
    if (dismissed || isInStandalone()) return;

    // Android / Chrome desktop
    const handler = (e) => { e.preventDefault(); setPromptEvt(e); };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS Safari — show tip if not yet dismissed
    if (isIosSafari()) setShowIos(true);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [dismissed]);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
    setPromptEvt(null);
    setShowIos(false);
  };

  const install = async () => {
    if (!promptEvt) return;
    promptEvt.prompt();
    const { outcome } = await promptEvt.userChoice;
    if (outcome === "accepted") dismiss();
    else setPromptEvt(null);
  };

  // Nothing to show
  if (dismissed || isInStandalone()) return null;
  if (!promptEvt && !showIos)        return null;

  return (
    <div style={{
      ...bannerBase,
      bottom: 90,
      background: "var(--panel, #fff)",
      border: "1px solid var(--line, #E2E8F0)",
      color: "var(--ink, #0F172A)",
      fontSize: 13,
      fontFamily: "system-ui, sans-serif",
      boxShadow: "0 4px 24px rgba(14,165,233,.15)",
    }}>
      <img
        src="/icons/icon-192.png"
        alt=""
        style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>BedFlow</div>
        {promptEvt ? (
          <div style={{ color: "var(--ink-2, #64748B)", fontSize: 12 }}>
            Add to Home Screen for the best experience
          </div>
        ) : (
          <div style={{ color: "var(--ink-2, #64748B)", fontSize: 12 }}>
            Tap <b>Share</b> → <b>Add to Home Screen</b>
          </div>
        )}
      </div>
      {promptEvt && (
        <button
          onClick={install}
          style={{
            background: "#0EA5E9", color: "#fff", border: "none",
            padding: "7px 14px", borderRadius: 9, fontSize: 12,
            fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
            fontFamily: "system-ui, sans-serif",
            boxShadow: "0 2px 8px rgba(14,165,233,.35)",
          }}
        >
          Install
        </button>
      )}
      <button
        onClick={dismiss}
        style={{ background: "none", border: "none", color: "var(--ink-3, #94A3B8)", cursor: "pointer", padding: 4, lineHeight: 1, flexShrink: 0 }}
        aria-label="Dismiss"
      >✕</button>
    </div>
  );
}

/* ── PwaManager — mount once in main.jsx ────────────────────────────────────*/
export function PwaManager() {
  const [reg, setReg] = useState(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // vite-plugin-pwa registers the SW; we just grab the registration for the update toast
    navigator.serviceWorker.ready.then(setReg).catch(() => {});
  }, []);

  return (
    <>
      <OfflineBanner />
      <UpdateToast registration={reg} />
      <InstallBanner />
    </>
  );
}
