import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, toastErr, fmtDateTime, createSocket } from "./lib.js";
import { Ic, icons } from "./ui.jsx";
import { fmtIpLast6 } from "./bedUtils.js";

// Steps are organized into 5 groups. Groups run in parallel — none of them wait
// on another group. Within a group, steps unlock in order: a step can't be
// marked complete until the step before it in the same group is Completed (or
// N/A) — see the "locked" computation where GROUPS is built below.
const GROUP_LABELS = {
  1: "Doctor Summary",
  2: "Drug & Clinical Clearance",
  3: "Billing & Payment",
  4: "System Checkout",
  5: "Physical Checkout",
};
const STEPS = [
  { key: "DISCHARGE_SUMMARY", label: "Discharge Summary", roles: ["DOCTOR"], group: 1 },
  { key: "DRUG_RETURN", label: "Drug Return", roles: ["PRE", "NURSE"], group: 2 },
  { key: "PHARMACY_CLEARANCE", label: "Pharmacy Clearance", roles: ["PRE", "NURSE"], group: 2 },
  { key: "PROCEDURE_RECONCILIATION", label: "Procedure Reconciliation (OT / Cath Lab)", roles: ["PRE"], allowNA: true, group: 2 },
  { key: "BILLING_STARTED", label: "Billing Started", roles: ["PRE"], group: 3 },
  { key: "AUDIT", label: "Audit", roles: ["PRE"], group: 3 },
  { key: "BILL_READY", label: "Bill Ready", roles: ["FC"], group: 3 },
  { key: "PAYMENT", label: "Payment", roles: ["FC"], group: 3 },
  { key: "SYSTEM_CHECKOUT", label: "System Checkout", roles: ["PRE"], group: 4 },
  { key: "PHYSICAL_CHECKOUT", label: "Physical Checkout", roles: ["PRE", "NURSE"], needsPatientLeft: true, group: 5 },
];
const GROUPS = Object.keys(GROUP_LABELS).map((id) => ({
  id: Number(id), label: GROUP_LABELS[id], steps: STEPS.filter((s) => s.group === Number(id)),
}));
// Every step System Checkout must wait on — everything except itself and Physical
// Checkout (which runs after/parallel to it, not before). Mirrors the backend gate
// in dischargeService.updateStep so the button reflects what the API will actually allow.
const PRE_SYSTEM_CHECKOUT_STEPS = STEPS.filter((s) => !["SYSTEM_CHECKOUT", "PHYSICAL_CHECKOUT"].includes(s.key));
const PLAN_ROLES = ["PRE", "DOCTOR"];

const STATUS_COLOR = {
  PENDING: "var(--ink-3)", COMPLETED: "var(--st-v)", NOT_APPLICABLE: "var(--ink-3)",
  PLANNED: "var(--st-vr)", DISCHARGE_INITIATED: "var(--primary)", IN_PROGRESS: "var(--primary)",
  CANCELLED: "var(--st-or)",
};

function todayStr(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function StepRow({ step, status, role, onSetStatus, busy, locked, lockedOn, lockedTitle, patientLeft }) {
  const [pickingLeft, setPickingLeft] = useState(false);
  const canAct = step.roles.includes(role);
  const showPatientLeft = step.needsPatientLeft && status === "COMPLETED";

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--line)", gap: 10, opacity: locked ? 0.55 : 1 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{step.label}</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[status] || "var(--ink-3)", marginTop: 2 }}>{status.replace("_", " ")}</div>
        {showPatientLeft && (
          <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: patientLeft ? "var(--st-v)" : "var(--st-or)" }}>
            <Ic d={patientLeft ? icons.check : icons.alert} s={11} /> {patientLeft ? "Patient has left" : "Patient has NOT left"}
          </div>
        )}
      </div>
      {locked ? (
        <span className="dim" title={lockedTitle} style={{ fontSize: 11, flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
          <Ic d={icons.ban} s={12} /> After {lockedOn}
        </span>
      ) : !canAct ? (
        <span className="dim" style={{ fontSize: 11, flexShrink: 0 }}>{step.roles.join("/")}-only</span>
      ) : pickingLeft ? (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button className="btn btn-primary" style={{ fontSize: 11, padding: "6px 10px" }} disabled={busy}
            onClick={() => { setPickingLeft(false); onSetStatus(step.key, "COMPLETED", { patientLeft: true }); }}>Patient left: Yes</button>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "6px 10px" }} disabled={busy}
            onClick={() => { setPickingLeft(false); onSetStatus(step.key, "COMPLETED", { patientLeft: false }); }}>No</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {status === "PENDING" && step.allowNA && (
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "6px 10px" }} disabled={busy}
              onClick={() => onSetStatus(step.key, "NOT_APPLICABLE")}>N/A</button>
          )}
          {status !== "COMPLETED" && (
            <button className="btn btn-primary" style={{ fontSize: 11, padding: "6px 10px" }} disabled={busy}
              onClick={() => step.needsPatientLeft ? setPickingLeft(true) : onSetStatus(step.key, "COMPLETED")}>
              Mark Completed
            </button>
          )}
          {status !== "PENDING" && (
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "6px 10px" }} disabled={busy}
              onClick={() => onSetStatus(step.key, "PENDING")}>Reopen</button>
          )}
        </div>
      )}
    </div>
  );
}

function PlanSection({ bed, existing, onClose, onSaved }) {
  const [option, setOption] = useState("today");
  const [customDate, setCustomDate] = useState(existing?.planned_date || todayStr());
  const [time, setTime] = useState(existing?.planned_time || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const plannedDate = option === "today" ? todayStr() : option === "tomorrow" ? todayStr(1) : customDate;

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
        {[["today", "Today"], ["tomorrow", "Tomorrow"], ["custom", "Custom"]].map(([val, lbl]) => (
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
export default function DischargeTab({ bed, role, onChanged }) {
  const [admission, setAdmission] = useState(undefined);
  const [tracking, setTracking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState(null); // "plan" | "transfer" | "history" | null
  const [cancelReason, setCancelReason] = useState(null); // string | null (null = hidden)
  // PRE only, for now — see the "Physical Checkout while System Checkout is still
  // pending" fork below. true while the choice popup is open.
  const [physicalFork, setPhysicalFork] = useState(false);
  const [loungeMoved, setLoungeMoved] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.dischargeForBed(bed.id);
      setAdmission(r.admission);
      setTracking(r.tracking);
    } catch (e) { setError(toastErr(e)); }
  }, [bed.id]);

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
    if (step === "PHYSICAL_CHECKOUT" && status === "COMPLETED" && opts.patientLeft === true
        && role === "PRE" && tracking.system_checkout_status !== "COMPLETED") {
      setPhysicalFork(true);
      return;
    }
    setStep(step, status, opts);
  };

  const moveToLounge = async () => {
    setBusy(true); setError("");
    try {
      await api.dischargeUpdateStep(tracking.admission_id, "PHYSICAL_CHECKOUT", "COMPLETED", { patientLeft: true });
      await api.dischargeMoveToLounge(tracking.admission_id);
      setPhysicalFork(false);
      setLoungeMoved(true);
      await refresh();
    } catch (e) { setError(toastErr(e)); }
    finally { setBusy(false); }
  };

  const completePhysicalAndSystem = async () => {
    setBusy(true); setError("");
    try {
      await api.dischargeUpdateStep(tracking.admission_id, "PHYSICAL_CHECKOUT", "COMPLETED", { patientLeft: true });
      await api.dischargeUpdateStep(tracking.admission_id, "SYSTEM_CHECKOUT", "COMPLETED");
      setPhysicalFork(false);
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

  const canPlan = PLAN_ROLES.includes(role);
  const running = tracking && ["DISCHARGE_INITIATED", "IN_PROGRESS"].includes(tracking.status);

  if (admission === undefined) return <div className="dim" style={{ fontSize: 13, padding: "16px 0", textAlign: "center" }}>Loading…</div>;
  if (admission === null) return (
    <div className="card empty" style={{ padding: 20, marginTop: 4 }}>
      <Ic d={icons.bed} s={24} />
      {loungeMoved ? (
        <>
          <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: "var(--st-v)" }}>Moved to Discharge Lounge</div>
          <div style={{ marginTop: 4, fontSize: 12 }} className="dim">
            This bed is now vacant — the discharge continues on a lounge bed pending System Checkout.
          </div>
        </>
      ) : (
        <div style={{ marginTop: 8, fontSize: 13 }} className="dim">No active patient admission on this bed.</div>
      )}
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
          </div>

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
              <div style={{ marginBottom: 8 }}>
                {GROUPS.map((g) => (
                  <div key={g.id} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--ink-3)", letterSpacing: 0.6, textTransform: "uppercase", margin: "10px 0 2px" }}>
                      {g.label}
                    </div>
                    {g.steps.map((step, i) => {
                      const status = tracking[step.key.toLowerCase() + "_status"];
                      const prev = i > 0 ? g.steps[i - 1] : null;
                      const prevStatus = prev ? tracking[prev.key.toLowerCase() + "_status"] : null;
                      // System Checkout is a lone step in its own group, so the normal
                      // "previous step in this group" check never fires for it — it needs
                      // every OTHER step in the flow done first, not just one.
                      const pendingBeforeCheckout = step.key === "SYSTEM_CHECKOUT"
                        ? PRE_SYSTEM_CHECKOUT_STEPS.filter((s) => !["COMPLETED", "NOT_APPLICABLE"].includes(tracking[s.key.toLowerCase() + "_status"]))
                        : [];
                      const locked = step.key === "SYSTEM_CHECKOUT"
                        ? status === "PENDING" && pendingBeforeCheckout.length > 0
                        : status === "PENDING" && !!prev && !["COMPLETED", "NOT_APPLICABLE"].includes(prevStatus);
                      const lockedOn = step.key === "SYSTEM_CHECKOUT"
                        ? (pendingBeforeCheckout.length === 1
                            ? pendingBeforeCheckout[0].label
                            : `${pendingBeforeCheckout.length} steps`)
                        : (locked ? prev.label : null);
                      const lockedTitle = step.key === "SYSTEM_CHECKOUT" && pendingBeforeCheckout.length > 1
                        ? pendingBeforeCheckout.map((s) => s.label).join(", ")
                        : undefined;
                      return (
                        <StepRow key={step.key} step={step} role={role} busy={busy} status={status}
                          locked={locked} lockedOn={locked ? lockedOn : null} lockedTitle={lockedTitle}
                          onSetStatus={onStepAction} patientLeft={tracking.patient_left} />
                      );
                    })}
                  </div>
                ))}
              </div>

              {physicalFork && (
                <div style={{ background: "var(--panel-2)", borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>Patient has left — System Checkout isn't done yet</div>
                  <div className="dim" style={{ fontSize: 12, marginBottom: 12 }}>
                    This bed can't stay Occupied. Move it to the Discharge Lounge and free it up now,
                    or complete System Checkout in the same step and finish the discharge.
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn btn-primary" style={{ flex: "1 1 160px", fontSize: 12.5 }}
                      disabled={busy} onClick={moveToLounge}>
                      <Ic d={icons.exchange} s={13} /> Move to Discharge Lounge
                    </button>
                    <button className="btn btn-ghost" style={{ flex: "1 1 160px", fontSize: 12.5 }}
                      disabled={busy} onClick={completePhysicalAndSystem}>
                      Mark System Checkout Complete Too
                    </button>
                  </div>
                  <button className="btn btn-ghost" style={{ width: "100%", marginTop: 8, fontSize: 11.5, color: "var(--ink-3)" }}
                    disabled={busy} onClick={() => setPhysicalFork(false)}>Back</button>
                </div>
              )}

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
