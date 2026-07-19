import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, toastErr, createSocket } from "./lib.js";
import { Ic, icons, ThemeToggle } from "./ui.jsx";
import { AppShell } from "./shell.jsx";
import { LiveBedDashboard } from "./COOApp.jsx";
import DischargesPage from "./DischargesPage.jsx";
import { WardPage } from "./PREApp.jsx";

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

// ── My Patients page — ward cards → WardPage (same as PRE, locked) ────────────
function MyPatientsPage() {
  const [wards, setWards] = useState(null);
  const [error, setError] = useState("");
  const [openWard, setOpenWard] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try { setWards((await api.consultantMyWards()).wards || []); }
    catch (e) { setError(toastErr(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const liveRef = useRef(load);
  liveRef.current = load;
  useEffect(() => {
    const socket = createSocket();
    socket.on("bed:update", () => liveRef.current());
    socket.on("discharge:update", () => liveRef.current());
    socket.on("connect", () => liveRef.current());
    return () => socket.disconnect();
  }, []);

  if (openWard) {
    return (
      <WardPage
        ward={{ ...openWard, ward: openWard.name }}
        cfg={CONSULTANT_CFG}
        allWards={wards.map(w => ({ id: w.id, ward: w.name }))}
        onBack={() => { setOpenWard(null); load(); }}
      />
    );
  }

  return (
    <div className="slide-up">
      <div className="row between" style={{ marginBottom: 14, gap: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-.01em" }}>My Patients</div>
          <div className="dim" style={{ fontSize: 12 }}>Your wards with active patients</div>
        </div>
        <button className="appbar-btn" onClick={load} title="Refresh"><Ic d={icons.refresh} s={17} /></button>
      </div>

      {error && (
        <div className="card empty" style={{ padding: "24px 20px" }}>
          <Ic d={icons.alert} s={28} />
          <div style={{ marginTop: 8, fontWeight: 600 }}>{error}</div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={load}>Retry</button>
        </div>
      )}

      {!error && wards === null && (
        <div className="empty" style={{ paddingTop: 60 }}>
          <span className="spin"><Ic d={icons.refresh} s={24} /></span>
        </div>
      )}

      {!error && wards !== null && wards.length === 0 && (
        <div className="card empty" style={{ padding: "32px 20px" }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "var(--panel-2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
            <Ic d={icons.bed} s={26} />
          </div>
          <div style={{ marginTop: 14, fontWeight: 700, fontSize: 15 }}>No patients assigned</div>
          <div className="dim" style={{ fontSize: 13, marginTop: 5 }}>Beds with your name will appear here once admitted.</div>
        </div>
      )}

      {!error && wards && wards.length > 0 && (
        <div className="card-grid">
          {wards.map((w, i) => (
            <div key={w.id} className="ward-card slide-up" style={{ animationDelay: i * 0.03 + "s", padding: 16, display: "flex", flexDirection: "column" }}>
              <div className="row between" style={{ marginBottom: 14 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{w.name}</div>
                  <div className="dim" style={{ fontSize: 12 }}>{w.my_beds} patient{w.my_beds !== 1 ? "s" : ""}</div>
                </div>
                <span className="tag o"><Ic d={icons.bed} s={12} /> {w.my_beds}</span>
              </div>
              <button className="btn btn-primary" style={{ marginTop: "auto", padding: "9px 0", fontSize: 13 }}
                onClick={() => setOpenWard(w)}>
                <Ic d={icons.bed} s={13} /> View Beds
              </button>
            </div>
          ))}
        </div>
      )}
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
    return () => socket.disconnect();
  }, []);

  const menu = [
    { key: "dashboard",   icon: icons.home,        label: "Dashboard" },
    { key: "mypatients",  icon: icons.bed,          label: "My Patients" },
    { key: "discharges",  icon: icons.clipboard,   label: "Discharges" },
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
        topExtra={
          <button onClick={() => setLiveKey((k) => k + 1)} className="appbar-btn" title="Refresh">
            <Ic d={icons.refresh} s={17} />
          </button>
        }
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
