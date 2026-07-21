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
    <div style={{ ...bannerBase, top: 12, background: "#1E293B", color: "#F8FAFC", fontSize: 13, fontWeight: 600, fontFamily: "system-ui,sans-serif" }}>
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
export function UpdateToast({ registration }) {
  const [show, setShow] = useState(false);
  const regRef = useRef(registration);

  useEffect(() => {
    regRef.current = registration;
    if (!registration) return;
    if (registration.waiting) { setShow(true); return; }
    const onUpdate = () => { if (registration.waiting) setShow(true); };
    const onFound = () => {
      registration.installing?.addEventListener("statechange", onUpdate);
    };
    registration.addEventListener("updatefound", onFound);
    return () => {
      registration.removeEventListener("updatefound", onFound);
      registration.installing?.removeEventListener("statechange", onUpdate);
    };
  }, [registration]);

  const reload = () => {
    regRef.current?.waiting?.postMessage({ type: "SKIP_WAITING" });
    navigator.serviceWorker.addEventListener(
      "controllerchange", () => window.location.reload(), { once: true }
    );
  };

  if (!show) return null;

  return (
    <div style={{
      ...bannerBase,
      bottom: "calc(80px + env(safe-area-inset-bottom, 0px))",
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
      <span style={{ flex: 1 }}>New version available</span>
      <button onClick={reload} style={{
        background: "#0EA5E9", color: "#fff", border: "none",
        padding: "6px 14px", borderRadius: 8, fontSize: 12,
        fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
        fontFamily: "system-ui,sans-serif",
      }}>Reload</button>
      <button onClick={() => setShow(false)} style={{
        background: "none", border: "none", color: "#64748B",
        cursor: "pointer", padding: 4, lineHeight: 1,
      }} aria-label="Dismiss">✕</button>
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
      bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
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
   Contains only OfflineBanner + UpdateToast.
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
    </>
  );
}
