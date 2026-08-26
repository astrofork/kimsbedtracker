import React, { useState, useEffect, useCallback } from "react";
import { api, getSocket, onReconnect, coalesce } from "./lib.js";
import { Ic, icons } from "./ui.jsx";

// The icon and accent are only read by the `rich` variant. Accents are theme
// tokens, so the tiles follow whichever theme is active.
// One theme colour for every badge — see the note on the stats array in
// DoctorApp. The label carries the meaning; the badge is an ornament.
const ROWS = [
  ["plannedToday", "Planned Today", "clipboard", "var(--primary)", "calendar"],
  ["plannedTomorrow", "Planned Tomorrow", "list", "var(--primary)", "clipboard"],
  ["initiated", "Initiated", "target", "var(--primary)", "chart"],
  ["completedToday", "Completed Today", "check", "var(--primary)", "shield"],
];

/** Small self-contained discharge-counter row — scoped server-side to whichever
 *  role/block/station the caller belongs to. Used on PRE's and Doctor's dashboards.
 *
 *  `rich` opts into the icon-and-accent tiles used on the Doctor home screen, so
 *  those match the stat row directly above them. It is opt-IN precisely because
 *  this component is shared: PRE renders the plain variant and is unaffected. */
export default function DischargeMiniWidget({ rich = false }) {
  const [counts, setCounts] = useState(null);

  const load = useCallback(() => {
    api.dischargeDashboard().then(setCounts).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const socket = getSocket();
    // Server-computed aggregate counts — no single-row payload to patch from,
    // this stays a refetch on every relevant event.
    const refresh = coalesce(load);
    socket.on("discharge:update", refresh);
    // Reconnect (not first connect) → the mount-time load() already ran.
    const offReconnect = onReconnect(socket, load);
    return () => {
      socket.off("discharge:update", refresh);
      offReconnect(); refresh.cancel();
    };
  }, [load]);

  if (!counts) return null;

  // Its own row, and its own grid: four tiles stretched across the same width the
  // seven capacity tiles occupy above.
  if (rich) {
    return (
      <div className="doc-statline doc-statline--wide">
        {ROWS.map(([key, label, ic, accent, art]) => (
          <div className="doc-stat" key={key} style={{ "--accent": accent }}>
            <span className="doc-stat-head">
              <span className="doc-stat-ic" aria-hidden="true"><Ic d={icons[ic] || icons.grid} s={13} /></span>
              <span className="doc-stat-l">{label.toUpperCase()}</span>
            </span>
            <span className="doc-stat-row"><span className="doc-stat-v">{counts[key]}</span></span>
            <span className={`doc-stat-art art-${art}`} aria-hidden="true" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="stat-grid" style={{ marginBottom: 14 }}>
      {ROWS.map(([key, label]) => (
        <div className="stat" key={key}>
          <div className="n" style={{ fontSize: 18 }}>{counts[key]}</div>
          <div className="l">{label.toUpperCase()}</div>
        </div>
      ))}
    </div>
  );
}
