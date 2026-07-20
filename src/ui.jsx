import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";

export const Ic = ({ d, s = 22, style, className }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={style} className={className}>{d}</svg>
);

export const icons = {
  home: <><path d="M3 9.5 12 3l9 6.5" /><path d="M5 10v10h14V10" /></>,
  bed: <><path d="M2 7v12" /><path d="M22 11v8" /><path d="M2 11h20" /><path d="M2 15h20" /><circle cx="7" cy="9" r="1.6" /><path d="M10 11V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" /></>,
  map: <><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" /></>,
  bell: <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  check: <><path d="M20 6 9 17l-5-5" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
  chevron: <><path d="m9 18 6-6-6-6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  refresh: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  finger: <><path d="M12 11c0-1.5 1-2.5 2.5-2.5S17 9.5 17 11c0 4-1 6-2 7.5" /><path d="M7 11a5 5 0 0 1 10 0" /><path d="M9.5 14.5c0 2-.5 3.5-1.5 5" /><path d="M12 11v2c0 3-1 5-2 7" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></>,
  alert: <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>,
  // Half-filled circle — universal "appearance / theme" icon
  palette: <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" /></>,
  pencil: <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></>,
  camera: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" /><circle cx="12" cy="13" r="3.2" /></>,
  building: <><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  stethoscope: <><path d="M4 3v6a5 5 0 0 0 10 0V3" /><path d="M4 3H2.5M14 3h1.5" /><path d="M9 19a4 4 0 0 0 8 0v-3" /><circle cx="20" cy="13" r="2" /></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></>,
  banknote: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>,
  clipboard: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>,
  fileText: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2" /></>,
  share: <><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><path d="m8 7 4-4 4 4" /><path d="M12 3v13" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M8 17v-6M13 17V8M18 17v-3" /></>,
  layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>,
  eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M9.9 4.2A10 10 0 0 1 12 4c7 0 10 8 10 8a13.3 13.3 0 0 1-1.7 2.7M6.6 6.6A10 10 0 0 0 2 12s3 8 10 8a10 10 0 0 0 5.4-1.6" /><circle cx="12" cy="12" r="3" /><path d="m2 2 20 20" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></>,
  filter: <><path d="M3 4h18l-7 9v6l-4 2v-8L3 4Z" /></>,
  sort: <><path d="M11 5v14M11 5 7 9M11 5l4 4" /><path d="M19 5v14M19 19l-4-4M19 19l4-4" /></>,
  x: <><path d="M18 6 6 18M6 6l12 12" /></>,
  exchange: <><path d="m17 3 4 4-4 4" /><path d="M3 7h18" /><path d="m7 21-4-4 4-4" /><path d="M21 17H3" /></>,
  pill: <><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)" /><path d="m8.5 8.5 7 7" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 8h.01" /><path d="M12 11v5" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1" fill="currentColor" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  ban: <><circle cx="12" cy="12" r="9" /><path d="m5.7 5.7 12.6 12.6" /></>,
  bookmark: <><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" /></>,
  wallet: <><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></>,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8" /><path d="M7 3v5h8" /></>,

  // alphabets
  A: <><path d="M6 20 12 4l6 16" /><path d="M8.5 14h7" /></>,
  B: <><path d="M7 4v16" /><path d="M7 4h6a3 3 0 0 1 0 6H7" /><path d="M7 10h7a3 3 0 0 1 0 6H7" /></>,
  C: <><path d="M17 7a6 6 0 1 0 0 10" /></>,
  D: <><path d="M7 4v16" /><path d="M7 4h5a8 8 0 0 1 0 16H7" /></>,
  E: <><path d="M17 4H7v16h10" /><path d="M7 12h8" /></>,
  F: <><path d="M7 4v16" /><path d="M7 4h10" /><path d="M7 12h8" /></>,
  G: <><path d="M17 8a6 6 0 1 0 0 8" /><path d="M17 12h-4" /></>,
  H: <><path d="M7 4v16" /><path d="M17 4v16" /><path d="M7 12h10" /></>,
  I: <><path d="M12 4v16" /><path d="M8 4h8" /><path d="M8 20h8" /></>,
  J: <><path d="M17 4v12a4 4 0 0 1-8 0" /><path d="M13 4h4" /></>,
  K: <><path d="M7 4v16" /><path d="M17 4 7 13" /><path d="M11 10l6 10" /></>,
  L: <><path d="M7 4v16h10" /></>,
  M: <><path d="M5 20V4l7 8 7-8v16" /></>,
  N: <><path d="M7 20V4l10 16V4" /></>,
  O: <><circle cx="12" cy="12" r="8" /></>,
  P: <><path d="M7 20V4h6a4 4 0 1 1 0 8H7" /></>,
  Q: <><circle cx="12" cy="12" r="8" /><path d="m16 16 3 3" /></>,
  R: <><path d="M7 20V4h6a4 4 0 1 1 0 8H7" /><path d="m12 12 5 8" /></>,
  S: <><path d="M17 7a4 4 0 0 0-4-3 4 4 0 0 0-4 4c0 5 8 3 8 8a4 4 0 0 1-4 4 4 4 0 0 1-4-3" /></>,
  T: <><path d="M5 4h14" /><path d="M12 4v16" /></>,
  U: <><path d="M7 4v10a5 5 0 0 0 10 0V4" /></>,
  V: <><path d="M5 4 12 20 19 4" /></>,
  W: <><path d="M4 4 8 20 12 10 16 20 20 4" /></>,
  X: <><path d="M6 6 18 18" /><path d="M18 6 6 18" /></>,
  Y: <><path d="M6 4 12 12 18 4" /><path d="M12 12v8" /></>,
  Z: <><path d="M6 4h12L6 20h12" /></>,

  // Number


};

/* ── Modal / sheet helpers ────────────────────────────────────────────────── */

/**
 * Call inside any bottom-sheet/overlay component.
 * - Locks body scroll (iOS-safe: position:fixed + saved scroll offset)
 * - Closes on ESC key (desktop/keyboard users)
 * Cleanup runs automatically when the component unmounts.
 */
export function useModal(onClose) {
  // Body scroll lock
  useEffect(() => {
    const y = window.scrollY;
    document.body.style.top = `-${y}px`;
    document.body.classList.add("modal-open");
    return () => {
      document.body.classList.remove("modal-open");
      document.body.style.top = "";
      window.scrollTo(0, y);
    };
  }, []);

  // ESC key
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
}

/** Numbered pagination row with a ±2-page window and smart ellipsis. */
export function Pagination({ page, pages, onPage }) {
  if (!pages || pages <= 1) return null;
  const nums = [];
  const win = 2;
  const start = Math.max(1, page - win), end = Math.min(pages, page + win);
  if (start > 1) { nums.push(1); if (start > 2) nums.push("…l"); }
  for (let i = start; i <= end; i++) nums.push(i);
  if (end < pages) { if (end < pages - 1) nums.push("…r"); nums.push(pages); }
  const btn = (label, target, { disabled, active, key } = {}) => (
    <button key={key || label} disabled={disabled}
      onClick={() => !disabled && target != null && onPage(target)}
      className="chip" style={{
        minWidth: 36, justifyContent: "center", padding: "7px 11px", fontSize: 13,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1,
        background: active ? "var(--primary)" : "var(--panel)",
        color: active ? "#fff" : "var(--ink-2)",
        borderColor: active ? "var(--primary)" : "var(--line)",
      }}>{label}</button>
  );
  return (
    <div className="row" style={{ gap: 6, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
      {btn("‹ Prev", page - 1, { disabled: page <= 1, key: "prev" })}
      {nums.map((n, i) => typeof n === "string"
        ? <span key={n + i} className="dim" style={{ padding: "0 4px", alignSelf: "center" }}>…</span>
        : btn(String(n), n, { active: n === page, key: "p" + n }))}
      {btn("Next ›", page + 1, { disabled: page >= pages, key: "next" })}
    </div>
  );
}

/* ── Theme system ─────────────────────────────────────────────────────────── */
export const THEMES = ["dark", "light", "purple", "teal"];
export const T_LABEL = { dark: "Dark", light: "Light", purple: "Purple", teal: "Teal" };
export const T_COLOR = { dark: "#2dd4bf", light: "#2563EB", purple: "#7C3AED", teal: "#14B8A6" };
// moon for dark mode, sun for all light-based themes
const T_ICON = { dark: "moon", light: "sun", purple: "sun", teal: "sun" };

// theme-color = the topbar background so Android status bar matches the app UI
const T_META_COLOR = {
  dark: "#11181f",   // dark topbar
  light: "#FFFFFF",   // white topbar
  purple: "#FFFFFF",
  teal: "#FFFFFF",
};

export function getTheme() {
  return localStorage.getItem("app_theme") || "light";
}

export function applyTheme(t) {
  localStorage.setItem("app_theme", t);
  if (t === "dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", t);
  }
  // Keep the browser/status-bar colour in sync with the active topbar colour
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", T_META_COLOR[t]);
}

/** Call once before React renders to avoid flash-of-wrong-theme. */
export function initTheme() {
  applyTheme(getTheme());
}

/** Drop-in button — place in any topbar right-side row. */
export function ThemeToggle() {
  const [theme, setThemeState] = useState(getTheme);
  const [label, setLabel] = useState("");

  const cycle = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    applyTheme(next);
    setThemeState(next);
    // brief label pop
    setLabel(T_LABEL[next]);
    setTimeout(() => setLabel(""), 1400);
  };

  return (
    <button
      className="btn btn-ghost"
      style={{ padding: 9, position: "relative", overflow: "visible" }}
      onClick={cycle}
      title={`Theme: ${T_LABEL[theme]} — tap to cycle`}
    >
      {/* Icon uses the theme's primary colour so it reads differently for every theme */}
      <span style={{ color: T_COLOR[theme] }}>
        <Ic d={icons[T_ICON[theme]]} s={17} />
      </span>

      {/* coloured dot — secondary indicator, differentiates the 3 light themes */}
      <span style={{
        position: "absolute", bottom: 6, right: 6,
        width: 6, height: 6, borderRadius: "50%",
        background: T_COLOR[theme],
        border: "1.5px solid var(--panel)",
        pointerEvents: "none",
      }} />

      {/* theme name pop-up label */}
      {label && (
        <span className="theme-pop" style={{
          position: "absolute", top: -28, left: "50%",
          transform: "translateX(-50%)",
          background: "var(--ink)", color: "var(--panel)",
          fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
          padding: "3px 7px", borderRadius: 6, pointerEvents: "none",
        }}>
          {label}
        </span>
      )}
    </button>
  );
}

/**
 * Consistent block identity avatar used on every screen.
 * Always renders the same teal gradient regardless of block status.
 */
export function BlockAvatar({ code, size = 38 }) {
  // Block names can be long ("GF Emergency", "2F Economy MGW") — condense to a
  // short monogram so it fits the square: floor prefix + first word initials.
  const short = (() => {
    const s = String(code || "?").trim();
    if (s.length <= 4) return s.toUpperCase();
    const words = s.split(/[\s\-/]+/).filter(Boolean);
    const floorPrefix = /^\d?[A-Z]?F$|^GF$/i.test(words[0]) ? words[0].toUpperCase() : null;
    const rest = floorPrefix ? words.slice(1) : words;
    const initials = rest.map((w) => w[0].toUpperCase()).join("").slice(0, floorPrefix ? 2 : 3);
    return floorPrefix ? floorPrefix + initials : initials || s.slice(0, 3).toUpperCase();
  })();
  return (
    <div title={code} style={{
      width: size, height: size, flexShrink: 0,
      borderRadius: 10,
      background: "linear-gradient(135deg,var(--teal),var(--teal-deep))",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 800, color: "#fff", letterSpacing: "0.02em",
      fontSize: Math.max(9, Math.floor(size * (short.length > 3 ? 0.26 : 0.34))),
      boxShadow: "0 2px 8px rgba(14,165,233,.2)",
    }}>
      {short}
    </div>
  );
}

/* ── Friendly confirm dialog ─────────────────────────────────────────────────
 * Replacement for window.confirm(). Themed, accessible, body-scroll-locked.
 *
 * Two ways to use it:
 *
 *  1. Hook (recommended) — returns a `confirm(opts)` async function:
 *
 *     const [confirm, dialog] = useConfirm();
 *     async function onClick() {
 *       const ok = await confirm({
 *         title: 'Delete ward "ICU"?',
 *         message: 'This will remove 12 beds.\n\nThis cannot be undone.',
 *         confirmLabel: 'Delete',
 *         danger: true,
 *       });
 *       if (!ok) return;
 *       // ... do the thing
 *     }
 *     return <>{dialog}<button onClick={onClick}>Del</button></>;
 *
 *  2. Controlled component — render <ConfirmDialog ... /> yourself.
 */
export function ConfirmDialog({
  title, message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm, onCancel,
}) {
  useModal(onCancel);
  // Auto-focus the confirm button so keyboard users can hit Enter
  const btnRef = React.useRef(null);
  useEffect(() => { btnRef.current?.focus(); }, []);
  return (
    <div className="overlay" onClick={onCancel} style={{ alignItems: "center" }}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)",
          color: "var(--ink)",
          borderRadius: 14,
          maxWidth: 380,
          width: "calc(100% - 32px)",
          margin: "auto",
          padding: 20,
          boxShadow: "0 20px 50px rgba(0,0,0,.25)",
          border: "1px solid var(--line)",
        }}
      >
        <div id="confirm-title" style={{
          fontWeight: 700, fontSize: 16, color: "var(--ink)",
          marginBottom: message ? 10 : 18, lineHeight: 1.3,
        }}>
          {title}
        </div>
        {message && (
          <div style={{
            fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5,
            whiteSpace: "pre-wrap", marginBottom: 18,
          }}>
            {message}
          </div>
        )}
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button
            className="btn btn-ghost"
            style={{ padding: "9px 16px", fontWeight: 600 }}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={btnRef}
            className={danger ? "btn" : "btn btn-primary"}
            style={danger ? {
              padding: "9px 16px", fontWeight: 700,
              background: "var(--red)", color: "#fff", border: "none",
            } : { padding: "9px 16px", fontWeight: 700 }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const [state, setState] = useState(null); // null | { ...opts, resolve }

  const confirm = React.useCallback((opts) =>
    new Promise((resolve) => {
      setState({ ...opts, resolve });
    }), []);

  const close = (value) => {
    if (state) state.resolve(value);
    setState(null);
  };

  const node = state ? createPortal(
    <ConfirmDialog
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      danger={state.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />,
    document.body
  ) : null;

  return [confirm, node];
}

export function AppError({ title, message }) {
  if (!message) return null;
  return (
    <div style={{
      background: "rgba(239,68,68,.1)",
      border: "1px solid rgba(239,68,68,.25)",
      borderRadius: 8,
      padding: "10px 13px",
      marginBottom: 12,
    }}>
      {title && <div style={{ color: "var(--red)", fontWeight: 700, fontSize: 13, marginBottom: 3 }}>{title}</div>}
      <div style={{ color: "var(--red)", fontSize: 13, lineHeight: 1.4 }}>{message}</div>
    </div>
  );
}

export function StatusBar({ v, r, o, or: or_ = 0, total }) {
  const rest = Math.max(0, total - v - r - o - or_);
  return (
    <div className="bar">
      <span style={{ flex: v, background: "var(--st-v)" }} />
      <span style={{ flex: r, background: "var(--st-vr)" }} />
      <span style={{ flex: o, background: "var(--st-o)" }} />
      <span style={{ flex: or_, background: "var(--st-or)" }} />
      <span style={{ flex: rest, background: "var(--panel-2)" }} />
    </div>
  );
}
