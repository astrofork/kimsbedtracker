import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { api, toastErr, fmtDateTime, getSocket, onReconnect, coalesce } from "./lib.js";
import { Ic, icons, useConfirm, useModal } from "./ui.jsx";
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
  { key: "DISCHARGE_INITIATION", label: "Discharge Initiation", roles: ["PRE", "DOCTOR", "CONSULTANT"], group: 1, hidden: true },
  { key: "DISCHARGE_DOC",     label: "Discharge Summary", roles: ["PRE", "DOCTOR", "CONSULTANT"], group: 1 },
  { key: "DRUG_RETURN", label: "Drug Return", roles: ["PRE", "NURSE", "PHARMACY", "MASTER_PHARMACY"], group: 2 },
  { key: "PHARMACY_CLEARANCE", label: "Pharmacy Clearance", roles: ["PRE", "NURSE", "PHARMACY", "MASTER_PHARMACY"], group: 2, after: "DRUG_RETURN" },
  { key: "PROCEDURE_RECONCILIATION", label: "Procedure Reconciliation (OT / Cath Lab)", roles: ["PRE"], allowNA: true, group: 2, after: "DRUG_RETURN" },
  { key: "BILLING_STARTED", label: "Bill Prep", roles: ["PRE", "FC", "MASTER_FC"], group: 3, afterAll: ["PHARMACY_CLEARANCE", "PROCEDURE_RECONCILIATION"] },
  { key: "AUDIT", label: "Audit", roles: ["PRE", "FC", "MASTER_FC"], group: 3 },
  { key: "BILL_READY", label: "Bill Finalized", roles: ["PRE", "FC", "MASTER_FC"], group: 3 },
  { key: "PAYMENT", label: "Payment Status", roles: ["PRE", "FC", "MASTER_FC"], group: 3 },
  { key: "SYSTEM_CHECKOUT", label: "System Checkout", roles: ["PRE", "FC", "MASTER_FC"], group: 4 },
  { key: "PHYSICAL_CHECKOUT", label: "Physical Checkout", roles: ["PRE", "NURSE"], needsPatientLeft: true, group: 5 },
];
const GROUPS = [...new Set(STEPS.map((s) => s.group))].map((id) => ({
  id, steps: STEPS.filter((s) => s.group === id && !s.hidden),
}));
// Every step System Checkout must wait on — everything except itself and Physical
// Checkout (which runs after/parallel to it, not before). Mirrors the backend gate
// in dischargeService.updateStep so the button reflects what the API will actually allow.
const PRE_SYSTEM_CHECKOUT_STEPS = STEPS.filter((s) => !s.hidden && !["SYSTEM_CHECKOUT", "PHYSICAL_CHECKOUT"].includes(s.key));
const PRE_PHYSICAL_CHECKOUT_STEPS = [];
const PLAN_ROLES = ["PRE", "DOCTOR", "CONSULTANT"];

const ROLE_SHORT = { PRE: "PRE", NURSE: "Nurse", DOCTOR: "Doctor", CONSULTANT: "Consultant", FC: "FC", MASTER_FC: "FC", PHARMACY: "Pharmacy", MASTER_PHARMACY: "Pharmacy" };
function friendlyRoles(roles) {
  const unique = [...new Set(roles.map(r => ROLE_SHORT[r] || r))];
  return unique.join(" / ");
}

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

// "Patient Left" while System Checkout is still pending needs a mandatory note
// (same rule as any other bed transfer — moving to the Lounge IS a transfer)
// before it can move the bed. Short by design: this fires every time a
// discharge reaches this point, so it stays to the point rather than
// re-explaining the whole Lounge mechanism on every use.
function MoveToLoungeNotePopup({ onCancel, onConfirm, saving }) {
  const [note, setNote] = useState("");
  useModal(onCancel);
  return createPortal(
    <div className="overlay" onClick={onCancel} style={{ alignItems: "center" }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="lounge-note-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)", color: "var(--ink)", borderRadius: 16,
          maxWidth: 360, width: "calc(100% - 32px)", margin: "auto",
          padding: "22px 20px 18px", boxShadow: "0 20px 50px rgba(0,0,0,.25)",
          border: "1px solid var(--line)",
        }}>
        <div id="lounge-note-title" style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>
          Move to Discharge Lounge
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.4, marginBottom: 12 }}>
          System Checkout is still pending. This frees up the bed for a new patient.
        </div>
        <label className="label" style={{ fontSize: 11 }}>Note * <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>({note.length}/50)</span></label>
        <textarea className="field" autoFocus value={note} maxLength={50} rows={2}
          placeholder="Why is this bed being moved to the lounge?"
          onChange={(e) => setNote(e.target.value)}
          style={{ resize: "vertical", fontSize: 13, fontFamily: "inherit", marginTop: 4, marginBottom: 14 }} />
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-ghost" style={{ flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 700 }}
            disabled={saving} onClick={onCancel}>Dismiss</button>
          <button className="btn btn-primary" style={{ flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 700 }}
            disabled={saving || !note.trim()} onClick={() => onConfirm(note.trim())}>
            {saving ? "Moving…" : "Move to Discharge Lounge"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** A compact step action. While saving it keeps its label in the layout —
    hidden, not removed — and centres a spinner over it, so neither the button
    nor the row changes width mid-save. */
function ActBtn({ kind = "ghost", spinning, disabled, onClick, style, children }) {
  return (
    <button className={`btn btn-${kind} dc-act`} disabled={disabled}
      aria-busy={spinning || undefined} onClick={onClick}
      style={{ fontSize: 11, padding: "6px 10px", ...style }}>
      <span className={"dc-act-label" + (spinning ? " is-hidden" : "")}>{children}</span>
      {spinning && (
        <span className="dc-act-spin" aria-hidden="true">
          <span className="spin"><Ic d={icons.refresh} s={12} /></span>
        </span>
      )}
    </button>
  );
}

function StepRow({ step, status, role, onSetStatus, onRequestReopen, saving, locked, lockedOn, lockedTitle, patientLeft, phase, isLast, systemCheckoutDone, tracking, actor }) {
  const [pickingLeft, setPickingLeft] = useState(false);
  const [loungeNoteOpen, setLoungeNoteOpen] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const canAct = step.roles.includes(role);
  const isPharmacyStep = ["DRUG_RETURN", "PHARMACY_CLEARANCE"].includes(step.key);
  const isBillingStep = ["BILLING_STARTED", "AUDIT", "BILL_READY", "PAYMENT"].includes(step.key);
  const drugReturnReopenBlocked = step.key === "DRUG_RETURN" && status === "COMPLETED" && tracking && (
    ["COMPLETED", "NOT_APPLICABLE"].includes(tracking.pharmacy_clearance_status) ||
    ["COMPLETED", "NOT_APPLICABLE"].includes(tracking.procedure_reconciliation_status)
  );
  const canDirectReopen = !(role === "PHARMACY" && isPharmacyStep) && !(role === "FC" && isBillingStep) && !drugReturnReopenBlocked;
  const showPatientLeft = step.needsPatientLeft && status === "COMPLETED";
  // Finished AND we know who finished it — the only case that shows a byline
  // instead of the "who may act" role hint.
  const done = (status === "COMPLETED" || status === "NOT_APPLICABLE") && !!actor;
  // This row has a save in flight. Only this row's buttons lock — every other
  // phase stays clickable, which is the point: independent phases are actioned
  // in parallel. `saving` holds WHICH status is being written, so the exact
  // button that was pressed is the one that spins.
  const rowSaving = saving !== undefined;

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
    <div className="dc-step" style={{ borderBottom: isLast ? "none" : "1px solid var(--line)" }}>
      <div className="dc-step-main">
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
        {/* Who MAY act reads as a caption on the step itself. (Who DID act is a
            different thing and stays in the right column under the button that
            produced it.) */}
        {!done && (
          <div style={{ marginTop: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--primary)", opacity: 0.7 }}>{friendlyRoles(step.roles)}</span>
          </div>
        )}
      </div>
      <div className="dc-step-side">
        {locked ? (
          <span title={lockedTitle} style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 4 }}>
            <Ic d={icons.ban} s={12} /> After {lockedOn}
          </span>
        ) : canAct && pickingLeft ? (
          <div className="dc-step-actions">
            <ActBtn kind="primary" disabled={rowSaving} spinning={saving === "COMPLETED"}
              onClick={async () => {
                if (systemCheckoutDone) {
                  const ok = await confirm({
                    title: "Confirm Physical Checkout",
                    message: "System Checkout is already completed. Marking Physical Checkout will make this bed vacant and complete the discharge.",
                    badge: "This action cannot be undone",
                    confirmLabel: "Yes, Complete Discharge",
                    cancelLabel: "Go Back",
                    danger: false,
                    warning: true,
                  });
                  if (!ok) return;
                  setPickingLeft(false);
                  onSetStatus(step.key, "COMPLETED", { patientLeft: true });
                } else {
                  setLoungeNoteOpen(true);
                }
              }}>Patient Left</ActBtn>
            <ActBtn disabled={rowSaving} onClick={() => setPickingLeft(false)}>Cancel</ActBtn>
          </div>
        ) : canAct ? (
          <div className="dc-step-actions">
            {status === "PENDING" && step.allowNA && (
              <ActBtn disabled={rowSaving} spinning={saving === "NOT_APPLICABLE"}
                onClick={() => onSetStatus(step.key, "NOT_APPLICABLE")}>N/A</ActBtn>
            )}
            {status !== "COMPLETED" && status !== "NOT_APPLICABLE" && (
              <ActBtn kind="primary" disabled={rowSaving} spinning={saving === "COMPLETED"}
                onClick={() => step.needsPatientLeft ? setPickingLeft(true) : onSetStatus(step.key, "COMPLETED")}>
                Mark Completed
              </ActBtn>
            )}
            {status !== "PENDING" && canDirectReopen && (
              <ActBtn disabled={rowSaving} spinning={saving === "PENDING"}
                onClick={() => onSetStatus(step.key, "PENDING")}>Reopen</ActBtn>
            )}
            {status === "COMPLETED" && !canDirectReopen && onRequestReopen && (
              <ActBtn disabled={rowSaving} style={{ color: "var(--amber)" }}
                onClick={() => onRequestReopen(step.key)}>Request Reopen</ActBtn>
            )}
          </div>
        ) : null}
        {/* Byline sits directly under the Reopen / Request Reopen button that
            acts on it. The column is align-items:flex-end, so it stays flush
            right whether or not a button rendered above it. */}
        {done && (
          <span className="dc-step-by" title={fmtDateTime(actor.at)}>
            {status === "NOT_APPLICABLE" ? "Marked N/A" : "Completed"} by {actor.name || "Unknown"}
            {actor.role && ` (${ROLE_SHORT[actor.role] || actor.role})`}
          </span>
        )}
      </div>
      {confirmDialog}
      {loungeNoteOpen && (
        <MoveToLoungeNotePopup
          saving={rowSaving}
          onCancel={() => setLoungeNoteOpen(false)}
          onConfirm={(note) => {
            setLoungeNoteOpen(false);
            setPickingLeft(false);
            onSetStatus(step.key, "COMPLETED", { patientLeft: true, moveToLounge: true, moveNote: note });
          }}
        />
      )}
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

// Exported — reused by BedDetailSheet's top-level "Bed Transfer" action, and by
// the Discharge Lounge's "Readmit" action (via `submit`/`submitLabel` props).
// The destination ward list is fetched here (hospital-wide, operational wards,
// including the Discharge Lounge — see GET /discharge/transfer/wards) rather
// than passed in as a prop, so every transfer-capable role (PRE/Nurse/FC) sees
// the same full set of valid destinations, not just their own block/station.
// Each ward carries inMyScope: wards outside the caller's own usual assignment
// are still selectable, but flagged with a warning before confirming.
//
// `submit` lets a caller point this at a different backend action (Readmit uses
// api.readmitFromLounge instead of api.transferBed) while reusing the exact same
// ward/bed/reason UI. Defaults to the ordinary transfer.
export function TransferSection({ bed, onClose, onSaved, onConflict, submit, submitLabel = "Confirm Transfer" }) {
  const [wards, setWards] = useState(null);
  const [wardsError, setWardsError] = useState("");
  const [toWardId, setToWardId] = useState(bed.ward_id);
  const [candidates, setCandidates] = useState(null);
  const [toBedId, setToBedId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirm, confirmDialog] = useConfirm();
  const [loungeConfirmOpen, setLoungeConfirmOpen] = useState(false);

  useEffect(() => {
    api.transferWards()
      .then((r) => setWards(r.wards || []))
      .catch((e) => setWardsError(toastErr(e)));
  }, []);

  useEffect(() => {
    if (!toWardId) return;
    setCandidates(null); setToBedId("");
    api.transferCandidates(toWardId)
      .then((r) => setCandidates((r.beds || []).filter((b) => b.id !== bed.id)))
      .catch((e) => setError(toastErr(e)));
  }, [toWardId, bed.id]);

  const selectedWardEarly = (wards || []).find((w) => w.id === toWardId);
  const dischargeStatus = bed.discharge_tracking?.status;
  const dischargeInProgress = dischargeStatus === "DISCHARGE_INITIATED" || dischargeStatus === "IN_PROGRESS";
  // TransferSection is only ever used for Readmit when the FROM bed (the one
  // being transferred out of) is itself the Discharge Lounge — that's how
  // ReadmitPopup gates opening this in the first place, so it's a reliable
  // way to tell "plain transfer" and "readmit" apart without a separate prop.
  const isReadmit = bed.bed_type === "Lounge";
  // Any transfer INTO the Lounge (not readmit, which moves OUT of it) now
  // auto-completes every step through Payment + Physical Checkout, regardless
  // of whether a discharge had already been started — see
  // autoCompleteDischargeForLoungeTransfer in dischargeService.ts.
  const movingToLounge = !isReadmit && !!selectedWardEarly?.is_discharge_lounge;
  // If System Checkout is already COMPLETED, Physical Checkout (which this
  // transfer completes) is the last thing needed — completeIfEligible fires
  // immediately server-side and the discharge finishes + bed vacates in the
  // same request. The patient never visibly sits in the Lounge in that case,
  // so the confirmation card needs different wording than the normal
  // "System Checkout still pending" case.
  const systemCheckoutAlreadyDone = bed.discharge_tracking?.system_checkout_status === "COMPLETED";
  // Readmit is blocked server-side while a discharge is still running — the
  // patient must have the discharge cancelled first (surfaced below as a
  // blocking banner, not just a post-click error).
  const readmitBlocked = isReadmit && dischargeInProgress;

  async function doSubmit() {
    setSaving(true); setError("");
    try {
      const r = submit
        ? await submit(Number(toWardId), Number(toBedId), reason.trim())
        : await api.transferBed(bed.id, Number(toWardId), Number(toBedId), reason.trim());
      onSaved(r);
    } catch (e) {
      // 409 = someone else already changed this patient's bed/discharge state
      // underneath us (raced onto the same admission, took the destination bed,
      // etc. — this codebase uses 409 exclusively for that "stale, refresh and
      // see the real state" family, never for a fixable form mistake). Leaving
      // the stale form open with just an inline error would need the user to
      // notice and manually refresh, so instead let the caller close this and
      // pull the real current state automatically.
      if (e.status === 409 && onConflict) { onConflict(toastErr(e)); return; }
      setError(toastErr(e));
    }
    finally { setSaving(false); }
  }

  async function handleConfirmClick() {
    if (!toBedId || !reason.trim() || readmitBlocked) return;
    if (movingToLounge) { setLoungeConfirmOpen(true); return; }
    await doSubmit();
  }

  const outOfScope = selectedWardEarly && !selectedWardEarly.inMyScope;

  return (
    <div style={{ background: "var(--panel-2)", borderRadius: 10, padding: 14, marginTop: 10 }}>
      {readmitBlocked && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, fontWeight: 600,
          color: "var(--red, #dc2626)", background: "var(--red-bg, #FEE2E2)", borderRadius: 8,
          padding: "10px 12px", marginBottom: 12,
        }}>
          <Ic d={icons.alert} s={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>This discharge is still in progress. Cancel the discharge process before readmitting this patient — go to Discharge Details and cancel the discharge, then come back here.</span>
        </div>
      )}
      <label className="label">Destination Ward</label>
      {wardsError ? (
        <div style={{ fontSize: 12, color: "var(--red)", padding: "6px 0", marginBottom: 10 }}>{wardsError}</div>
      ) : wards === null ? (
        <div className="dim" style={{ fontSize: 12, padding: "6px 0", marginBottom: 10 }}>Loading wards…</div>
      ) : (
        <select className="field" value={toWardId} onChange={(e) => setToWardId(Number(e.target.value))} style={{ marginBottom: 10 }}>
          {wards.map((w) => <option key={w.id} value={w.id}>{w.ward}</option>)}
        </select>
      )}
      {outOfScope && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, fontWeight: 600,
          color: "var(--amber, #b45309)", background: "var(--warn-bg, #fff3cd)", borderRadius: 8,
          padding: "8px 10px", marginBottom: 10,
        }}>
          <Ic d={icons.alert} s={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>This ward is outside your usual assignment — double-check before transferring here.</span>
        </div>
      )}
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
      <textarea className="field" value={reason} maxLength={50} rows={2} placeholder="Transfer reason *"
        onChange={(e) => setReason(e.target.value)}
        style={{ resize: "vertical", fontSize: 13, fontFamily: "inherit", marginBottom: 2 }} />
      <div style={{ fontSize: 11, color: "var(--ink-3)", textAlign: "right", marginBottom: 8 }}>{reason.length}/50</div>
      {error && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: "8px 14px" }} onClick={onClose}>Back</button>
        <button className="btn btn-primary" style={{ fontSize: 12, padding: "8px 14px" }} disabled={saving || !toBedId || !reason.trim() || readmitBlocked} onClick={handleConfirmClick}>
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
      {confirmDialog}
      {loungeConfirmOpen && (
        <MoveToLoungeConfirmModal
          systemCheckoutAlreadyDone={systemCheckoutAlreadyDone}
          onCancel={() => setLoungeConfirmOpen(false)}
          onConfirm={() => { setLoungeConfirmOpen(false); doSubmit(); }}
        />
      )}
    </div>
  );
}

// Auto-completed on any transfer into the Discharge Lounge — see
// autoCompleteDischargeForLoungeTransfer in dischargeService.ts. Kept in sync
// with that function's forced-step list (every step except System Checkout).
const LOUNGE_AUTO_STEPS = [
  "Discharge Summary", "Drug Return", "Pharmacy Clearance", "Procedure Reconciliation",
  "Billing Started", "Bill Audit", "Bill Finalization", "Payment", "Physical Checkout",
];

function MoveToLoungeConfirmModal({ onCancel, onConfirm, systemCheckoutAlreadyDone }) {
  useModal(onCancel);
  return createPortal(
    <div className="overlay" onClick={onCancel} style={{ alignItems: "center" }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="lounge-confirm-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)", color: "var(--ink)", borderRadius: 16,
          maxWidth: 380, width: "calc(100% - 32px)", margin: "auto",
          padding: "26px 22px 20px", boxShadow: "0 20px 50px rgba(0,0,0,.25)",
          border: "1px solid var(--line)", textAlign: "center", position: "relative",
        }}>
        <button onClick={onCancel} aria-label="Close" style={{
          position: "absolute", top: 14, right: 14, background: "none", border: "none",
          cursor: "pointer", color: "var(--ink-3)", padding: 4, display: "flex",
        }}>
          <Ic d={icons.x} s={18} />
        </button>

        <div style={{
          width: 52, height: 52, borderRadius: "50%", background: "var(--red-bg, #FEE2E2)",
          display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px",
        }}>
          <Ic d={icons.alert} s={24} style={{ color: "var(--red, #dc2626)" }} />
        </div>

        <div id="lounge-confirm-title" style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>
          Move to Discharge Lounge?
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.4, marginBottom: 18 }}>
          {systemCheckoutAlreadyDone
            ? "System Checkout is already complete. This transfer will finish the discharge immediately."
            : "This will automatically complete the discharge process except System Checkout."}
        </div>

        <div style={{
          background: "var(--green-bg, #ECFDF5)", border: "1px solid var(--green, #10b981)",
          borderRadius: 10, padding: "12px 14px", marginBottom: 12, textAlign: "left",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--green, #059669)", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            <Ic d={icons.check} s={15} /> Will be completed automatically
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
            {systemCheckoutAlreadyDone ? [...LOUNGE_AUTO_STEPS, "System Checkout"].join(" | ") : LOUNGE_AUTO_STEPS.join(" | ")}
          </div>
        </div>

        <div style={{
          background: "var(--red-bg, #FEE2E2)", border: "1px solid var(--red, #dc2626)",
          borderRadius: 10, padding: "12px 14px", marginBottom: 12, textAlign: "left",
        }}>
          {systemCheckoutAlreadyDone ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--red, #dc2626)", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                <Ic d={icons.alert} s={15} /> Nothing remaining
              </div>
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, fontWeight: 600,
                color: "var(--red, #dc2626)", background: "rgba(220,38,38,.1)",
                borderRadius: 8, padding: "8px 10px",
              }}>
                <Ic d={icons.alert} s={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>System Checkout is already done — this discharge will complete fully and the bed will vacate right away. The patient will NOT visibly sit in the Discharge Lounge.</span>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--red, #dc2626)", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                <Ic d={icons.clock} s={15} /> Remaining
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                • System Checkout (Pending)
              </div>
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, fontWeight: 600,
                color: "var(--red, #dc2626)", background: "rgba(220,38,38,.1)",
                borderRadius: 8, padding: "8px 10px", marginTop: 10,
              }}>
                <Ic d={icons.alert} s={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Patient will be moved to Discharge Lounge and bed will be available for allocation.</span>
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <button className="btn btn-ghost" style={{ flex: 1, padding: "11px 0", fontSize: 13.5, fontWeight: 700 }} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" style={{ flex: 1, padding: "11px 0", fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }} onClick={onConfirm}>
            <Ic d={icons.bed} s={15} /> Move to Lounge
          </button>
        </div>
      </div>
    </div>,
    document.body
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
              <div className="dim">{item.d.old_value ?? "—"} → {item.d.new_value ?? "—"} · {item.d.changed_by_name ? `${item.d.changed_by_name}${item.d.changed_by_role ? ` (${ROLE_SHORT[item.d.changed_by_role] || item.d.changed_by_role})` : ""}` : "System"} · {fmtDateTime(item.ts)}</div>
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
  // Who completed each step (name + role), keyed by step key — see stepActorsForAdmission.
  const [stepActors, setStepActors] = useState({});
  const [busy, setBusy] = useState(false);
  // { [stepKey]: statusBeingWritten } — one entry per in-flight step save.
  const [savingSteps, setSavingSteps] = useState({});
  const [error, setError] = useState("");
  const [section, setSection] = useState(null); // "plan" | "transfer" | "history" | null
  const [cancelReason, setCancelReason] = useState(null); // string | null (null = hidden)
  const [expandTime, setExpandTime] = useState(false);
  // PRE only, for now — see the "Physical Checkout while System Checkout is still
  // pending" fork below. true while the choice popup is open.

  // Parallel steps mean several saves can be in flight, each followed by its own
  // load(). Responses can come back out of order, so a slow early reply would
  // otherwise overwrite a fresh later one. Only the newest load may write state.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const r = await api.dischargeForBed(bed.id);
      if (seq !== loadSeq.current) return;
      setAdmission(r.admission);
      setTracking(r.tracking);
      setWorkflow(r.workflow ?? null);
      setStepActors(r.stepActors ?? {});
    } catch (e) {
      if (seq !== loadSeq.current) return;
      const msg = toastErr(e);
      if (msg.includes("not under your care") || msg.includes("No active") || msg.includes("not found")) {
        setAdmission(null);
        setTracking(null);
        setWorkflow(null);
        setStepActors({});
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
    const socket = getSocket();
    // This panel's `workflow` (deadlines/ETA/delay state) is computed
    // server-side from the tracking row + phase config — even though some
    // discharge:update payloads carry the raw tracking row, there's no safe
    // way to re-derive workflow from it on the client, so this single-record
    // panel stays a refetch (cheap: it's one admission, not a list).
    const reload = coalesce(() => liveLoadRef.current());
    const onDischargeUpdate = () => reload();
    const onBedUpdate = (p) => {
      // The bed this panel is for changed (e.g. manual vacate resets the workflow)
      if (!p || p.bedId == null || Number(p.bedId) === Number(bed.id)) reload();
    };
    socket.on("discharge:update", onDischargeUpdate);
    socket.on("bed:update", onBedUpdate);
    // Reconnect (not first connect) → catch updates missed while disconnected.
    const offReconnect = onReconnect(socket, () => liveLoadRef.current());
    return () => {
      socket.off("discharge:update", onDischargeUpdate);
      socket.off("bed:update", onBedUpdate);
      offReconnect(); reload.cancel();
    };
  }, [bed.id]);

  const refresh = async () => { setSection(null); await load(); onChanged?.(); };

  // Per-step, not per-page: independent phases (Discharge Summary / Drug Return /
  // Physical Checkout, and the Pharmacy Clearance + Procedure Reconciliation
  // fan-out) can be actioned at the same time without waiting on each other.
  // The value is the status being written, so the row can spin the exact button
  // that was pressed rather than all of them.
  const setStep = async (step, status, opts = {}) => {
    setSavingSteps((prev) => ({ ...prev, [step]: status }));
    setError("");
    try { await api.dischargeUpdateStep(tracking.admission_id, step, status, opts); await refresh(); }
    catch (e) { setError(toastErr(e)); }
    finally {
      setSavingSteps((prev) => {
        const next = { ...prev };
        delete next[step];
        return next;
      });
    }
  };

  const onStepAction = async (step, status, opts = {}) => {
    if (step === "PHYSICAL_CHECKOUT" && status === "COMPLETED" && opts.moveToLounge) {
      await setStep(step, status, opts);
      await moveToLounge(opts.moveNote);
      return;
    }
    setStep(step, status, opts);
  };

  // reason is mandatory — MoveToLoungeNotePopup already keeps its Confirm
  // button disabled until a note is typed, but the backend enforces it too
  // (same rule as an ordinary bed transfer), so this is never called with an
  // empty note.
  const moveToLounge = async (reason) => {
    setBusy(true); setError("");
    try {
      await api.dischargeMoveToLounge(tracking.admission_id, reason);
      await refresh();
    } catch (e) { setError(toastErr(e)); }
    finally { setBusy(false); }
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

  // Page-level actions (Start Discharge / Cancel / Reschedule) keep the original
  // "block while anything is in flight" guard — only the per-step buttons were
  // meant to become independent.
  const anyBusy = busy || Object.keys(savingSteps).length > 0;

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
          {/* Three top-aligned grid cells, so the labels share one line and the
              values share the next. Cells are direct grid children rather than
              a nested flex row — nesting reintroduced the unequal-height
              centring that staggered the labels on phones. */}
          <div className="dc-head">
            <div>
              <div className="dc-k">Status</div>
              <div className="dc-v" style={{ fontSize: 14, fontWeight: 700, color: STATUS_COLOR[tracking.status] }}>
                {tracking.status.replace("_", " ")}
              </div>
            </div>
            {tracking.status === "PLANNED" && (
              <div className="dc-head-time" style={{ cursor: "default" }}>
                <div className="dc-k">Planned</div>
                <div className="dc-v sm dim">
                  {tracking.planned_date}{tracking.planned_time ? ` · ${tracking.planned_time}` : ""}
                </div>
              </div>
            )}
            {/* Once running, the planned date stops being useful — what everyone
                needs is the live estimate and whether the flow is slipping. */}
            {workflow?.expectedTime != null && (() => {
              const now = Date.now();
              const overdue = now > workflow.expectedTime;
              const overdueMins = overdue ? Math.floor((now - workflow.expectedTime) / 60000) : 0;
              return (
                <div className="dc-head-time" onClick={() => setExpandTime(v => !v)}>
                  <div className="dc-k">Est.</div>
                  <div className={"dc-v" + (expandTime ? " sm" : "")} style={{ color: overdue ? "var(--red)" : "var(--ink)" }}>
                    {expandTime ? fmtDateTime(workflow.expectedTime) : fmtClock(workflow.expectedTime)}
                  </div>
                  {overdue && (
                    <span className="dc-chip" style={{ background: "var(--red-bg)", color: "var(--red)" }}>
                      Delayed {fmtMins(overdueMins)}
                    </span>
                  )}
                </div>
              );
            })()}
            {workflow?.eta != null && (
              <div className="dc-head-time" onClick={() => setExpandTime(v => !v)}>
                <div className="dc-k">Expected</div>
                <div className={"dc-v" + (expandTime ? " sm" : "")}>
                  {expandTime ? fmtDateTime(workflow.eta) : fmtClock(workflow.eta)}
                </div>
                {tone && <span className="dc-chip" style={{ background: tone.bg, color: tone.color }}>{tone.label}</span>}
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
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={anyBusy} onClick={initiate}>Start Discharge</button>
              <button className="btn btn-ghost" style={{ flex: 1 }} disabled={anyBusy} onClick={() => setSection("plan")}>Reschedule</button>
              <button className="btn btn-ghost" style={{ flex: 1, color: "var(--st-or)" }} disabled={anyBusy} onClick={() => setCancelReason("")}>Cancel Plan</button>
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
                  <div key={g.id} className="dc-group">
                    {g.steps.map((step, i) => {
                      const status = tracking[step.key.toLowerCase() + "_status"] || "PENDING";
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
                      const afterAllPending = step.afterAll
                        ? step.afterAll
                            .map(k => STEPS.find(s => s.key === k))
                            .filter(s => s && !["COMPLETED", "NOT_APPLICABLE"].includes(tracking[s.key.toLowerCase() + "_status"]))
                        : [];
                      const locked = (step.key === "SYSTEM_CHECKOUT" || step.key === "PHYSICAL_CHECKOUT")
                        ? status === "PENDING" && pendingBefore.length > 0
                        : step.afterAll
                        ? status === "PENDING" && afterAllPending.length > 0
                        : status === "PENDING" && !!depStep && !["COMPLETED", "NOT_APPLICABLE"].includes(depStatus);
                      const lockedOn = (step.key === "SYSTEM_CHECKOUT" || step.key === "PHYSICAL_CHECKOUT")
                        ? (pendingBefore.length === 1
                            ? pendingBefore[0].label
                            : `${pendingBefore.length} steps`)
                        : step.afterAll
                        ? (afterAllPending.length === 1
                            ? afterAllPending[0].label
                            : `${afterAllPending.length} steps`)
                        : (locked ? depStep.label : null);
                      const lockedTitle = (step.key === "SYSTEM_CHECKOUT" || step.key === "PHYSICAL_CHECKOUT") && pendingBefore.length > 1
                        ? pendingBefore.map((s) => s.label).join(", ")
                        : step.afterAll && afterAllPending.length > 1
                        ? afterAllPending.map(s => s.label).join(", ")
                        : undefined;
                      return (
                        <StepRow key={step.key} step={step} role={role} saving={savingSteps[step.key]} status={status}
                          locked={locked} lockedOn={locked ? lockedOn : null} lockedTitle={lockedTitle}
                          onSetStatus={onStepAction} onRequestReopen={onRequestReopen ? (stepKey) => onRequestReopen(bed.admission_id, stepKey) : null}
                          patientLeft={tracking.patient_left}
                          systemCheckoutDone={tracking.system_checkout_status === "COMPLETED"}
                          phase={phaseByKey.get(step.key)} isLast={i === g.steps.length - 1}
                          tracking={tracking} actor={stepActors[step.key]} />
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
              <div style={{ background: "var(--panel-2)", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--st-or)", marginBottom: 6 }}>This discharge is cancelled.</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-2)", display: "flex", flexDirection: "column", gap: 3 }}>
                  <span>Cancelled on: <strong style={{ color: "var(--ink)" }}>{fmtDateTime(tracking.updated_at)}</strong></span>
                  {tracking.planned_date && <span>Originally planned: <strong style={{ color: "var(--ink)" }}>{tracking.planned_date}{tracking.planned_time ? ` · ${tracking.planned_time}` : ""}</strong></span>}
                  {tracking.initiated_at && <span>Was initiated: <strong style={{ color: "var(--ink)" }}>{fmtDateTime(tracking.initiated_at)}</strong></span>}
                </div>
              </div>
              {canPlan && (
                section === "plan" ? (
                  <PlanSection bed={bed} existing={null} onClose={() => setSection(null)} onSaved={refresh} />
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setSection("plan")}>
                      <Ic d={icons.clipboard} s={14} /> Reschedule Discharge
                    </button>
                    <button className="btn btn-primary" style={{ flex: 1 }} disabled={anyBusy} onClick={initiate}>
                      <Ic d={icons.check} s={14} /> Initiate Now
                    </button>
                  </div>
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
                <button className="btn btn-primary" style={{ fontSize: 12, padding: "8px 14px" }} disabled={anyBusy}
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
