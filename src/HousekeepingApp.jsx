import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, toastErr, getSocket, onReconnect } from "./lib.js";
import { AppShell } from "./shell.jsx";
import { Ic, icons } from "./ui.jsx";
import { RelativeTime } from "./relativeClock.jsx";

/** How long this bed has been waiting, against the configured turnaround. */
function minutesSince(ts) {
  return Math.max(0, Math.floor((Date.now() - Number(ts || 0)) / 60000));
}

function BedCard({ bed, tat, busy, onStart, onComplete }) {
  const waiting = bed.task_id ? minutesSince(bed.created_at) : 0;
  const over = bed.task_id && waiting > Number(bed.expected_minutes || tat);
  const inProgress = bed.task_status === "IN_PROGRESS";

  // No open task = this bed is only here as a heads-up. A discharge is running,
  // so it will probably free soon; there is nothing to do yet and no clock.
  if (!bed.task_id) {
    return (
      <div className="hk-bed hk-bed--soon">
        <div className="hk-bed-top">
          <b>{bed.bed_name}</b>
          <span className="hk-tag hk-tag--soon">Discharge running</span>
        </div>
        <div className="hk-bed-note">Not free yet — no action needed.</div>
      </div>
    );
  }

  return (
    <div className={"hk-bed" + (over ? " hk-bed--over" : "") + (inProgress ? " hk-bed--doing" : "")}>
      <div className="hk-bed-top">
        <b>{bed.bed_name}</b>
        <span className={"hk-tag" + (over ? " hk-tag--over" : inProgress ? " hk-tag--doing" : "")}>
          {inProgress ? "In progress" : "To clean"}
        </span>
      </div>

      <div className="hk-bed-meta">
        <span>Free <RelativeTime ts={bed.created_at} /></span>
        {bed.source === "TRANSFER" && <span className="hk-src">Transfer</span>}
        {bed.source === "DISCHARGE" && <span className="hk-src">Discharge</span>}
      </div>

      {/* Soft claim: says who picked it up, never stops anyone else finishing.
          A cleaner going off shift mid-clean must not strand a bed. */}
      {bed.claimed_name && (
        <div className="hk-bed-claim">{bed.claimed_name} started <RelativeTime ts={bed.claimed_at} /></div>
      )}
      {!bed.operational_status && (
        <div className="hk-bed-warn">This bed is out of service — contact the admin.</div>
      )}

      <div className="hk-bed-actions">
        {!inProgress && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => onStart(bed.id)}>Start</button>
        )}
        <button className="btn btn-primary" disabled={busy} onClick={() => onComplete(bed.id)}>
          Mark clean
        </button>
      </div>
    </div>
  );
}

export default function HousekeepingApp({ user, onLogout }) {
  const [board, setBoard] = useState(null);
  const [err, setErr] = useState("");
  const [zoneId, setZoneId] = useState(null);
  const [busyBed, setBusyBed] = useState(null);
  const [toast, setToast] = useState("");
  const isManager = user.role === "HOUSEKEEPING_MANAGER";

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2200); }, []);

  /** Called once on mount and once per reconnect. Everything in between arrives
   *  as a per-bed delta — this is the recovery path, not a refresh loop. */
  const load = useCallback(() => {
    api.hkBoard()
      .then((d) => { setBoard(d); setErr(""); })
      .catch((e) => setErr(toastErr(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Live: patch one bed, never refetch the board ───────────────────────────
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    const socket = getSocket();
    const onBed = (b) => {
      if (!b || b.id == null) return;
      setBoard((prev) => {
        if (!prev) return prev;
        let touched = false;
        const zones = prev.zones.map((z) => ({
          ...z,
          wards: z.wards.map((w) => {
            if (Number(w.id) !== Number(b.ward_id)) return w;
            const has = w.beds.some((x) => Number(x.id) === Number(b.id));
            // Clean again, and it leaves the board entirely.
            if (!b.housekeeping_status && !b.task_id) {
              if (!has) return w;
              touched = true;
              return { ...w, beds: w.beds.filter((x) => Number(x.id) !== Number(b.id)) };
            }
            touched = true;
            return has
              ? { ...w, beds: w.beds.map((x) => (Number(x.id) === Number(b.id) ? { ...x, ...b } : x)) }
              : { ...w, beds: [...w.beds, b] };
          }),
        }));
        return touched ? { ...prev, zones } : prev;
      });
    };
    socket.on("hk:bed", onBed);
    const offReconnect = onReconnect(socket, () => loadRef.current());
    return () => { socket.off("hk:bed", onBed); offReconnect(); };
  }, []);

  const act = async (bedId, fn, msg) => {
    setBusyBed(bedId);
    try { await fn(bedId); showToast(msg); }
    catch (e) { showToast(toastErr(e)); load(); }   // resync only when we were wrong
    finally { setBusyBed(null); }
  };
  const start = (bedId) => act(bedId, api.hkStart, "Started");
  const complete = (bedId) => act(bedId, api.hkComplete, "Marked clean");

  const zones = board?.zones || [];
  const zone = zones.find((z) => z.id === zoneId) || zones[0] || null;
  const tat = board?.tat ?? 10;

  const menu = zones.map((z) => ({ key: String(z.id), icon: icons.bed, label: z.name }));

  const toClean = (zone?.wards || []).reduce(
    (n, w) => n + w.beds.filter((b) => b.task_id).length, 0);
  const soon = (zone?.wards || []).reduce(
    (n, w) => n + w.beds.filter((b) => !b.task_id).length, 0);

  return (
    <AppShell
      menu={menu.length ? menu : [{ key: "none", icon: icons.bed, label: "No zones" }]}
      active={String(zone?.id ?? "none")}
      onSelect={(k) => setZoneId(Number(k))}
      title={zone ? zone.name : "Housekeeping"}
      user={{ name: user.name || user.username || "Housekeeping",
              role: isManager ? "HK MANAGER" : "HOUSEKEEPING" }}
      onLogout={onLogout}
    >
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginBottom: 10 }}>{err}</div>}

      {board && zones.length === 0 && (
        <div className="card empty" style={{ padding: 32 }}>
          <Ic d={icons.bed} s={28} />
          <div style={{ marginTop: 10, fontWeight: 700, fontSize: 14 }}>No zones assigned</div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            Ask your administrator to add you to a housekeeping zone.
          </div>
        </div>
      )}

      {zone && (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="n" style={{ fontSize: 18 }}>{toClean}</div>
              <div className="l">TO CLEAN</div>
            </div>
            <div className="stat">
              <div className="n" style={{ fontSize: 18 }}>{soon}</div>
              <div className="l">FREEING SOON</div>
            </div>
            <div className="stat">
              <div className="n" style={{ fontSize: 18 }}>{tat}m</div>
              <div className="l">TURNAROUND</div>
            </div>
          </div>

          {zone.wards.length === 0 && (
            <div className="card empty" style={{ padding: 28 }}>
              <div style={{ fontWeight: 700 }}>No wards in this zone</div>
            </div>
          )}

          {zone.wards.map((w) => (
            <div key={w.id} style={{ marginBottom: 18 }}>
              <div className="floor-head">
                {w.name}
                {!w.operational && (
                  <span className="hk-ward-warn"> — ward is out of service, contact the admin</span>
                )}
              </div>
              {w.beds.length === 0 ? (
                <div className="dim" style={{ fontSize: 12, padding: "6px 2px 12px" }}>Nothing waiting.</div>
              ) : (
                <div className="hk-grid">
                  {w.beds.map((b) => (
                    <BedCard key={b.id} bed={b} tat={tat} busy={busyBed === b.id}
                      onStart={start} onComplete={complete} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </AppShell>
  );
}
