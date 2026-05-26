import React, { useState } from "react";

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

/* ── Theme system ─────────────────────────────────────────────────────────── */
const THEMES  = ["dark", "light", "purple", "teal"];
const T_LABEL = { dark: "Dark", light: "Light", purple: "Purple", teal: "Teal" };
const T_COLOR = { dark: "#2dd4bf", light: "#0EA5E9", purple: "#7C3AED", teal: "#14B8A6" };

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
      <Ic d={icons.palette} s={17} />

      {/* coloured dot = current theme indicator */}
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

export function StatusBar({ v, o, r, total }) {
  const rest = Math.max(0, total - v - o - r);
  return (
    <div className="bar">
      <span style={{ flex: v, background: "var(--green)" }} />
      <span style={{ flex: o, background: "var(--red)" }} />
      <span style={{ flex: r, background: "var(--amber)" }} />
      <span style={{ flex: rest, background: "var(--panel-2)" }} />
    </div>
  );
}
