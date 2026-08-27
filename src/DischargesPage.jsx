import React, { useState, useEffect, useRef, useCallback } from "react";
import { api, toastErr, getSocket, onReconnect, coalesce } from "./lib.js";
import { RelativeTime } from "./relativeClock.jsx";
import { Ic, icons, useScrollRestore } from "./ui.jsx";
import { DISCHARGE_STEP_LABELS, dischargeProgress, fmtIpLast6, fmtClock, fmtMins, workflowTone } from "./bedUtils.js";
import DischargeTab from "./DischargeTab.jsx";
import { BackBtn } from "./PREApp.jsx";

/** discharge_tracking column → the SLA phase key the backend reports under, so a
 *  row can name the department handling its current stage. */
const phaseKey = (col) => col.replace(/_status$/, "").toUpperCase();

/** One table row per discharge. The row is clickable, and the last cell repeats
 *  it as an explicit button for anyone who wants a target to aim at. */
function DischargeRow({ row, onOpen }) {
  const planned = row.status === "PLANNED";
  const prog = dischargeProgress(row);
  // Current stage = first pending applicable step.
  const cur = DISCHARGE_STEP_LABELS.find(([col]) => row[col] !== "NOT_APPLICABLE" && row[col] === "PENDING");
  const wf = row.workflow;
  const tone = workflowTone(wf);
  const dept = cur ? (wf?.phases || []).find((ph) => ph.key === phaseKey(cur[0]))?.department : null;

  return (
    <tr onClick={onOpen}>
      <td className="dq-bed">
        <b>{row.bed_name}</b>
        <i>{row.ward_name}</i>
      </td>

      <td className="dq-pt">
        <b className={row.patient_name ? "" : "dim"}>{row.patient_name || "Not recorded"}</b>
        <i>{fmtIpLast6(row.ip_last6)}</i>
        <i>Updated <RelativeTime ts={row.updated_at} /></i>
      </td>

      <td className="dq-pay">{row.payer_type || "—"}</td>

      <td className="dq-stage">
        {planned ? (
          <b>Planned {row.planned_date}{row.planned_time ? " " + row.planned_time : ""}</b>
        ) : (
          <>
            <b>{cur ? cur[1] : "Awaiting checkout"}</b>
            {dept && <i>{dept}</i>}
            {wf?.eta && (
              <i>Est. {fmtClock(wf.eta)}{wf.etaMinutes != null ? `, ${fmtMins(wf.etaMinutes)} left` : ""}</i>
            )}
          </>
        )}
      </td>

      <td className="dq-prog">
        {prog ? (
          <>
            <em>{prog.pct}%</em>
            <span className="doc-bar">
              <i style={{ width: `${prog.pct}%`, background: "var(--primary)" }} />
            </span>
          </>
        ) : <span className="dim">Not started</span>}
      </td>

      <td className="dq-sla">
        {planned ? (
          <span className="dq-pill" style={{ background: "var(--st-vr-bg)", color: "var(--st-vr)" }}>Planned</span>
        ) : tone ? (
          <span className="dq-pill" style={{ background: tone.bg, color: tone.color }}>{tone.label}</span>
        ) : (
          <span className="dq-pill" style={{ background: "var(--blue-bg)", color: "var(--blue)" }}>In progress</span>
        )}
      </td>

      <td className="dq-act">
        <button className="btn btn-ghost dq-view" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
          <Ic d={icons.eye} s={13} /> View details
        </button>
      </td>
    </tr>
  );
}

/** "Discharges" — every planned + running discharge in the caller's scope, one page.
 *  Tapping a card opens the full discharge page for that bed. Live via websocket.
 *  props: role ("PRE"|"NURSE"|"DOCTOR"),
 *  wardId (optional — scopes the list to a single ward, e.g. embedded in WardPage's Discharges tab) */
export default function DischargesPage({ role, wardId, onRequestReopen, onDetailOpen }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL"); // ALL | PLANNED | RUNNING
  const [openBed, setOpenBed] = useState(null); // { id, bed_name, ward_id } | null
  // Opening a bed replaces this whole list with its discharge detail — save/
  // restore scroll across that swap. saveScroll() must be called wherever
  // openBed is opened, before setOpenBed — see useScrollRestore's doc comment.
  const saveScroll = useScrollRestore(!!openBed);

  // Tell the parent when the detail view takes over. Rendered inside WardPage,
  // this component sits below a ward header and a Manage/Discharges tab bar —
  // so the phase list appeared as a third thing stacked under two levels of
  // chrome, with two different back controls visible at once. The parent hides
  // its own header while this is true, letting the detail be the whole page.
  useEffect(() => { onDetailOpen?.(!!openBed); }, [openBed, onDetailOpen]);
  // Leaving the page counts as closing it, or the parent stays collapsed.
  useEffect(() => () => onDetailOpen?.(false), [onDetailOpen]);

  const load = useCallback(() => {
    api.dischargesActive(wardId)
      .then((r) => { setRows(r.discharges || []); setError(""); })
      .catch((e) => setError(toastErr(e)));
  }, [wardId]);
  useEffect(() => { load(); }, [load]);

  // Live refresh — any discharge/bed change in scope updates this list instantly.
  const liveRef = useRef(load);
  liveRef.current = load;
  useEffect(() => {
    const socket = getSocket();
    // Coalesced reload: bursts (per-bed ward edits, scheduler ticks) collapse
    // into one refetch. Targeted patches below stay instant. See coalesce().
    const reload = coalesce(() => liveRef.current());
    const onBedUpdate = (p) => {
      if (wardId && p && p.wardId != null && Number(p.wardId) !== Number(wardId)) return;
      reload();
    };
    // discharge:update sometimes carries the full tracking row (plan/reschedule/
    // initiate/step), sometimes just IDs (cancel/force-complete) or a partial
    // transfer summary. Only the full-row case can be patched in place; the
    // rest fall back to a refetch, same as before.
    const onDischargeUpdate = (p) => {
      if (wardId && p && p.wardId != null && Number(p.wardId) !== Number(wardId)) return;
      if (!p?.tracking || p.tracking.admission_id == null) { reload(); return; }
      setRows((prev) => {
        if (!prev) return prev;
        const idx = prev.findIndex((r) => r.admission_id === p.tracking.admission_id);
        if (idx === -1) {
          // A discharge just appeared in this scope for the first time (e.g.
          // freshly planned) — the payload has tracking fields but not the
          // bed_name/ward_name/ip_last6/payer_type this list also displays,
          // so there's not enough here to construct a correct row. Refetch.
          reload();
          return prev;
        }
        const merged = { ...prev[idx], ...p.tracking };
        const stillActive = ["PLANNED", "DISCHARGE_INITIATED", "IN_PROGRESS"].includes(merged.status);
        if (!stillActive) return prev.filter((_, i) => i !== idx);
        const next = prev.slice();
        next[idx] = merged;
        return next;
      });
    };
    socket.on("discharge:update", onDischargeUpdate);
    socket.on("bed:update", onBedUpdate);
    // Reconnect (not first connect) → catch updates missed while disconnected.
    const offReconnect = onReconnect(socket, () => liveRef.current());
    return () => {
      socket.off("discharge:update", onDischargeUpdate);
      socket.off("bed:update", onBedUpdate);
      offReconnect(); reload.cancel();
    };
  }, [wardId]);

  // Full discharge page for a picked bed
  if (openBed) return (
    <div className="slide-up" style={{ maxWidth: 640, margin: "0 auto" }}>
      <BackBtn label="Back to Discharges" onClick={() => setOpenBed(null)} style={{ marginBottom: 18 }} />
      <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: "-.02em", marginBottom: 18 }}>
        Discharge — {openBed.bed_name}
      </div>
      <div className="card dc-shell">
        <DischargeTab bed={openBed} role={role} onChanged={load} onRequestReopen={onRequestReopen} />
      </div>
    </div>
  );

  const planned = (rows || []).filter((r) => r.status === "PLANNED");
  const running = (rows || []).filter((r) => r.status !== "PLANNED");
  const delayed = (rows || []).filter((r) => r.workflow?.state === "DELAYED");
  const shown = filter === "PLANNED" ? planned
    : filter === "RUNNING" ? running
    : filter === "DELAYED" ? delayed
    : (rows || []);

  return (
    <div className="slide-up">
      {/* The four counts read as the page's headline: how much is running and
          how much of it has slipped, before the queue itself. */}
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="row" style={{ gap: 10 }}>
            <span className="ic"><Ic d={icons.clipboard} s={16} /></span>
            <div className="n" style={{ fontSize: 18 }}>{rows ? rows.length : "—"}</div>
          </div>
          <div className="l">ACTIVE DISCHARGES</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 10 }}>
            <span className="ic" style={{ background: "var(--st-vr-bg)", color: "var(--st-vr)" }}><Ic d={icons.clock} s={16} /></span>
            <div className="n" style={{ fontSize: 18 }}>{rows ? planned.length : "—"}</div>
          </div>
          <div className="l">PLANNED</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 10 }}>
            <span className="ic" style={{ background: "var(--blue-bg)", color: "var(--blue)" }}><Ic d={icons.chart} s={16} /></span>
            <div className="n" style={{ fontSize: 18 }}>{rows ? running.length : "—"}</div>
          </div>
          <div className="l">IN PROGRESS</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 10 }}>
            <span className="ic" style={{
              background: delayed.length ? "var(--red-bg)" : "var(--panel-2)",
              color: delayed.length ? "var(--red)" : "var(--ink-3)",
            }}><Ic d={icons.alert} s={16} /></span>
            <div className="n" style={{ fontSize: 18, color: delayed.length ? "var(--red)" : undefined }}>
              {rows ? delayed.length : "—"}
            </div>
          </div>
          <div className="l">DELAYED</div>
        </div>
        </div>

        {/* Its own row, not a fifth cell in the counter grid. As a grid cell it
            landed alone on a third row filling about a third of it, reading as a
            stat that had lost its number rather than as a control. */}
        <div className="row between" style={{ gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink)" }}>
            Showing
          </span>
          <select className="field" aria-label="Filter discharges" value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: "auto", flex: "0 0 auto", maxWidth: 190, fontWeight: 600 }}>
            <option value="ALL">All</option>
            <option value="PLANNED">Planned only</option>
            <option value="RUNNING">In progress only</option>
            <option value="DELAYED">Delayed only</option>
          </select>
        </div>

      {error && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 10 }}>{error}</div>}
      {rows === null && !error && (
        <div className="card-grid">{[0, 1, 2].map(i => <div key={i} className="preui-sk preui-sk-card" />)}</div>
      )}
      {rows && shown.length === 0 && (
        <div className="card empty" style={{ padding: 28 }}>
          <Ic d={icons.clipboard} s={28} />
          <div style={{ marginTop: 10, fontWeight: 700, fontSize: 14 }}>No active discharges</div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            Planned and in-progress discharges across your wards appear here.
          </div>
        </div>
      )}

      {rows && shown.length > 0 && (
        /* The app's own table, same as the dashboard's: header band, hairline
           rows, first column pinned so the bed stays readable while the rest
           scrolls sideways on a phone. */
        <div className="tbl-wrap dq-wrap">
          <table className="tbl tbl-pin1 dq-tbl">
            <thead>
              <tr>
                <th>Bed &amp; ward</th>
                <th>Patient</th>
                <th>Payer type</th>
                <th>Current stage &amp; department</th>
                <th>Progress</th>
                <th>SLA status</th>
                <th>Quick actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <DischargeRow key={row.admission_id} row={row}
                  onOpen={() => { saveScroll(); setOpenBed({ id: row.bed_id, bed_name: row.bed_name, ward_id: row.ward_id }); }} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
