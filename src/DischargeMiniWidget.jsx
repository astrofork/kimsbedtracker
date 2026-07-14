import React, { useState, useEffect, useCallback } from "react";
import { api, createSocket } from "./lib.js";

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
    const socket = createSocket();
    socket.on("discharge:update", load);
    socket.on("connect", load);
    return () => { socket.disconnect(); };
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
