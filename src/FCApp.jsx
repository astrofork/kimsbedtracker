import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api, toastErr, createSocket, fmtRelative } from "./lib.js";
import { AppShell } from "./shell.jsx";
import { Ic, icons, useScrollRestore } from "./ui.jsx";
import { fmtIpLast6, normalizeQuery, wardIdsMatchingPatientName, PATIENT_NAME_MIN_QUERY } from "./bedUtils.js";
import DischargesPage from "./DischargesPage.jsx";
import { LiveBedDashboard, OverstayPanel } from "./COOApp.jsx";
import { WardPage, ProfileThemeRow } from "./PREApp.jsx";
import { WardCard } from "./NurseApp.jsx";

// FC's Bed Entry: hospital-wide, operational-wards-only write access (admit,
// edit patient info, transfer). No reviewWard — Review/Submit-round are a
// PRE-specific round-compliance workflow FC's Bed Entry does not have.
const FC_CFG = {
  role: "FC",
  listBeds: (wardId, opts) => api.fcBeds(wardId, opts),
  updateBedStatus: (...a) => api.fcUpdateBedStatus(...a),
  payerTypes: () => api.fcPayerTypes(),
  destinations: () => api.fcDestinations(),
  updateAdmission: (bedId, patch) => api.fcUpdateAdmission(bedId, patch),
  bedDetails: () => api.fcBedDetails(),
};

const SECTIONS = [
  { key: "BILLING_STARTED", label: "Bill Prep Pending", color: "#d97706", bg: "#fef3c7", emptyIcon: icons.fileText, emptyMsg: "No bills awaiting prep." },
  { key: "AUDIT", label: "Bill Audit Pending", color: "#2563eb", bg: "#dbeafe", emptyIcon: icons.clipboard, emptyMsg: "No bills awaiting audit." },
  { key: "BILL_READY", label: "Bill Finalization Pending", color: "#7c3aed", bg: "#ede9fe", emptyIcon: icons.fileText, emptyMsg: "No bills awaiting finalization." },
  { key: "PAYMENT", label: "Payment / Approval Pending", color: "#16a34a", bg: "#dcfce7", emptyIcon: icons.banknote, emptyMsg: "No payments pending." },
  { key: "SYSTEM_CHECKOUT", label: "System Checkout Pending", color: "#0f766e", bg: "#ccfbf1", emptyIcon: icons.logout, emptyMsg: "No discharges awaiting System Checkout." },
];

const STEP_LABEL = { SYSTEM_CHECKOUT: "System Checkout", BILLING_STARTED: "Bill Prep", AUDIT: "Audit", BILL_READY: "Bill Finalized", PAYMENT: "Payment" };

const BILLING_STEPS_ORDER = [
  { key: "BILLING_STARTED", col: "billing_started_status" },
  { key: "AUDIT", col: "audit_status" },
  { key: "BILL_READY", col: "bill_ready_status" },
  { key: "PAYMENT", col: "payment_status" },
  { key: "SYSTEM_CHECKOUT", col: "system_checkout_status" },
];

function completedBillingSteps(row) {
  return BILLING_STEPS_ORDER.filter((s) => row[s.col] === "COMPLETED").map((s) => s.key);
}

function FCCard({ row, color, onComplete, onRequestReopen, busy, isMaster }) {
  const completed = onRequestReopen ? completedBillingSteps(row) : [];

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
                <FCCard key={row.admission_id} row={row} color={section.color}
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
      await api.fcReopenRequest(admissionId, selectedStep, reason.trim());
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

export default function FCApp({ user, onLogout }) {
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
  const [txnFilter, setTxnFilter] = useState("ALL"); // My Transactions ribbon filter
  const loadRef = useRef(() => {});
  const isMaster = user.role === "MASTER_FC";

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2200); }, []);

  // ── Bed Entry (hospital-wide, operational wards only) ──────────────────────
  const [wards, setWards] = useState(null);
  const [openWard, setOpenWard] = useState(null); // { ward, tab } | null
  // Opening a ward replaces the ward-list page with WardPage entirely — save/
  // restore scroll across that swap the same way Entry does in PREApp.jsx.
  // saveWardScroll() must be called at each place that OPENS a ward, before
  // setOpenWard — see useScrollRestore's doc comment for why.
  const saveWardScroll = useScrollRestore(!!openWard);
  const [wardFilter, setWardFilter] = useState("all");
  const [wardSearch, setWardSearch] = useState("");
  const [ipMatch, setIpMatch] = useState(null); // { wardId } | null — resolved IP lookup
  const [ipNotFound, setIpNotFound] = useState(false);
  // Hospital-wide bed list — same data the Home dashboard already fetches —
  // pulled once, lazily, the first time it's needed, then cached for the rest
  // of this page visit. Every IP search after that is a pure client-side scan.
  const [bedDetails, setBedDetails] = useState(null);
  const bedDetailsLoadingRef = useRef(false);
  const loadWardsRef = useRef(() => {});

  // A 6-digit search value is treated as an IP lookup instead of a ward-name
  // filter — FC is hospital-wide, so this can match any ward. Narrows the grid
  // to the one matching ward's card; the user still clicks it, same as any
  // other ward — WardPage's search box is pre-seeded with the IP once opened.
  // A 2+ character non-IP query is ALSO tried as a patient name, on top of the
  // ward-name match it already does. Both lookups need the hospital-wide bed
  // list, so the fetch below now triggers for either.
  const isIpSearch = /^\d{6}$/.test(wardSearch.trim());
  const nameQuery = isIpSearch ? "" : normalizeQuery(wardSearch);
  const needsBedLookup = isIpSearch || nameQuery.length >= PATIENT_NAME_MIN_QUERY;

  useEffect(() => {
    setIpNotFound(false);
    if (!needsBedLookup) { setIpMatch(null); return; }
    if (bedDetails === null) {
      if (!bedDetailsLoadingRef.current) {
        bedDetailsLoadingRef.current = true;
        FC_CFG.bedDetails().then((r) => setBedDetails(r || [])).catch(() => setIpNotFound(true));
      }
      return; // effect re-runs once bedDetails lands
    }
    // Only an IP search reports "not found" — a name query that matches nothing
    // still legitimately falls through to the ward-name filter.
    if (!isIpSearch) { setIpMatch(null); return; }
    const bed = bedDetails.find((b) => b.ip_last6 === wardSearch.trim());
    if (bed) setIpMatch({ wardId: bed.ward_id });
    else { setIpMatch(null); setIpNotFound(true); }
  }, [wardSearch, bedDetails, needsBedLookup, isIpSearch]);

  const nameWardIds = useMemo(
    () => wardIdsMatchingPatientName(bedDetails, nameQuery),
    [bedDetails, nameQuery],
  );

  // Pre-seed the ward's own bed search only when the ward was found VIA a bed —
  // by IP, or by a patient name that isn't also the ward's name. Seeding it with
  // a ward-name query would filter every bed out and land the user on an
  // apparently empty ward.
  const seedSearch = (w) =>
    isIpSearch || (nameWardIds.has(w.id) && !w.ward.toLowerCase().includes(nameQuery))
      ? wardSearch.trim()
      : undefined;

  const loadWards = useCallback(async () => {
    try {
      const r = await api.fcWards();
      setWards(r.wards || []);
    } catch (e) { showToast(toastErr(e)); }
  }, [showToast]);
  loadWardsRef.current = loadWards;

  useEffect(() => { loadWards(); }, [loadWards]);

  const load = useCallback(async () => {
    try {
      const [pipeline, countRes] = await Promise.all([
        api.dischargeBillingPipeline(),
        isMaster ? api.fcReopenPendingCount() : Promise.resolve({ count: 0 }),
      ]);
      setData(pipeline);
      setReopenPending(countRes.count || 0);
      setLastSync(new Date());
    } catch (e) {
      if (e?.message === "Unauthorized") return;
      showToast(toastErr(e));
    }
  }, [showToast, isMaster]);
  loadRef.current = load;

  const loadRequests = useCallback(async () => {
    try {
      const r = await api.fcReopenRequests();
      setReopenRequests(r.requests || []);
    } catch (e) { showToast(toastErr(e)); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "requests") loadRequests(); }, [tab, loadRequests]);

  useEffect(() => {
    const socket = createSocket();
    const refresh = () => { loadRef.current(); loadWardsRef.current(); setLiveKey(k => k + 1); };
    socket.on("discharge:update", refresh);
    socket.on("discharge:overstay", refresh);
    socket.on("bed:update", refresh);
    socket.on("fc:reopen-request", () => { loadRef.current(); setLiveKey(k => k + 1); if (tabRef.current === "requests") loadRequests(); });
    socket.on("connect", refresh);
    return () => { socket.disconnect(); };
  }, []);

  const STEP_TOAST = { SYSTEM_CHECKOUT: "System Checkout complete", BILLING_STARTED: "Bill Prep done", AUDIT: "Audit done", BILL_READY: "Bill finalized", PAYMENT: "Payment complete" };
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
      await api.fcReviewRequest(requestId, action, null);
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
    { key: "entry", icon: icons.grid, label: "Bed Entry" },
    { key: "overstay", icon: icons.alert, label: "Overstay" },
    { key: "discharges", icon: icons.list, label: "Discharges" },
    { key: "requests", icon: icons.clipboard, label: "Reopen Requests", dot: isMaster && reopenPending > 0 },
  ];

  return (
    <div className="preui">
    <AppShell
      menu={menu}
      active={tab}
      onSelect={(k) => { setTab(k); setOpenWard(null); }}
      title={openWard ? "Bed Entry" : (isMaster ? "Master FC" : "Finance Coordinator")}
      user={{ name: user.name || user.username || "FC", role: isMaster ? "MASTER FC" : "FC" }}
      onLogout={onLogout}
      topExtra={null}
    >
      {tab === "dashboard" && (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <div className="stat"><div className="n" style={{ fontSize: 18 }}>{totalPending}</div><div className="l">TOTAL BILLING</div></div>
            <div className="stat"><div className="n" style={{ fontSize: 18 }}>{data.BILLING_STARTED?.length || 0}</div><div className="l">PREP</div></div>
            <div className="stat"><div className="n" style={{ fontSize: 18 }}>{data.AUDIT?.length || 0}</div><div className="l">AUDIT</div></div>
            <div className="stat"><div className="n" style={{ fontSize: 18 }}>{data.BILL_READY?.length || 0}</div><div className="l">FINALIZE</div></div>
            <div className="stat"><div className="n" style={{ fontSize: 18 }}>{data.PAYMENT?.length || 0}</div><div className="l">PAYMENT</div></div>
            <div className="stat"><div className="n" style={{ fontSize: 18 }}>{data.SYSTEM_CHECKOUT?.length || 0}</div><div className="l">CHECKOUT</div></div>
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

          {/* Ribbon — horizontally scrollable filter chips, jumps between step sections */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 14, flexWrap: "nowrap" }}>
            <button className={"fchip" + (txnFilter === "ALL" ? " on" : "")}
              style={{ padding: "8px 16px", fontSize: 13, flexShrink: 0 }}
              onClick={() => setTxnFilter("ALL")}>
              All ({totalPending})
            </button>
            {SECTIONS.map((sec) => (
              <button key={sec.key} className={"fchip" + (txnFilter === sec.key ? " on" : "")}
                style={{ padding: "8px 16px", fontSize: 13, flexShrink: 0, whiteSpace: "nowrap" }}
                onClick={() => setTxnFilter(sec.key)}>
                {STEP_LABEL[sec.key]} ({data[sec.key]?.length || 0})
              </button>
            ))}
          </div>

          {SECTIONS.filter((sec) => txnFilter === "ALL" || txnFilter === sec.key).map((sec) => (
            <CollapsibleSection key={sec.key} section={sec} rows={data[sec.key] || []}
              onComplete={(admissionId) => completeStep(admissionId, sec.key)} busyId={busyId}
              onRequestReopen={!isMaster ? handleRequestReopen : null} isMaster={isMaster} />
          ))}
        </>
      )}

      {tab === "beds" && (
        <LiveBedDashboard refreshKey={liveKey} userName={user.name || user.username || "FC"} scope="fc" />
      )}

      {tab === "entry" && (
        openWard ? (
          <WardPage
            ward={{ ...openWard.ward, ward: openWard.ward.ward }}
            initialTab={openWard.tab}
            initialSearch={openWard.search}
            cfg={FC_CFG}
            onBack={() => { setOpenWard(null); loadWards(); }}
          />
        ) : wards === null ? (
          <div className="empty" style={{ paddingTop: 80 }}>
            <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
            <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>Loading…</div>
          </div>
        ) : (
          <>
            {ipNotFound && (
              <div className="dim" style={{ fontSize: 13, padding: "10px 2px", marginBottom: 8 }}>
                No patient found with that IP.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex" }}>
                  <Ic d={icons.search} s={15} />
                </span>
                <input
                  className="field"
                  value={wardSearch}
                  placeholder="Search ward / patient / IP…"
                  style={{ paddingLeft: 36, paddingRight: wardSearch ? 36 : 13 }}
                  onChange={(e) => setWardSearch(e.target.value)}
                />
                {wardSearch && (
                  <button
                    onClick={() => setWardSearch("")}
                    aria-label="Clear search"
                    style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex", padding: 4, background: "none", border: "none", cursor: "pointer" }}
                  >
                    <Ic d={icons.x} s={14} />
                  </button>
                )}
              </div>
              {wards.length > 1 && (
                <select className="field" aria-label="Filter by ward" value={wardFilter}
                  onChange={(e) => setWardFilter(e.target.value)}
                  style={{ width: "auto", flex: "0 1 auto", maxWidth: 200, fontWeight: 600 }}>
                  <option value="all">All wards ({wards.length})</option>
                  {wards.map((w) => <option key={w.id} value={String(w.id)}>{w.ward}</option>)}
                </select>
              )}
            </div>

            {wards.length === 0 ? (
              <div className="card empty" style={{ marginTop: 20 }}>
                <Ic d={icons.grid} s={32} />
                <div style={{ marginTop: 10, fontWeight: 600 }}>No operational wards</div>
                <div style={{ fontSize: 12, marginTop: 4, color: "var(--ink-3)" }}>
                  Ask the Manager to mark wards operational.
                </div>
              </div>
            ) : (
              <div className="card-grid">
                {wards
                  .filter((w) => {
                    const nq = wardSearch.trim().toLowerCase();
                    // Ward-name and patient-name matches are additive, so adding
                    // patient search never hides a ward the old search would show.
                    return (wardFilter === "all" || String(w.id) === wardFilter) &&
                      (isIpSearch ? ipMatch?.wardId === w.id
                                  : (!nq || w.ward.toLowerCase().includes(nq) || nameWardIds.has(w.id)));
                  })
                  .map((ward, i) => (
                    <WardCard key={ward.id} ward={{ ...ward, name: ward.ward, total_beds: ward.total }} index={i}
                      onOpen={(w, t) => { saveWardScroll(); setOpenWard({ ward: { ...w, ward: w.name }, tab: t, search: seedSearch(ward) }); }} />
                  ))}
              </div>
            )}
          </>
        )
      )}

      {tab === "overstay" && (
        <OverstayPanel loadFn={api.fcOverstay} />
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
    </div>
  );
}
