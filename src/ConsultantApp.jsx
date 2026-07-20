import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, toastErr, createSocket } from "./lib.js";
import { Ic, icons, ThemeToggle } from "./ui.jsx";
import { AppShell } from "./shell.jsx";
import { LiveBedDashboard } from "./COOApp.jsx";
import DischargesPage from "./DischargesPage.jsx";
import { BedGridCard, BedDetailSheet } from "./PREApp.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────
const initialsOf = (s) => (s || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

// Consultant cfg — same WardPage as PRE/Nurse but readOnly=true locks all bed edits;
// only the DischargeTab (role="CONSULTANT") remains interactive.
const CONSULTANT_CFG = {
  role: "CONSULTANT",
  readOnly: true,
  listBeds: (wardId) => api.consultantBeds(wardId),
  payerTypes: () => api.consultantPayerTypes(),
  // updateBedStatus intentionally absent → no status save
  // updateAdmission intentionally absent → no Edit Patient Info button
  // reviewWard intentionally absent → no Review button
};

// ── My Patients page — flat bed grid with ward label on each card ────────────
function MyPatientsPage() {
  const [patients, setPatients] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedBed, setSelectedBed] = useState(null);
  const [loadingBed, setLoadingBed] = useState(false);
  const [toast, setToast] = useState("");
  const [payerTypes, setPayerTypes] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [departments, setDepartments] = useState([]);

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2000); }, []);

  const load = useCallback(async () => {
    setError("");
    try { setPatients((await api.consultantMyPatients()).patients || []); }
    catch (e) { setError(toastErr(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.consultantPayerTypes?.().then(r => setPayerTypes(r.payerTypes || [])).catch(() => {});
    api.departments().then(r => setDepartments(r.departments || [])).catch(() => {});
  }, []);

  const liveRef = useRef(load);
  liveRef.current = load;
  useEffect(() => {
    const socket = createSocket();
    socket.on("bed:update", () => liveRef.current());
    socket.on("discharge:update", () => liveRef.current());
    socket.on("discharge:overstay", () => liveRef.current());
    socket.on("connect", () => liveRef.current());
    return () => socket.disconnect();
  }, []);

  const openBed = async (p) => {
    setLoadingBed(true);
    try {
      const result = await api.consultantBeds(p.ward_id);
      const fullBed = (result.beds || []).find(b => b.id === p.bed_id);
      if (fullBed) {
        setSelectedBed(fullBed);
      } else {
        showToast("Bed not found");
      }
    } catch (e) { showToast(toastErr(e)); }
    finally { setLoadingBed(false); }
  };

  if (selectedBed) {
    return (
      <BedDetailSheet
        bed={selectedBed}
        cfg={CONSULTANT_CFG}
        onClose={() => { setSelectedBed(null); load(); }}
        onChanged={() => load()}
        onToast={showToast}
        payerTypes={payerTypes}
        destinations={destinations}
        departments={departments}
      />
    );
  }

  const filtered = patients
    ? patients.filter(p => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (p.bed_name || "").toLowerCase().includes(q)
          || (p.ward_name || "").toLowerCase().includes(q)
          || (p.ip_last6 || "").toLowerCase().includes(q)
          || (p.payer_type || "").toLowerCase().includes(q);
      })
    : null;

  return (
    <div className="slide-up">
      <div className="row between" style={{ marginBottom: 14, gap: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-.01em" }}>My Patients</div>
          <div className="dim" style={{ fontSize: 12 }}>{patients ? `${patients.length} patient${patients.length !== 1 ? "s" : ""}` : "Loading…"}</div>
        </div>
      </div>

      {patients && patients.length > 0 && (
        <div style={{ position: "relative", maxWidth: 360, marginBottom: 12 }}>
          <Ic d={icons.search} s={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", pointerEvents: "none" }} />
          <input className="field" placeholder="Search bed or IP…" value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 32, fontSize: 13, height: 36, borderRadius: 10, width: "100%" }} />
        </div>
      )}

      {error && (
        <div className="card empty" style={{ padding: "24px 20px" }}>
          <Ic d={icons.alert} s={28} />
          <div style={{ marginTop: 8, fontWeight: 600 }}>{error}</div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={load}>Retry</button>
        </div>
      )}

      {!error && patients === null && (
        <div className="empty" style={{ paddingTop: 60 }}>
          <span className="spin"><Ic d={icons.refresh} s={24} /></span>
        </div>
      )}

      {!error && patients !== null && patients.length === 0 && (
        <div className="card empty" style={{ padding: "32px 20px" }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "var(--panel-2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
            <Ic d={icons.bed} s={26} />
          </div>
          <div style={{ marginTop: 14, fontWeight: 700, fontSize: 15 }}>No patients assigned</div>
          <div className="dim" style={{ fontSize: 13, marginTop: 5 }}>Beds with your name will appear here once admitted.</div>
        </div>
      )}

      {!error && filtered && filtered.length > 0 && (
        <div className="pbed-grid">
          {filtered.map((p) => (
            <BedGridCard
              key={p.bed_id}
              bed={{
                id: p.bed_id,
                bed_name: p.bed_name,
                physical_status: p.physical_status,
                reservation_status: p.reservation_status,
                operational_status: p.operational_status,
                destination: p.destination,
                reservation_note: p.reservation_note,
                updated_at: p.updated_at,
                ip_last6: p.ip_last6,
                consultant_name: p.consultant_name,
                department_name: p.department_name,
                payer_type: p.payer_type,
                admission_type: p.admission_type,
                discharge_tracking: p.discharge_tracking,
              }}
              wardLabel={p.ward_name}
              hideDoctorDept
              onClick={() => openBed(p)}
            />
          ))}
        </div>
      )}

      {loadingBed && (
        <div className="overlay">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <span className="spin"><Ic d={icons.refresh} s={28} /></span>
          </div>
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

// ── Profile page ──────────────────────────────────────────────────────────────
function ProfilePage({ user, onLogout }) {
  return (
    <div className="slide-up">
      <div className="card" style={{ padding: 22, maxWidth: 440 }}>
        <div className="row" style={{ gap: 14, marginBottom: 20 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 15, background: "var(--primary)", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 800, fontSize: 20,
          }}>
            {initialsOf(user.name || user.username)}
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-.01em" }}>{user.name || "—"}</div>
            <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>@{user.username}</div>
            <span className="tag v" style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Ic d={icons.stethoscope} s={12} /> Consultant
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
          <span className="dim" style={{ fontSize: 13 }}>Theme</span>
          <ThemeToggle />
        </div>

        <button className="btn btn-ghost btn-block" style={{ marginTop: 14, color: "var(--red)" }} onClick={onLogout}>
          <Ic d={icons.logout} s={15} /> Logout
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  CONSULTANT APP
// ══════════════════════════════════════════════════════════════════════════════
export default function ConsultantApp({ user, meta, onLogout }) {
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState("");
  const [liveKey, setLiveKey] = useState(0);
  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2600); }, []);

  // Live reload trigger for dashboard
  useEffect(() => {
    const socket = createSocket();
    socket.on("bed:update", () => setLiveKey((k) => k + 1));
    socket.on("discharge:update", () => setLiveKey((k) => k + 1));
    socket.on("discharge:overstay", () => setLiveKey((k) => k + 1));
    return () => socket.disconnect();
  }, []);

  const menu = [
    { key: "dashboard",   icon: icons.home,        label: "Dashboard" },
    { key: "mypatients",  icon: icons.bed,          label: "My Patients" },
    { key: "discharges",  icon: icons.clipboard,   label: "My Discharges" },
    { key: "profile",     icon: icons.user,         label: "Profile" },
  ];

  const title = menu.find((m) => m.key === tab)?.label || "Consultant";

  return (
    <div className="preui">
      <AppShell
        menu={menu}
        active={tab}
        onSelect={(k) => setTab(k)}
        title={title}
        user={{ name: user.name || user.username || "Consultant", role: "CONSULTANT" }}
        onLogout={onLogout}
        topExtra={null}
      >
        {tab === "dashboard" && (
          <LiveBedDashboard
            refreshKey={liveKey}
            userName={user.name || user.username || "Consultant"}
            scope="consultant"
            hideUnitFilter
          />
        )}
        {tab === "mypatients" && <MyPatientsPage showToast={showToast} />}
        {tab === "discharges" && <DischargesPage role="CONSULTANT" />}
        {tab === "profile" && <ProfilePage user={user} onLogout={onLogout} />}

        {toast && <div className="toast">{toast}</div>}
      </AppShell>
    </div>
  );
}
