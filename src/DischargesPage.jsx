import React, { useState, useEffect, useRef, useCallback } from "react";
import { api, toastErr, getSocket, onReconnect, coalesce } from "./lib.js";
import { RelativeTime } from "./relativeClock.jsx";
import { Ic, icons, useScrollRestore } from "./ui.jsx";
import { DISCHARGE_STEP_LABELS, dischargeProgress, fmtIpLast6, fmtClock, fmtMins, workflowTone } from "./bedUtils.js";
import DischargeTab from "./DischargeTab.jsx";
import { BackBtn } from "./PREApp.jsx";

// Two-letter code inside each circle — full name appears on hover (title) or tap/hold.
const STEP_SHORT = {
  discharge_initiation_status: "DI",
  discharge_doc_status: "DS",
  drug_return_status: "DR",
  pharmacy_clearance_status: "PH",
  procedure_reconciliation_status: "PR",
  billing_started_status: "BL",
  audit_status: "AU",
  bill_ready_status: "BR",
  payment_status: "PY",
  system_checkout_status: "SC",
  physical_checkout_status: "PX",
};

/** (DS)—(DR)—(PH)—… — one lettered circle per applicable step; completed filled green,
 *  current ringed in primary. Tapping/holding a circle shows the full step name in a
 *  bubble under the stepper (hover shows it as a native tooltip on desktop). */
function FlowStepper({ t }) {
  const [sel, setSel] = useState(null); // { label, state } | null
  const steps = DISCHARGE_STEP_LABELS.filter(([col]) => t[col] !== "NOT_APPLICABLE");
  const curIdx = steps.findIndex(([col]) => t[col] === "PENDING");

  const pick = (e, label, state) => {
    e.stopPropagation(); // the whole card is a button — don't navigate
    setSel((s) => (s && s.label === label ? null : { label, state }));
  };

  return (
    <div>
      <div className="dstep">
        {steps.map(([col, label], i) => {
          const done = t[col] === "COMPLETED";
          const cur = i === curIdx;
          const state = done ? "Completed" : cur ? "Current step" : "Pending";
          return (
            <React.Fragment key={col}>
              {i > 0 && <span className={"l" + (done ? " done" : "")} />}
              <span
                className={"c" + (done ? " done" : cur ? " cur" : "")}
                title={`${label} — ${state}`}
                role="button"
                tabIndex={0}
                onClick={(e) => pick(e, label, state)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pick(e, label, state)}
              >
                {STEP_SHORT[col]}
              </span>
            </React.Fragment>
          );
        })}
      </div>
      {sel && (
        <span className="dstep-tip" onClick={(e) => e.stopPropagation()}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            background: sel.state === "Completed" ? "var(--st-v)" : sel.state === "Current step" ? "var(--primary)" : "var(--ink-3)",
          }} />
          {sel.label} — {sel.state}
        </span>
      )}
    </div>
  );
}

function DischargeCard({ row, onOpen }) {
  const planned = row.status === "PLANNED";
  const prog = dischargeProgress(row);
  // Current stage name: first pending applicable step (or the plan date when not started)
  const cur = DISCHARGE_STEP_LABELS.find(([col]) => row[col] !== "NOT_APPLICABLE" && row[col] === "PENDING");
  const wf = row.workflow;
  const tone = workflowTone(wf);
  const isDelayed = wf?.state === "DELAYED";

  return (
    <button className="card" style={{
      display: "block", width: "100%", textAlign: "left", padding: "14px 16px", cursor: "pointer",
      // A delayed discharge earns the red edge — it's the one thing on this list
      // that needs picking up before the others.
      borderLeft: `4px solid ${planned ? "var(--st-vr)" : isDelayed ? "var(--red)" : "var(--primary)"}`,
    }} onClick={onOpen}>
      <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 9, flexWrap: "wrap", minWidth: 0 }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>{row.bed_name}</span>
          <span className="dim" style={{ fontSize: 12, fontWeight: 600 }}>{row.ward_name}</span>
        </div>
        <span className="tag" style={{
          fontSize: 10.5, flexShrink: 0,
          background: planned ? "var(--st-vr-bg)" : "var(--blue-bg)",
          color: planned ? "var(--st-vr)" : "var(--blue)",
        }}>
          {planned ? `PLANNED · ${row.planned_date}${row.planned_time ? " " + row.planned_time : ""}` : "IN PROGRESS"}
        </span>
      </div>

      <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>{fmtIpLast6(row.ip_last6)}</div>

      {!planned && (
        <>
          <FlowStepper t={row} />
          <div className="row between" style={{ gap: 10, marginTop: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--primary)" }}>
              {cur ? `Current: ${cur[1]}` : "All steps complete — awaiting checkout"}
            </span>
            {prog && <span className="dim" style={{ fontSize: 11.5, fontWeight: 700, flexShrink: 0 }}>{prog.done}/{prog.total} · {prog.pct}%</span>}
          </div>
          {/* SLA line — backend-computed ETA plus which phases have slipped. */}
          {wf && (
            <div className="row between" style={{ gap: 8, marginTop: 5, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Ic d={icons.clock} s={11} style={{ color: "var(--ink-3)" }} />
                {wf.eta ? `Est. ${fmtClock(wf.eta)}` : "—"}
                {wf.etaMinutes != null && (
                  <span className="dim" style={{ fontWeight: 600 }}>· {fmtMins(wf.etaMinutes)} left</span>
                )}
              </span>
              {tone && (
                <span style={{
                  fontSize: 9.5, fontWeight: 800, padding: "2px 7px", borderRadius: 99,
                  background: tone.bg, color: tone.color, flexShrink: 0, letterSpacing: ".03em",
                }}>{tone.label.toUpperCase()}</span>
              )}
            </div>
          )}
        </>
      )}

      <div className="row between" style={{ marginTop: 8 }}>
        <span className="dim" style={{ fontSize: 10.5 }}>Updated <RelativeTime ts={row.updated_at} /></span>
        <Ic d={icons.chevron} s={14} style={{ color: "var(--ink-3)" }} />
      </div>
    </button>
  );
}

/** "Discharges" — every planned + running discharge in the caller's scope, one page.
 *  Tapping a card opens the full discharge page for that bed. Live via websocket.
 *  props: role ("PRE"|"NURSE"|"DOCTOR"),
 *  wardId (optional — scopes the list to a single ward, e.g. embedded in WardPage's Discharges tab) */
export default function DischargesPage({ role, wardId, onRequestReopen }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL"); // ALL | PLANNED | RUNNING
  const [openBed, setOpenBed] = useState(null); // { id, bed_name, ward_id } | null
  // Opening a bed replaces this whole list with its discharge detail — save/
  // restore scroll across that swap. saveScroll() must be called wherever
  // openBed is opened, before setOpenBed — see useScrollRestore's doc comment.
  const saveScroll = useScrollRestore(!!openBed);

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
      {/* Counters + filter */}
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
        <div className="stat" style={{ justifyContent: "center" }}>
          <select className="field" aria-label="Filter discharges" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ fontWeight: 600 }}>
            <option value="ALL">All</option>
            <option value="PLANNED">Planned only</option>
            <option value="RUNNING">In progress only</option>
            <option value="DELAYED">Delayed only</option>
          </select>
        </div>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((row) => (
            <DischargeCard key={row.admission_id} row={row}
              onOpen={() => { saveScroll(); setOpenBed({ id: row.bed_id, bed_name: row.bed_name, ward_id: row.ward_id }); }} />
          ))}
        </div>
      )}
    </div>
  );
}
