import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, toastErr, fmtRelative, getSocket, onReconnect, coalesce } from "./lib.js";
import { AppShell } from "./shell.jsx";
import { Ic, icons } from "./ui.jsx";
import { fmtIpLast6 } from "./bedUtils.js";
import DischargesPage from "./DischargesPage.jsx";
import { LiveBedDashboard, OverstayPanel, useLiveBedDashboardData } from "./COOApp.jsx";

const SECTIONS = [
  { key: "DRUG_RETURN", dataKey: "drugReturn", label: "Drug Return Pending", color: "#d97706", bg: "#fef3c7", emptyIcon: icons.fileText, emptyMsg: "All Drug Returns cleared." },
  { key: "PHARMACY_CLEARANCE", dataKey: "pharmacyClearance", label: "Pharmacy Clearance Pending", color: "#2563eb", bg: "#dbeafe", emptyIcon: icons.clipboard, emptyMsg: "All Pharmacy Clearances done." },
  { key: "PROCEDURE_RECONCILIATION", dataKey: "procedureReconciliation", label: "OT / Cat Clearance Pending", color: "#7c3aed", bg: "#ede9fe", emptyIcon: icons.fileText, emptyMsg: "All OT / Cat Clearances done." },
];

const STEP_LABEL = { DRUG_RETURN: "Drug Return", PHARMACY_CLEARANCE: "Pharmacy Clearance", PROCEDURE_RECONCILIATION: "OT / Cat Clearance" };

const PHARMACY_STEPS_ORDER = [
  { key: "DRUG_RETURN", col: "drug_return_status" },
  { key: "PHARMACY_CLEARANCE", col: "pharmacy_clearance_status" },
  { key: "PROCEDURE_RECONCILIATION", col: "procedure_reconciliation_status" },
];

function completedPharmacySteps(row) {
  return PHARMACY_STEPS_ORDER.filter((s) => row[s.col] === "COMPLETED").map((s) => s.key);
}

function PharmacyCard({ row, color, onComplete, onRequestReopen, busy, isMaster }) {
  const completed = onRequestReopen ? completedPharmacySteps(row) : [];

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 5,
      background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12,
      padding: "10px 11px", boxShadow: "var(--shadow)", textAlign: "left", minHeight: 90,
    }}>
      <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-.01em", lineHeight: 1.2, wordBreak: "break-word" }}>
        {row.bed_name}
      </span>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, lineHeight: 1.4 }}>
        <span style={{ color: "var(--ink-3)", fontWeight: 600, flexShrink: 0 }}>IP</span>
        <span style={{ fontWeight: 700, color: "var(--ink)", textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.ip_last6 || "—"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, lineHeight: 1.4 }}>
        <span style={{ color: "var(--ink-3)", fontWeight: 600, flexShrink: 0 }}>Ward</span>
        <span style={{ fontWeight: 700, color: "var(--ink)", textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.ward_name}>
          {row.ward_name}
        </span>
      </div>
      <div style={{ fontSize: 10, color: "var(--ink-3)", fontWeight: 500 }}>
        {fmtRelative(row.updated_at)}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: "auto" }}>
        <button
          className="btn btn-primary"
          style={{
            flex: 1, padding: "5px 0", borderRadius: 7, fontSize: 11, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
          }}
          disabled={busy}
          onClick={() => onComplete(row.admission_id)}
        >
          <Ic d={icons.check} s={13} /> Done
        </button>
        {completed.length > 0 && (
          <button
            className="btn btn-ghost"
            style={{
              padding: "5px 8px", borderRadius: 7, fontSize: 10, fontWeight: 700,
              color: "var(--amber)", display: "flex", alignItems: "center", gap: 3,
            }}
            disabled={busy}
            onClick={() => onRequestReopen(row.admission_id, completed)}
            title="Request reopen of a completed step"
          >
            <Ic d={icons.refresh} s={12} /> Reopen
          </button>
        )}
      </div>
    </div>
  );
}

function CollapsibleSection({ section, rows, onComplete, onRequestReopen, busyId, isMaster }) {
  const [open, setOpen] = useState(true);
  const count = rows.length;

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%",
          background: section.bg, border: "none", borderRadius: 10, padding: "11px 14px",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          width: 24, height: 24, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
          background: section.color, color: "#fff", fontSize: 15, fontWeight: 800, flexShrink: 0,
        }}>
          {open ? "−" : "+"}
        </span>
        <span style={{ fontWeight: 700, fontSize: 14, color: section.color, flex: 1 }}>
          {section.label}
        </span>
        <span style={{
          fontWeight: 800, fontSize: 12, color: "#fff", background: count > 0 ? section.color : "var(--ink-3)",
          borderRadius: 99, padding: "3px 10px", minWidth: 26, textAlign: "center", flexShrink: 0,
        }}>
          {count}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 8 }}>
          {count === 0 ? (
            <div className="card empty" style={{ padding: 22 }}>
              <Ic d={section.emptyIcon} s={24} />
              <div style={{ marginTop: 6, fontSize: 12 }} className="dim">{section.emptyMsg}</div>
            </div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
              gap: 8,
            }}>
              {rows.map((row) => (
                <PharmacyCard key={row.admission_id} row={row} color={section.color}
                  onComplete={onComplete} onRequestReopen={onRequestReopen}
                  busy={busyId === row.admission_id} isMaster={isMaster} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NaSection({ rows }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 14 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%",
          background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 14px",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          width: 24, height: 24, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
          background: "#6b7280", color: "#fff", fontSize: 15, fontWeight: 800, flexShrink: 0,
        }}>
          {open ? "−" : "+"}
        </span>
        <span style={{ fontWeight: 700, fontSize: 14, color: "#6b7280", flex: 1 }}>
          OT / Cat Clearance — N/A
        </span>
        <span style={{
          fontWeight: 800, fontSize: 12, color: "#fff", background: "#6b7280",
          borderRadius: 99, padding: "3px 10px", minWidth: 26, textAlign: "center", flexShrink: 0,
        }}>
          {rows.length}
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
            gap: 8,
          }}>
            {rows.map((row) => (
              <div key={row.admission_id} style={{
                display: "flex", flexDirection: "column", gap: 5,
                background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12,
                padding: "10px 11px", boxShadow: "var(--shadow)", textAlign: "left", minHeight: 90,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-.01em", lineHeight: 1.2 }}>
                    {row.bed_name}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 800, color: "#6b7280", background: "#f3f4f6",
                    borderRadius: 6, padding: "2px 6px",
                  }}>N/A</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, lineHeight: 1.4 }}>
                  <span style={{ color: "var(--ink-3)", fontWeight: 600, flexShrink: 0 }}>IP</span>
                  <span style={{ fontWeight: 700, color: "var(--ink)" }}>{row.ip_last6 || "—"}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, lineHeight: 1.4 }}>
                  <span style={{ color: "var(--ink-3)", fontWeight: 600, flexShrink: 0 }}>Ward</span>
                  <span style={{ fontWeight: 700, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.ward_name}>{row.ward_name}</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--ink-3)", fontWeight: 500 }}>
                  {fmtRelative(row.updated_at)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReopenRequestCard({ req: r, isMaster, onReview, busy }) {
  return (
    <div className="card" style={{ padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{r.ward_name} · {r.bed_name}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--amber)", marginTop: 2 }}>
            Reopen: {STEP_LABEL[r.step_key] || r.step_key}
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>Reason: {r.reason}</div>
          <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
            Requested by {r.requester_name || "—"} · {fmtRelative(r.created_at)}
          </div>
          {r.status !== "PENDING" && (
            <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, color: r.status === "APPROVED" ? "var(--green)" : "var(--red)" }}>
              {r.status}{r.review_note ? ` — ${r.review_note}` : ""}
            </div>
          )}
        </div>
        {isMaster && r.status === "PENDING" && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button className="btn btn-primary" style={{ fontSize: 12, padding: "6px 10px" }} disabled={busy}
              onClick={() => onReview(r.id, "APPROVED")}>
              <Ic d={icons.check} s={12} /> Approve
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px", color: "var(--red)" }} disabled={busy}
              onClick={() => onReview(r.id, "DENIED")}>
              Deny
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReopenModal({ admissionId, stepKeys, onClose, onSubmitted, showToast }) {
  const keys = Array.isArray(stepKeys) ? stepKeys : [stepKeys];
  const [selectedStep, setSelectedStep] = useState(keys[0]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim()) { showToast("Please provide a reason"); return; }
    setBusy(true);
    try {
      await api.pharmacyReopenRequest(admissionId, selectedStep, reason.trim());
      onSubmitted();
    } catch (e) { showToast(toastErr(e)); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>
            Request Reopen
          </div>
          {keys.length > 1 ? (
            <>
              <label className="label" style={{ fontSize: 12, marginBottom: 4 }}>Which step to reopen?</label>
              <select className="field" value={selectedStep} onChange={(e) => setSelectedStep(e.target.value)}
                style={{ marginBottom: 12, fontWeight: 600, fontSize: 13 }}>
                {keys.map((k) => <option key={k} value={k}>{STEP_LABEL[k] || k}</option>)}
              </select>
            </>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--amber)", marginBottom: 12 }}>
              Step: {STEP_LABEL[selectedStep] || selectedStep}
            </div>
          )}
          <label className="label" style={{ fontSize: 12, marginBottom: 4 }}>Reason</label>
          <textarea
            className="field" placeholder="Why should this step be reopened?"
            value={reason} onChange={(e) => setReason(e.target.value)}
            rows={3} style={{ width: "100%", resize: "vertical", fontSize: 13 }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy ? "Sending…" : "Submit Request"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PharmacyApp({ user, onLogout }) {
  const [tab, setTab] = useState("beds");
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [data, setData] = useState(null);
  const [toast, setToast] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [reopenPending, setReopenPending] = useState(0);
  const [reopenRequests, setReopenRequests] = useState([]);
  const [reopenModal, setReopenModal] = useState(null);
  const [liveKey, setLiveKey] = useState(0);
  // Lives here, above the tab switch, so it survives navigating away from and
  // back to the "beds" (Dashboard) tab — see useLiveBedDashboardData. Note:
  // like FC, the nav key "beds" is labeled "Dashboard" and renders
  // LiveBedDashboard; key "dashboard" is labeled "My Transactions".
  const dashboardData = useLiveBedDashboardData("pharmacy", tab === "beds");
  const loadRef = useRef(() => {});
  const isMaster = user.role === "MASTER_PHARMACY";

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2200); }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.pharmacyDashboard();
      setData({
        DRUG_RETURN: r.drugReturn || [],
        PHARMACY_CLEARANCE: r.pharmacyClearance || [],
        PROCEDURE_RECONCILIATION: r.procedureReconciliation || [],
        PROCEDURE_NA: r.procedureNA || [],
      });
      setReopenPending(r.reopenPending || 0);
      setLastSync(new Date());
    } catch (e) {
      if (e?.message === "Unauthorized") return;
      showToast(toastErr(e));
    }
  }, [showToast]);
  loadRef.current = load;

  const loadRequests = useCallback(async () => {
    try {
      const r = await api.pharmacyReopenRequests();
      setReopenRequests(r.requests || []);
    } catch (e) { showToast(toastErr(e)); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "requests") loadRequests(); }, [tab, loadRequests]);

  // load() feeds the "My Transactions" buckets, which render only on that tab —
  // and the app opens on "beds". Refetching them for a screen nobody is on is
  // waste, so the refresh is remembered and replayed when the tab is opened.
  const pharmStaleRef = useRef(false);
  useEffect(() => {
    if (tab === "dashboard" && pharmStaleRef.current) { pharmStaleRef.current = false; load(); }
  }, [tab, load]);

  useEffect(() => {
    const socket = getSocket();
    // Server-bucketed-by-step lists (like FC's billing pipeline) — bucket
    // membership is business logic computed server-side, so this stays a
    // refetch rather than a client-side patch.
    const refresh = coalesce(() => { pharmStaleRef.current = false; loadRef.current(); setLiveKey(k => k + 1); });
    // Skipped while the buckets are off screen — see pharmStaleRef above. The
    // MASTER_PHARMACY "Reopen Requests" dot is fed by its own
    // pharmacy:reopen-request event below, which is never gated.
    const gated = () => { if (tabRef.current !== "dashboard") { pharmStaleRef.current = true; return; } refresh(); };
    const onReopenRequest = () => { loadRef.current(); setLiveKey(k => k + 1); if (tabRef.current === "requests") loadRequests(); };
    socket.on("discharge:update", gated);
    socket.on("discharge:overstay", gated);
    socket.on("bed:update", gated);
    socket.on("pharmacy:reopen-request", onReopenRequest);
    // Only a RECONNECT refreshes — the first connect would duplicate the
    // mount-time load() a few hundred ms later. See onReconnect().
    // Never gated: after a disconnect nothing local can be trusted.
    const offReconnect = onReconnect(socket, refresh);
    return () => {
      socket.off("discharge:update", gated);
      socket.off("discharge:overstay", gated);
      socket.off("bed:update", gated);
      socket.off("pharmacy:reopen-request", onReopenRequest);
      offReconnect(); refresh.cancel();
    };
  }, [loadRequests]);

  const STEP_TOAST = { DRUG_RETURN: "Drug Return done", PHARMACY_CLEARANCE: "Pharmacy Clearance done", PROCEDURE_RECONCILIATION: "OT / Cat Clearance done" };
  const completeStep = async (admissionId, stepKey) => {
    setBusyId(admissionId);
    const label = STEP_TOAST[stepKey] || "Step completed";
    try {
      await api.dischargeUpdateStep(admissionId, stepKey, "COMPLETED");
      showToast(label);
      await load();
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusyId(null); }
  };

  const reviewRequest = async (requestId, action) => {
    setBusyId(requestId);
    try {
      await api.pharmacyReviewRequest(requestId, action, null);
      showToast(action === "APPROVED" ? "Request approved — step reopened" : "Request denied");
      await loadRequests();
      await load();
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusyId(null); }
  };

  const handleRequestReopen = (admissionId, stepKeysOrKey) => {
    const stepKeys = Array.isArray(stepKeysOrKey) ? stepKeysOrKey : [stepKeysOrKey];
    setReopenModal({ admissionId, stepKeys });
  };

  if (!data) return (
    <div className="empty" style={{ paddingTop: 120 }}>
      <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
      <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>Loading…</div>
    </div>
  );

  const totalPending = SECTIONS.reduce((n, s) => n + (data[s.key]?.length || 0), 0);

  const menu = [
    { key: "beds", icon: icons.home, label: "Dashboard" },
    { key: "dashboard", icon: icons.bed, label: "My Transactions" },
    { key: "overstay", icon: icons.alert, label: "Overstay" },
    { key: "discharges", icon: icons.list, label: "Discharges" },
    { key: "requests", icon: icons.clipboard, label: "Reopen Requests", dot: isMaster && reopenPending > 0 },
  ];

  return (
    <AppShell
      menu={menu}
      active={tab}
      onSelect={setTab}
      title={isMaster ? "Master Pharmacy" : "Pharmacy"}
      user={{ name: user.name || user.username || "Pharmacy", role: isMaster ? "MASTER PHARMACY" : "PHARMACY" }}
      onLogout={onLogout}
      topExtra={null}
    >
      {tab === "dashboard" && (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <div className="stat"><div className="n" style={{ fontSize: 18 }}>{totalPending}</div><div className="l">TOTAL PENDING</div></div>
            <div className="stat"><div className="n" style={{ fontSize: 18 }}>{data.DRUG_RETURN?.length || 0}</div><div className="l">DRUG RETURN</div></div>
            <div className="stat"><div className="n" style={{ fontSize: 18 }}>{data.PHARMACY_CLEARANCE?.length || 0}</div><div className="l">PHARMACY CLR</div></div>
            <div className="stat"><div className="n" style={{ fontSize: 18 }}>{data.PROCEDURE_RECONCILIATION?.length || 0}</div><div className="l">OT / CAT CLR</div></div>
            <div className="stat"><div className="n" style={{ fontSize: 18, color: "#6b7280" }}>{data.PROCEDURE_NA?.length || 0}</div><div className="l">OT / CAT N/A</div></div>
            <div className="stat">
              <div className="n" style={{ fontSize: 18 }}>{lastSync ? lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</div>
              <div className="l">LAST UPDATE</div>
            </div>
          </div>

          {isMaster && reopenPending > 0 && (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 14,
                background: "#fef3c7", borderRadius: 10, padding: "10px 14px", cursor: "pointer",
              }}
              onClick={() => setTab("requests")}
            >
              <Ic d={icons.alert} s={16} style={{ color: "#d97706", flexShrink: 0 }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: "#d97706" }}>
                {reopenPending} pending reopen {reopenPending === 1 ? "request" : "requests"} — tap to review
              </div>
            </div>
          )}

          {SECTIONS.map((sec) => (
            <CollapsibleSection key={sec.key} section={sec} rows={data[sec.key] || []}
              onComplete={(admissionId) => completeStep(admissionId, sec.key)} busyId={busyId}
              onRequestReopen={!isMaster ? handleRequestReopen : null} isMaster={isMaster} />
          ))}

          {(data.PROCEDURE_NA?.length > 0) && (
            <NaSection rows={data.PROCEDURE_NA} />
          )}
        </>
      )}

      {tab === "beds" && (
        <LiveBedDashboard data={dashboardData} userName={user.name || user.username || "Pharmacy"} scope="pharmacy" />
      )}

      {tab === "overstay" && (
        <OverstayPanel loadFn={api.pharmacyOverstay} />
      )}

      {tab === "discharges" && (
        <DischargesPage role={user.role} onRequestReopen={!isMaster ? handleRequestReopen : null} />
      )}

      {tab === "requests" && (
        <>
          <div className="floor-head" style={{ marginBottom: 10 }}>
            {isMaster ? "Pending Reopen Requests" : "My Reopen Requests"}
          </div>
          {reopenRequests.length === 0 ? (
            <div className="card empty" style={{ marginTop: 8 }}>
              <Ic d={icons.clipboard} s={28} />
              <div style={{ marginTop: 8, fontSize: 13 }} className="dim">
                {isMaster ? "No pending reopen requests." : "You haven't submitted any reopen requests."}
              </div>
            </div>
          ) : (
            reopenRequests.map((r) => (
              <ReopenRequestCard key={r.id} req={r} isMaster={isMaster}
                onReview={reviewRequest} busy={busyId === r.id} />
            ))
          )}
        </>
      )}

      {reopenModal && (
        <ReopenModal
          admissionId={reopenModal.admissionId}
          stepKeys={reopenModal.stepKeys}
          onClose={() => setReopenModal(null)}
          onSubmitted={() => { setReopenModal(null); showToast("Reopen request submitted"); load(); }}
          showToast={showToast}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </AppShell>
  );
}
