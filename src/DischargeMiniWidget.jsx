import React, { useState, useEffect, useCallback } from "react";
import { api, getSocket, onReconnect, coalesce } from "./lib.js";

const ROWS = [
  ["plannedToday", "Planned Today"],
  ["plannedTomorrow", "Planned Tomorrow"],
  ["initiated", "Initiated"],
  ["completedToday", "Completed Today"],
];

/** Small self-contained discharge-counter row — scoped server-side to whichever
 *  role/block/station the caller belongs to. Used on PRE's and Doctor's dashboards. */
export default function DischargeMiniWidget() {
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
