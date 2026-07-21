import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, toastErr, fmtDateTime, createSocket } from "./lib.js";
import { Ic, icons, useConfirm } from "./ui.jsx";
import { fmtIpLast6, fmtClock, fmtMins, workflowTone } from "./bedUtils.js";

// Steps are organized into 5 groups. Groups run in parallel — none of them wait
// on another group. Within a group, steps unlock in order: a step can't be
// marked complete until the step before it in the same group is Completed (or
// N/A) — see the "locked" computation where GROUPS is built below.
//
// The groups are, in order: Doctor Summary · Drug & Clinical Clearance ·
// Billing & Payment · System Checkout · Physical Checkout. Those names are
// documentation only — the UI renders each group as its own card with no
// heading, so the labels aren't carried in the data.
const STEPS = [
  { key: "DISCHARGE_INITIATION", label: "Discharge Initiation", roles: ["DOCTOR", "CONSULTANT"], group: 1, hidden: true },
  { key: "DISCHARGE_DOC",     label: "Discharge Summary", roles: ["DOCTOR", "CONSULTANT"], group: 1 },
  { key: "DRUG_RETURN", label: "Drug Return", roles: ["PRE", "NURSE", "PHARMACY", "MASTER_PHARMACY"], group: 2 },
  { key: "PHARMACY_CLEARANCE", label: "Pharmacy Clearance", roles: ["PRE", "NURSE", "PHARMACY", "MASTER_PHARMACY"], group: 2, after: "DRUG_RETURN" },
  { key: "PROCEDURE_RECONCILIATION", label: "Procedure Reconciliation (OT / Cath Lab)", roles: ["PRE"], allowNA: true, group: 2, after: "DRUG_RETURN" },
  { key: "BILLING_STARTED", label: "Bill Prep", roles: ["PRE", "FC", "MASTER_FC"], group: 3 },
  { key: "AUDIT", label: "Audit", roles: ["PRE", "FC", "MASTER_FC"], group: 3 },
  { key: "BILL_READY", label: "Bill Finalized", roles: ["FC", "MASTER_FC"], group: 3 },
  { key: "PAYMENT", label: "Payment Status", roles: ["FC", "MASTER_FC"], group: 3 },
  { key: "SYSTEM_CHECKOUT", label: "System Checkout", roles: ["PRE"], group: 4 },
  { key: "PHYSICAL_CHECKOUT", label: "Physical Checkout", roles: ["PRE", "NURSE"], needsPatientLeft: true, group: 5 },
];
const GROUPS = [...new Set(STEPS.map((s) => s.group))].map((id) => ({
  id, steps: STEPS.filter((s) => s.group === id && !s.hidden),
}));
// Every step System Checkout must wait on — everything except itself and Physical
// Checkout (which runs after/parallel to it, not before). Mirrors the backend gate
// in dischargeService.updateStep so the button reflects what the API will actually allow.
const PRE_SYSTEM_CHECKOUT_STEPS = STEPS.filter((s) => !["SYSTEM_CHECKOUT", "PHYSICAL_CHECKOUT"].includes(s.key));
const PRE_PHYSICAL_CHECKOUT_STEPS = STEPS.filter((s) => s.key !== "PHYSICAL_CHECKOUT");
const PLAN_ROLES = ["PRE", "DOCTOR", "CONSULTANT"];

// --ink-2 rather than --ink-3 for the neutral states: --ink-3 (#9CA3AF light) is
// only ~2.5:1 on the group-box surface, under the 4.5:1 AA floor.
const STATUS_COLOR = {
  PENDING: "var(--ink-2)", COMPLETED: "var(--st-v)", NOT_APPLICABLE: "var(--ink-2)",
  PLANNED: "var(--st-vr)", DISCHARGE_INITIATED: "var(--primary)", IN_PROGRESS: "var(--primary)",
  CANCELLED: "var(--st-or)",
};

function todayStr(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function StepRow({ step, status, role, onSetStatus, onRequestReopen, busy, locked, lockedOn, lockedTitle, patientLeft, phase, isLast, systemCheckoutDone }) {
  const [pickingLeft, setPickingLeft] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const canAct = step.roles.includes(role);
  const isPharmacyStep = ["DRUG_RETURN", "PHARMACY_CLEARANCE"].includes(step.key);
  const isBillingStep = ["BILLING_STARTED", "AUDIT", "BILL_READY", "PAYMENT"].includes(step.key);
  const canDirectReopen = !(role === "PHARMACY" && isPharmacyStep) && !(role === "FC" && isBillingStep);
  const showPatientLeft = step.needsPatientLeft && status === "COMPLETED";

  // SLA line — all values come from the backend's `workflow.phases`; this only
  // formats them. Delayed steps get a red overdue counter, running steps show
  // the deadline they're working against, finished steps show how long they took.
  const delayed = phase?.state === "DELAYED";
  const tat = phase ? `TAT ${fmtMins(phase.expectedMinutes)}` : null;
  const slaLine = (() => {
    if (!phase) return null;
    if (phase.state === "COMPLETED") {
      if (phase.completedAt) {
        const took = phase.actualMinutes != null ? ` · took ${fmtMins(phase.actualMinutes)}` : "";
        const late = phase.actualMinutes != null && phase.actualMinutes > phase.expectedMinutes;
        return (
          <span style={{ color: late ? "var(--amber)" : "var(--ink-2)" }}>
            Done {fmtClock(phase.completedAt)}{took} · {tat}
          </span>
        );
      }
      return <span style={{ color: "var(--ink-2)" }}>Completed · {tat}</span>;
    }
    if (phase.startedAt) {
      return (
        <span style={{ color: delayed ? "var(--red)" : "var(--ink-2)" }}>
          Started {fmtClock(phase.startedAt)}
          {delayed
            ? ` · ${fmtMins(phase.overdueMinutes)} overdue`
            : phase.deadline ? ` · due ${fmtClock(phase.deadline)}` : ""}
          {" · "}{tat}
        </span>
      );
    }
    return <span style={{ color: "var(--ink-2)" }}>Not started · {tat}</span>;
  })();

  return (
    // Rows divide themselves inside a group card, so the last one has no rule —
    // the card edge already closes the list.
    //
    // Locked rows mute via an explicit --ink-2 label, not a blanket opacity:
    // opacity multiplied against text that was already --ink-3 dropped it to
    // roughly 1.5:1 against the box, i.e. unreadable. The lock chip on the right
    // already signals the state, so the text itself doesn't need to fade.
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: isLast ? "none" : "1px solid var(--line)", gap: 10, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: locked ? "var(--ink-2)" : "var(--ink)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {step.label}
          {delayed && (
            <span style={{
              fontSize: 9.5, fontWeight: 800, padding: "1px 6px", borderRadius: 99,
              background: "var(--red-bg)", color: "var(--red)", letterSpacing: ".03em",
            }}>DELAYED</span>
          )}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[status] || "var(--ink-2)", marginTop: 2 }}>{status.replace("_", " ")}</div>
        {slaLine && <div style={{ fontSize: 10.5, fontWeight: 600, marginTop: 2 }}>{slaLine}</div>}
        {showPatientLeft && (
          <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: patientLeft ? "var(--st-v)" : "var(--st-or)" }}>
            <Ic d={patientLeft ? icons.check : icons.alert} s={11} /> {patientLeft ? "Patient has left" : "Patient has NOT left"}
          </div>
        )}
      </div>
      {locked ? (
        <span title={lockedTitle} style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
          <Ic d={icons.ban} s={12} /> After {lockedOn}
        </span>
      ) : !canAct ? (
        <span className="dim" style={{ fontSize: 11, flexShrink: 0 }}>{step.roles.join("/")}-only</span>
      ) : pickingLeft ? (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button className="btn btn-primary" style={{ fontSize: 11, padding: "6px 10px" }} disabled={busy}
            onClick={async () => {
              if (systemCheckoutDone) {
                const ok = await confirm({
                  title: "Confirm Patient Left",
                  message: "This bed will become vacant and the discharge will be completed.\n\nThis action cannot be undone — there is no way to reopen after this.",
                  confirmLabel: "Yes, Patient Left",
                  cancelLabel: "Go Back",
                  danger: true,
                });
                if (!ok) return;
              }
              setPickingLeft(false);
              onSetStatus(step.key, "COMPLETED", { patientLeft: true });
            }}>Patient Left</button>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "6px 10px" }} disabled={busy}
            onClick={() => setPickingLeft(false)}>Cancel</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {status === "PENDING" && step.allowNA && (
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "6px 10px" }} disabled={busy}
              onClick={() => onSetStatus(step.key, "NOT_APPLICABLE")}>N/A</button>
          )}
          {status !== "COMPLETED" && status !== "NOT_APPLICABLE" && (
            <button className="btn btn-primary" style={{ fontSize: 11, padding: "6px 10px" }} disabled={busy}
              onClick={() => step.needsPatientLeft ? setPickingLeft(true) : onSetStatus(step.key, "COMPLETED")}>
              Mark Completed
            </button>
          )}
          {status !== "PENDING" && canDirectReopen && (
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "6px 10px" }} disabled={busy}
              onClick={() => onSetStatus(step.key, "PENDING")}>Reopen</button>
          )}
          {status === "COMPLETED" && !canDirectReopen && onRequestReopen && (
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "6px 10px", color: "var(--amber)" }} disabled={busy}
              onClick={() => onRequestReopen(step.key)}>Request Reopen</button>
          )}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

function PlanSection({ bed, existing, onClose, onSaved }) {
  const [option, setOption] = useState("tomorrow");
  const [customDate, setCustomDate] = useState(existing?.planned_date || todayStr(1));
  const [time, setTime] = useState(existing?.planned_time || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const plannedDate = option === "tomorrow" ? todayStr(1) : customDate;

  async function save() {
    setSaving(true); setError("");
    try {
      const r = existing
        ? await api.dischargeReschedule(existing.admission_id, plannedDate, time || null)
        : await api.dischargePlan(bed.id, plannedDate, time || null);
      onSaved(r.tracking);
    } catch (e) { setError(toastErr(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ background: "var(--panel-2)", borderRadius: 10, padding: 14, marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[["tomorrow", "Tomorrow"], ["custom", "Custom"]].map(([val, lbl]) => (
          <button key={val} onClick={() => setOption(val)} style={{
            flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 700,
            border: `2px solid ${option === val ? "var(--primary)" : "var(--line)"}`,
            background: option === val ? "var(--primary)" : "transparent",
            color: option === val ? "#fff" : "var(--ink-2)", cursor: "pointer",
          }}>{lbl}</button>
        ))}
      </div>
      {option === "custom" && (
        <input type="date" className="field" value={customDate} min={todayStr()} style={{ marginBottom: 10 }}
          onChange={(e) => setCustomDate(e.target.value)} />
      )}
      <input type="time" className="field" value={time} placeholder="Time (optional)" style={{ marginBottom: 10 }}
        onChange={(e) => setTime(e.target.value)} />
      {error && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: "8px 14px" }} onClick={onClose}>Back</button>
        <button className="btn btn-primary" style={{ fontSize: 12, padding: "8px 14px" }} disabled={saving} onClick={save}>
          {saving ? "Saving…" : existing ? "Reschedule" : "Save Plan"}
        </button>
      </div>
    </div>
  );
}

// Exported — reused by BedDetailSheet's top-level "Bed Transfer" action (PRE only),
// which replaced the old in-flow Transfer Bed button here.
export function TransferSection({ bed, wards, onClose, onSaved }) {
  const [toWardId, setToWardId] = useState(bed.ward_id);
  const [candidates, setCandidates] = useState(null);
  const [toBedId, setToBedId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!toWardId) return;
    setCandidates(null); setToBedId("");
    api.transferCandidates(toWardId)
      .then((r) => setCandidates((r.beds || []).filter((b) => b.id !== bed.id)))
      .catch((e) => setError(toastErr(e)));
  }, [toWardId, bed.id]);

  async function confirm() {
    if (!toBedId || !reason.trim()) return;
    setSaving(true); setError("");
    try {
      const r = await api.transferBed(bed.id, Number(toWardId), Number(toBedId), reason.trim());
      onSaved(r);
    } catch (e) { setError(toastErr(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ background: "var(--panel-2)", borderRadius: 10, padding: 14, marginTop: 10 }}>
      <label className="label">Destination Ward</label>
      <select className="field" value={toWardId} onChange={(e) => setToWardId(Number(e.target.value))} style={{ marginBottom: 10 }}>
        {(wards || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <label className="label">Destination Bed</label>
      {candidates === null ? (
        <div className="dim" style={{ fontSize: 12, padding: "6px 0" }}>Loading…</div>
      ) : candidates.length === 0 ? (
        <div className="dim" style={{ fontSize: 12, padding: "6px 0" }}>No operational, vacant beds available.</div>
      ) : (
        <select className="field" value={toBedId} onChange={(e) => setToBedId(e.target.value)} style={{ marginBottom: 10 }}>
          <option value="">— Select bed —</option>
          {candidates.map((b) => <option key={b.id} value={b.id}>{b.bed_name}</option>)}
        </select>
      )}
      <textarea className="field" value={reason} maxLength={500} rows={2} placeholder="Transfer reason *"
        onChange={(e) => setReason(e.target.value)}
        style={{ resize: "vertical", fontSize: 13, fontFamily: "inherit", marginBottom: 10 }} />
      {error && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: "8px 14px" }} onClick={onClose}>Back</button>
        <button className="btn btn-primary" style={{ fontSize: 12, padding: "8px 14px" }} disabled={saving || !toBedId || !reason.trim()} onClick={confirm}>
          {saving ? "Transferring…" : "Confirm Transfer"}
        </button>
      </div>
    </div>
  );
}

function HistorySection({ admissionId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.dischargeHistory(admissionId).then(setData).catch((e) => setError(toastErr(e)));
  }, [admissionId]);

  const items = data
    ? [
        ...data.discharge.map((d) => ({ ts: Number(d.changed_at), type: "discharge", d })),
        ...data.transfers.map((t) => ({ ts: Number(t.transferred_at), type: "transfer", d: t })),
      ].sort((a, b) => b.ts - a.ts)
    : [];

  return (
    <div style={{ marginTop: 10 }}>
      {error && <div style={{ fontSize: 12, color: "var(--red)" }}>{error}</div>}
      {!data && !error && <div className="dim" style={{ fontSize: 12, padding: "10px 0" }}>Loading…</div>}
      {data && items.length === 0 && <div className="dim" style={{ fontSize: 12, padding: "10px 0" }}>No history yet.</div>}
      {items.map((item, i) => (
        <div key={i} style={{ background: "var(--panel-2)", borderRadius: 10, padding: "9px 12px", marginBottom: 8, fontSize: 12 }}>
          {item.type === "discharge" ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>{item.d.field.replace(/_/g, " ")}</div>
              <div className="dim">{item.d.old_value ?? "—"} → {item.d.new_value ?? "—"} · {item.d.changed_by_name || "System"} · {fmtDateTime(item.ts)}</div>
              {item.d.reason && <div className="dim" style={{ marginTop: 2 }}>Reason: {item.d.reason}</div>}
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, marginBottom: 3, color: "var(--primary)" }}><Ic d={icons.exchange} s={11} /> Bed Transfer</div>
              <div className="dim">{item.d.from_bed_name} → {item.d.to_bed_name} · {item.d.transferred_by_name || "System"} · {fmtDateTime(item.ts)}</div>
              <div className="dim" style={{ marginTop: 2 }}>Reason: {item.d.reason}</div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** Inline discharge panel — plan, checklist, and history live in expanding sections
 *  within this one panel instead of stacking separate popups. Bed Transfer lives
 *  outside this component now — see BedDetailSheet's top-level Actions row.
 *  props: bed { id, bed_name, ward_id }, role, onChanged */
export default function DischargeTab({ bed, role, onChanged, onRequestReopen }) {
  const [admission, setAdmission] = useState(undefined);
  const [tracking, setTracking] = useState(null);
  // Backend-computed SLA view: per-phase deadlines/state plus the overall ETA.
  const [workflow, setWorkflow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState(null); // "plan" | "transfer" | "history" | null
  const [cancelReason, setCancelReason] = useState(null); // string | null (null = hidden)
  // PRE only, for now — see the "Physical Checkout while System Checkout is still
  // pending" fork below. true while the choice popup is open.

  const load = useCallback(async () => {
    try {
      const r = await api.dischargeForBed(bed.id);
      setAdmission(r.admission);
      setTracking(r.tracking);
      setWorkflow(r.workflow ?? null);
    } catch (e) {
      const msg = toastErr(e);
      if (msg.includes("not under your care") || msg.includes("No active") || msg.includes("not found")) {
        setAdmission(null);
        setTracking(null);
        setWorkflow(null);
        onChanged?.();
      } else {
        setError(msg);
      }
    }
  }, [bed.id, onChanged]);

  useEffect(() => { load(); }, [load]);

  // Live refresh — another user completing a step / planning / cancelling shows up
  // here instantly, without anyone touching a refresh button.
  const liveLoadRef = useRef(load);
  liveLoadRef.current = load;
  useEffect(() => {
    const socket = createSocket();
    socket.on("discharge:update", () => liveLoadRef.current());
    socket.on("bed:update", (p) => {
      // The bed this panel is for changed (e.g. manual vacate resets the workflow)
      if (!p || p.bedId == null || Number(p.bedId) === Number(bed.id)) liveLoadRef.current();
    });
    socket.on("connect", () => liveLoadRef.current());
    return () => { socket.disconnect(); };
  }, [bed.id]);

  const refresh = async () => { setSection(null); await load(); onChanged?.(); };

  const setStep = async (step, status, opts = {}) => {
    setBusy(true); setError("");
    try { await api.dischargeUpdateStep(tracking.admission_id, step, status, opts); await refresh(); }
    catch (e) { setError(toastErr(e)); }
    finally { setBusy(false); }
  };

  // Physical Checkout ("patient left: yes") completing while System Checkout is still
  // pending needs a decision — the bed can't stay Occupied (nobody's in it) or go
  // Vacant (paperwork isn't done). PRE only for now; every other role keeps the
  // previous direct-complete behavior unchanged.
  const onStepAction = (step, status, opts = {}) => {
    setStep(step, status, opts);
  };

  const initiate = async () => {
    setBusy(true);
    try { await api.dischargeInitiate(tracking.admission_id); await refresh(); }
    catch (e) { setError(toastErr(e)); } finally { setBusy(false); }
  };
  const cancelPlan = async () => {
    setBusy(true);
    try { await api.dischargeCancelPlan(tracking.admission_id, cancelReason); setCancelReason(null); await refresh(); }
    catch (e) { setError(toastErr(e)); } finally { setBusy(false); }
  };
  const cancelWorkflow = async () => {
    setBusy(true);
    try { await api.dischargeCancel(tracking.admission_id, cancelReason); setCancelReason(null); await refresh(); }
    catch (e) { setError(toastErr(e)); } finally { setBusy(false); }
  };

  const canPlan = PLAN_ROLES.includes(role);
  const running = tracking && ["DISCHARGE_INITIATED", "IN_PROGRESS"].includes(tracking.status);
  const phaseByKey = new Map((workflow?.phases ?? []).map(p => [p.key, p]));
  const tone = workflowTone(workflow);

  if (admission === undefined) return <div className="dim" style={{ fontSize: 13, padding: "16px 0", textAlign: "center" }}>Loading…</div>;
  if (admission === null) return (
    <div className="card empty" style={{ padding: 20, marginTop: 4 }}>
      <Ic d={icons.bed} s={24} />
      <div style={{ marginTop: 8, fontSize: 13 }} className="dim">No active patient admission on this bed.</div>
    </div>
  );

  return (
    <div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 10 }}>{fmtIpLast6(admission.ip_last6)}</div>

      {!tracking ? (
        canPlan ? (
          section === "plan" ? (
            <PlanSection bed={bed} existing={null} onClose={() => setSection(null)} onSaved={refresh} />
          ) : (
            <button className="btn btn-primary btn-block" onClick={() => setSection("plan")}>
              <Ic d={icons.clipboard} s={14} /> Plan Discharge
            </button>
          )
        ) : (
          <div className="dim" style={{ fontSize: 13 }}>No discharge planned yet.</div>
        )
      ) : (
        <>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "var(--panel-2)", borderRadius: 10, padding: "10px 12px", marginBottom: 12,
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase" }}>Status</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: STATUS_COLOR[tracking.status] }}>{tracking.status.replace("_", " ")}</div>
            </div>
            {tracking.status === "PLANNED" && (
              <div className="dim" style={{ fontSize: 12, textAlign: "right" }}>
                {tracking.planned_date}{tracking.planned_time ? ` · ${tracking.planned_time}` : ""}
              </div>
            )}
            {/* Once running, the planned date stops being useful — what everyone
                needs is the live estimate and whether the flow is slipping. */}
            {workflow?.eta != null && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase" }}>
                  Est. discharge
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.15 }}>{fmtClock(workflow.eta)}</div>
                {tone && (
                  <span style={{
                    display: "inline-block", marginTop: 3, fontSize: 9.5, fontWeight: 800,
                    padding: "2px 7px", borderRadius: 99, background: tone.bg, color: tone.color,
                  }}>{tone.label}</span>
                )}
              </div>
            )}
          </div>

          {/* Delay detail — named phases, so it's actionable rather than just a flag. */}
          {(() => {
            const visibleDelayed = workflow?.phases?.filter(p => p.state === "DELAYED" && !STEPS.find(s => s.key === p.key)?.hidden) || [];
            if (!visibleDelayed.length) return null;
            return (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12,
                background: "var(--red-bg)", borderRadius: 10, padding: "9px 12px",
              }}>
                <Ic d={icons.alert} s={14} style={{ color: "var(--red)", flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--red)" }}>
                  {visibleDelayed.length === 1 ? "1 phase is" : `${visibleDelayed.length} phases are`} past the expected time:{" "}
                  {visibleDelayed.map(p => `${p.label} (${fmtMins(p.overdueMinutes)} over)`).join(", ")}
                </div>
              </div>
            );
          })()}

          {tracking.status === "PLANNED" && section === "plan" && (
            <PlanSection bed={bed} existing={tracking} onClose={() => setSection(null)} onSaved={refresh} />
          )}
          {tracking.status === "PLANNED" && section !== "plan" && canPlan && (
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={initiate}>Start Discharge</button>
              <button className="btn btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={() => setSection("plan")}>Reschedule</button>
              <button className="btn btn-ghost" style={{ flex: 1, color: "var(--st-or)" }} disabled={busy} onClick={() => setCancelReason("")}>Cancel Plan</button>
            </div>
          )}

          {running && (
            <>
              {/* One card per group, no group heading — the grouping itself is the
                  only cue needed, and dropping five headings buys back the vertical
                  space that made this list long on phones.

                  Both mounts wrap this component in a plain `.card`, so these boxes
                  sit on --panel. They deliberately use --panel-2 instead: a white
                  box on a white parent reads as one continuous list no matter how
                  strong the border is. Separation has to come from the surface
                  colour because --shadow is `none` in the dark theme, so elevation
                  alone would look right in light mode and vanish in dark. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 8 }}>
                {GROUPS.map((g) => (
                  <div key={g.id} style={{
                    background: "var(--panel-2)",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--radius)",
                    padding: "2px 12px",
                  }}>
                    {g.steps.map((step, i) => {
                      const status = tracking[step.key.toLowerCase() + "_status"];
                      // Explicit dependency (parallel fan-out) overrides the default
                      // "previous sibling in this group" sequential chain.
                      const depStep = step.after
                        ? STEPS.find((s) => s.key === step.after)
                        : (i > 0 ? g.steps[i - 1] : null);
                      const depStatus = depStep ? tracking[depStep.key.toLowerCase() + "_status"] : null;
                      // System Checkout is a lone step in its own group, so the normal
                      // "previous step in this group" check never fires for it — it needs
                      // every OTHER step in the flow done first, not just one.
                      const pendingBefore = step.key === "SYSTEM_CHECKOUT"
                        ? PRE_SYSTEM_CHECKOUT_STEPS.filter((s) => !["COMPLETED", "NOT_APPLICABLE"].includes(tracking[s.key.toLowerCase() + "_status"]))
                        : step.key === "PHYSICAL_CHECKOUT"
                        ? PRE_PHYSICAL_CHECKOUT_STEPS.filter((s) => !["COMPLETED", "NOT_APPLICABLE"].includes(tracking[s.key.toLowerCase() + "_status"]))
                        : [];
                      const locked = (step.key === "SYSTEM_CHECKOUT" || step.key === "PHYSICAL_CHECKOUT")
                        ? status === "PENDING" && pendingBefore.length > 0
                        : status === "PENDING" && !!depStep && !["COMPLETED", "NOT_APPLICABLE"].includes(depStatus);
                      const lockedOn = (step.key === "SYSTEM_CHECKOUT" || step.key === "PHYSICAL_CHECKOUT")
                        ? (pendingBefore.length === 1
                            ? pendingBefore[0].label
                            : `${pendingBefore.length} steps`)
                        : (locked ? depStep.label : null);
                      const lockedTitle = (step.key === "SYSTEM_CHECKOUT" || step.key === "PHYSICAL_CHECKOUT") && pendingBefore.length > 1
                        ? pendingBefore.map((s) => s.label).join(", ")
                        : undefined;
                      return (
                        <StepRow key={step.key} step={step} role={role} busy={busy} status={status}
                          locked={locked} lockedOn={locked ? lockedOn : null} lockedTitle={lockedTitle}
                          onSetStatus={onStepAction} onRequestReopen={onRequestReopen ? (stepKey) => onRequestReopen(bed.admission_id, stepKey) : null}
                          patientLeft={tracking.patient_left}
                          systemCheckoutDone={tracking.system_checkout_status === "COMPLETED"}
                          phase={phaseByKey.get(step.key)} isLast={i === g.steps.length - 1} />
                      );
                    })}
                  </div>
                ))}
              </div>


              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {canPlan && (
                  <button className="btn btn-ghost" style={{ flex: 1, fontSize: 12, color: "var(--st-or)" }}
                    onClick={() => setCancelReason("")}>Cancel Discharge</button>
                )}
              </div>
            </>
          )}

          {tracking.status === "COMPLETED" && (
            <div className="dim" style={{ fontSize: 13 }}>This discharge is completed.</div>
          )}

          {tracking.status === "CANCELLED" && (
            <>
              <div className="dim" style={{ fontSize: 13, marginBottom: 10 }}>This discharge is cancelled.</div>
              {canPlan && (
                section === "plan" ? (
                  <PlanSection bed={bed} existing={null} onClose={() => setSection(null)} onSaved={refresh} />
                ) : (
                  <button className="btn btn-primary btn-block" onClick={() => setSection("plan")}>
                    <Ic d={icons.clipboard} s={14} /> Reschedule Discharge
                  </button>
                )
              )}
            </>
          )}

          {cancelReason !== null && (
            <div style={{ marginTop: 10, background: "var(--panel-2)", borderRadius: 10, padding: 12 }}>
              <label className="label">Reason (optional)</label>
              <textarea className="field" rows={2} value={cancelReason} maxLength={500}
                onChange={(e) => setCancelReason(e.target.value)}
                style={{ resize: "vertical", fontSize: 13, fontFamily: "inherit", marginBottom: 10 }} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: "8px 14px" }} onClick={() => setCancelReason(null)}>Back</button>
                <button className="btn btn-primary" style={{ fontSize: 12, padding: "8px 14px" }} disabled={busy}
                  onClick={tracking.status === "PLANNED" ? cancelPlan : cancelWorkflow}>Confirm Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      {error && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 12 }}>{error}</div>}

      {admission && (
        <button className="btn btn-ghost" style={{ width: "100%", marginTop: 14, fontSize: 12 }}
          onClick={() => setSection(section === "history" ? null : "history")}>
          <Ic d={icons.fileText} s={13} /> {section === "history" ? "Hide History" : "Full History"}
        </button>
      )}
      {section === "history" && <HistorySection admissionId={admission.id} />}
    </div>
  );
}
