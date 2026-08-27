import React, { useState, useEffect, useRef, useCallback } from "react";
import { api, toastErr, getSocket, onReconnect, coalesce } from "./lib.js";
import { RelativeTime } from "./relativeClock.jsx";
import { Ic, icons, useScrollRestore } from "./ui.jsx";
import { DISCHARGE_STEP_LABELS, dischargeProgress, fmtIpLast6, fmtClock, fmtMins, workflowTone, normalizeQuery } from "./bedUtils.js";
import DischargeTab from "./DischargeTab.jsx";
import { BackBtn } from "./PREApp.jsx";

/** The stage a row is sitting in right now — the first pending applicable step. */
const currentStep = (row) =>
  DISCHARGE_STEP_LABELS.find(([col]) => row[col] !== "NOT_APPLICABLE" && row[col] === "PENDING") || null;

/** The four views of this list — each tab is a count and the filter for it. */
const TABS = [["ALL", "All discharges"], ["PLANNED", "Planned"], ["RUNNING", "In progress"], ["DELAYED", "Delayed"]];

/** discharge_tracking column → the SLA phase key the backend reports under, so a
 *  row can name the department handling its current stage. */
const phaseKey = (col) => col.replace(/_status$/, "").toUpperCase();

/** One table row per discharge. The row is clickable, and the last cell repeats
 *  it as an explicit button for anyone who wants a target to aim at. */
function DischargeRow({ row, onOpen }) {
  const planned = row.status === "PLANNED";
  const prog = dischargeProgress(row);
  // Current stage = first pending applicable step.
  const cur = currentStep(row);
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
  const [q, setQ] = useState("");
  const [wardF, setWardF] = useState("");   // ward name, "" = any
  const [payerF, setPayerF] = useState(""); // payer type, "" = any
  const [stageF, setStageF] = useState(""); // current stage label, "" = any
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

  const all = rows || [];
  // Dropdown options come from what is actually in the list — no ward, payer or
  // stage is offered that would return nothing.
  const uniq = (vals) => [...new Set(vals.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const wardOpts = uniq(all.map((r) => r.ward_name));
  const payerOpts = uniq(all.map((r) => r.payer_type));
  const stageOpts = uniq(all.map((r) => currentStep(r)?.[1]));

  // Search + the three dropdowns narrow the list; the tabs then split whatever
  // is left, so their counts always describe what you are looking at.
  const nq = normalizeQuery(q);
  const hit = (v) => normalizeQuery(v).includes(nq);
  const pool = all.filter((r) =>
    (!nq || hit(r.bed_name) || hit(r.patient_name) || hit(r.ip_last6) || hit(r.ward_name)) &&
    (!wardF || r.ward_name === wardF) &&
    (!payerF || r.payer_type === payerF) &&
    (!stageF || currentStep(r)?.[1] === stageF));

  const planned = pool.filter((r) => r.status === "PLANNED");
  const running = pool.filter((r) => r.status !== "PLANNED");
  const delayed = pool.filter((r) => r.workflow?.state === "DELAYED");
  const counts = { ALL: pool.length, PLANNED: planned.length, RUNNING: running.length, DELAYED: delayed.length };
  const shown = filter === "PLANNED" ? planned
    : filter === "RUNNING" ? running
    : filter === "DELAYED" ? delayed
    : pool;
  const filtered = !!(nq || wardF || payerF || stageF);

  /** Exports exactly what the table is showing — same rows, same order. */
  const exportCsv = () => {
    const esc = (c) => `"${String(c ?? "").replace(/"/g, '""')}"`;
    const head = ["Bed", "Ward", "Patient", "IP", "Payer type", "Status",
      "Current stage", "Department", "Progress %", "SLA status", "Est. completion", "Updated"];
    const lines = [head.map(esc).join(",")];
    for (const r of shown) {
      const cur = currentStep(r);
      const wf = r.workflow;
      const prog = dischargeProgress(r);
      const dept = cur ? (wf?.phases || []).find((ph) => ph.key === phaseKey(cur[0]))?.department : "";
      lines.push([
        r.bed_name, r.ward_name, r.patient_name || "", r.ip_last6 || "", r.payer_type || "",
        r.status === "PLANNED" ? `Planned ${r.planned_date}${r.planned_time ? " " + r.planned_time : ""}` : "In progress",
        cur ? cur[1] : (r.status === "PLANNED" ? "" : "Awaiting checkout"),
        dept || "", prog ? prog.pct : "",
        workflowTone(wf)?.label || "", wf?.eta ? fmtClock(wf.eta) : "",
        r.updated_at ? new Date(Number(r.updated_at)).toLocaleString() : "",
      ].map(esc).join(","));
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `discharges-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="slide-up">
      {/* One compact bar instead of four counter cards plus a separate filter:
          each tab is both the count and the way to filter by it. */}
      <div className="dq-top">
        {!wardId && <div className="dq-title">Discharge Operations</div>}
        <div className="dq-tabs" role="tablist" aria-label="Filter discharges">
          {TABS.map(([key, label]) => {
            const n = rows ? counts[key] : null;
            return (
              <button key={key} role="tab" aria-selected={filter === key}
                className={"dq-tab" + (filter === key ? " on" : "")}
                onClick={() => setFilter(key)}>
                {label} {n === null ? "" : `(${n})`}
                {key === "DELAYED" && n > 0 && <span className="dq-tab-badge">{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search and the three narrowing dropdowns, then the export of whatever
          they leave behind. */}
      <div className="dq-tools">
        <div className="dq-search">
          <Ic d={icons.search} s={15} />
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search bed, patient, or IP…" aria-label="Search discharges" />
          {q && (
            <button className="dq-clear" onClick={() => setQ("")} aria-label="Clear search">
              <Ic d={icons.x} s={13} />
            </button>
          )}
        </div>

        {!wardId && (
          <select className="field dq-sel" value={wardF} onChange={(e) => setWardF(e.target.value)} aria-label="Filter by ward">
            <option value="">Ward / Floor</option>
            {wardOpts.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        )}
        <select className="field dq-sel" value={payerF} onChange={(e) => setPayerF(e.target.value)} aria-label="Filter by payer type">
          <option value="">Payer type</option>
          {payerOpts.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <select className="field dq-sel" value={stageF} onChange={(e) => setStageF(e.target.value)} aria-label="Filter by current stage">
          <option value="">Current stage</option>
          {stageOpts.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>

        {filtered && (
          <button className="dq-reset" onClick={() => { setQ(""); setWardF(""); setPayerF(""); setStageF(""); }}>
            Clear
          </button>
        )}
        <button className="btn btn-ghost dq-export" onClick={exportCsv} disabled={shown.length === 0}>
          <Ic d={icons.fileText} s={14} /> Export CSV
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 10 }}>{error}</div>}
      {rows === null && !error && (
        <div className="card-grid">{[0, 1, 2].map(i => <div key={i} className="preui-sk preui-sk-card" />)}</div>
      )}
      {rows && shown.length === 0 && (
        <div className="card empty" style={{ padding: 28 }}>
          <Ic d={icons.clipboard} s={28} />
          <div style={{ marginTop: 10, fontWeight: 700, fontSize: 14 }}>
            {all.length ? "Nothing matches these filters" : "No active discharges"}
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            {all.length
              ? `${all.length} active discharge${all.length === 1 ? "" : "s"} are hidden by the search or filters.`
              : "Planned and in-progress discharges across your wards appear here."}
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
