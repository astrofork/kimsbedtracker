import React, { useState, useEffect } from "react";

export const Ic = ({ d, s = 22 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
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

/* ── Theme system ─────────────────────────────────────────────────────────── */
const THEMES  = ["dark", "light", "purple", "teal"];
const T_LABEL = { dark: "Dark", light: "Light", purple: "Purple", teal: "Teal" };
const T_COLOR = { dark: "#2dd4bf", light: "#0EA5E9", purple: "#7C3AED", teal: "#14B8A6" };
// moon for dark mode, sun for all light-based themes
const T_ICON  = { dark: "moon",    light: "sun",     purple: "sun",     teal: "sun"     };

// theme-color = the topbar background so Android status bar matches the app UI
const T_META_COLOR = {
  dark:   "#0b0f14",   // dark topbar
  light:  "#FFFFFF",   // white topbar
  purple: "#F8F4FF",   // light purple topbar
  teal:   "#F0FAFB",   // light teal topbar
};

function getTheme() {
  return localStorage.getItem("app_theme") || "light";
}

function applyTheme(t) {
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
  cancelLabel  = "Cancel",
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

  const node = state ? (
    <ConfirmDialog
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      danger={state.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
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
  const rest = Math.max(0, total - v - r - o - (or_ || 0));
  return (
    <div className="bar">
      <span style={{ flex: v,          background: "var(--green)"   }} />
      <span style={{ flex: r,          background: "var(--amber)"   }} />
      <span style={{ flex: o,          background: "var(--red)"     }} />
      <span style={{ flex: or_ || 0,   background: "#8B5CF6"        }} />
      <span style={{ flex: rest,       background: "var(--panel-2)" }} />
    </div>
  );
}
