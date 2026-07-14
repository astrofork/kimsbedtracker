import React, { useState, useEffect, useRef, useCallback } from "react";
import { api, toastErr, createSocket } from "./lib.js";
import { Ic, icons } from "./ui.jsx";
import { AppShell } from "./shell.jsx";
import { calculateWardTotals } from "./bedUtils.js";
import { WardPage, ProfileThemeRow } from "./PREApp.jsx";
import DischargesPage from "./DischargesPage.jsx";

// Nurse endpoints for the shared ward/bed pages (same UI as PRE, nurse APIs + role).
const NURSE_CFG = {
  role: "NURSE",
  listBeds: (wardId) => api.nurseBeds(wardId),
  updateBedStatus: (...a) => api.nurseUpdateBedStatus(...a),
  payerTypes: () => api.nursePayerTypes(),
  destinations: () => api.nurseDestinations(),
};

// ── Ward summary card ──────────────────────────────────────────────────────────
function WardCard({ ward, index, onManage }) {
  const counts = { vn: ward.vacant ?? 0, vr: ward.reserved ?? 0, on: ward.occupied ?? 0 };
  const total  = ward.total_beds ?? 0;
  const allVacant = counts.vn === total && total > 0;

  // Ward is non-operational — show warning, block manage
  if (ward.operational === false) {
    return (
      <div className="ward-card slide-up" style={{
        animationDelay: index * 0.03 + "s",
        padding: 16, display: "flex", flexDirection: "column",
        opacity: 0.75,
      }}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <div>
            {(ward.block_name || ward.floor_name) && (
              <div className="dim" style={{ fontSize: 11, marginBottom: 2 }}>
                {[ward.block_name, ward.floor_name].filter(Boolean).join(" · ")}
              </div>
            )}
            <div style={{ fontWeight: 700, fontSize: 15 }}>{ward.name}</div>
            <div className="dim" style={{ fontSize: 12 }}>{ward.total_beds ?? 0} beds</div>
          </div>
          <span className="tag" style={{ background: "var(--warn-bg, #fff3cd)", color: "var(--warn, #b45309)" }}>
            <Ic d={icons.alert} s={12} /> Non-op
          </span>
        </div>
        <div style={{
          background: "var(--panel-2)", borderRadius: 10, padding: "14px 16px",
          display: "flex", alignItems: "flex-start", gap: 10,
        }}>
          <Ic d={icons.alert} s={16} style={{ color: "var(--warn, #b45309)", flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--warn, #b45309)" }}>Ward non-operational</div>
            <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>
              This ward has been marked non-operational by the manager. Beds cannot be updated.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // No beds assigned to this nurse for this ward — show warning, block manage
  if (ward.beds_warning) {
    return (
      <div className="ward-card slide-up" style={{
        animationDelay: index * 0.03 + "s",
        padding: 16,
        display: "flex", flexDirection: "column",
      }}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <div>
            {(ward.block_name || ward.floor_name) && (
              <div className="dim" style={{ fontSize: 11, marginBottom: 2 }}>
                {[ward.block_name, ward.floor_name].filter(Boolean).join(" · ")}
              </div>
            )}
            <div style={{ fontWeight: 700, fontSize: 15 }}>{ward.name}</div>
            <div className="dim" style={{ fontSize: 12 }}>{total} beds</div>
          </div>
          <span className="tag" style={{ background: "var(--warn-bg, #fff3cd)", color: "var(--warn, #b45309)" }}>
            <Ic d={icons.alert} s={12} /> No access
          </span>
        </div>
        <div style={{
          background: "var(--panel-2)", borderRadius: 10, padding: "14px 16px",
          display: "flex", alignItems: "flex-start", gap: 10,
        }}>
          <Ic d={icons.alert} s={16} style={{ color: "var(--warn, #b45309)", flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--warn, #b45309)" }}>No beds assigned</div>
            <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>
              Contact your manager to assign beds to your account for this ward.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ward-card slide-up" style={{
      animationDelay: index * 0.03 + "s",
      padding: 16,
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          {(ward.block_name || ward.floor_name) && (
            <div className="dim" style={{ fontSize: 11, marginBottom: 2 }}>
              {[ward.block_name, ward.floor_name].filter(Boolean).join(" · ")}
            </div>
          )}
          <div style={{ fontWeight: 700, fontSize: 15 }}>{ward.name}</div>
          <div className="dim" style={{ fontSize: 12 }}>
            {total} beds
            {allVacant
              ? <span style={{ color: "var(--st-v)" }}> · all vacant</span>
              : <span style={{ color: "var(--primary)" }}> · complete</span>}
          </div>
        </div>
        <span className="tag v"><Ic d={icons.check} s={12} /> ok</span>
      </div>

      {/* Stats block */}
      <div style={{
        display: "flex", background: "var(--panel-2)",
        borderRadius: 10, overflow: "hidden", marginBottom: 14,
      }}>
        {[
          { label: "Vacant",   val: counts.vn, color: "var(--st-v)"  },
          { label: "Vac+Res",  val: counts.vr, color: "var(--st-vr)" },
          { label: "Occupied", val: counts.on, color: "var(--st-o)"  },
        ].map(({ label, val, color }, idx) => (
          <div key={label} style={{
            flex: 1, textAlign: "center", padding: "12px 6px",
            borderLeft: idx > 0 ? "1px solid var(--line)" : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-2)" }}>{label}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="row" style={{ gap: 8, marginTop: "auto" }}>
        <button className="btn btn-primary" style={{ flex: 1, padding: "9px 0", fontSize: 13 }}
          onClick={() => onManage(ward)}>
          <Ic d={icons.bed} s={13} /> Manage Beds
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  NURSE APP
// ══════════════════════════════════════════════════════════════════════════════
export default function NurseApp({ user, onLogout }) {
  const [wards,       setWards]       = useState(null);
  const [loadError,   setLoadError]   = useState(null); // null | string — real network errors only
  const [configError, setConfigError] = useState(null); // null | string — account config issues
  const [openWard, setOpenWard] = useState(null); // { ward, tab } | null — full-page ward view
  const [navTab, setNavTab] = useState("dash"); // "dash" | "beds" | "discharges"
  const [stationFilter, setStationFilter] = useState("all"); // "all" | station id
  const [stationName, setStationName] = useState(user.nursing_station || "");
  const [stations,    setStations]    = useState([]); // [{id, name}] — every station this nurse covers
  const [toast,       setToast]       = useState("");
  const [lastSync,    setLastSync]    = useState(null);
  // Ref so the socket event handler always calls the latest load without recreating the socket
  const loadRef = useRef(null);

  // Derived: always the current ward object from live wards state

  const showToast = useCallback((m) => {
    setToast(m); setTimeout(() => setToast(""), 2200);
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await api.nurseMe();
      setConfigError(null);
      setWards(data.wards || []);
      setStationName(data.nursing_station || "");
      setStations(data.stations || []);
      setLastSync(new Date());
    } catch (e) {
      const msg = e?.message ?? "";
      if (msg === "Unauthorized") return;
      if (msg.includes("No nursing station")) {
        setConfigError(msg);
        setWards([]);
      } else {
        setLoadError(msg || "Unable to connect to server");
      }
    }
  }, []);

  // Always keep loadRef pointing at the current load function
  loadRef.current = load;

  // Initial data fetch
  useEffect(() => { load(); }, [load]);

  // Real-time updates via WebSocket — replaces 15-second polling
  useEffect(() => {
    const socket = createSocket();

    socket.on("bed:update", (payload) => {
      const { bedId, wardId } = payload ?? {};
      // Ward-level edits (rename/delete/operational toggle) only carry wardId,
      // bed-level edits only carry bedId — require at least one, not both.
      if (!bedId && !wardId) return;
      // Reload to get fresh aggregate counts (vacant/reserved/occupied) for the ward cards
      loadRef.current();
      setLastSync(new Date());
    });

    socket.on("discharge:update", () => { loadRef.current(); setLastSync(new Date()); });

    // On reconnect, do a full reload to catch any updates missed while disconnected
    socket.on("connect", () => { loadRef.current(); });

    return () => { socket.disconnect(); };
  }, []); // socket created once per mount; loadRef keeps the callback fresh

  if (wards === null) return (
    <div className="preui">
    <div className="empty" style={{ paddingTop: 120 }}>
      {loadError ? (
        <>
          <div style={{ fontWeight: 600 }}>Unable to connect to server</div>
          <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>Check your network and try again.</div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={load}>
            <Ic d={icons.refresh} s={15} /> Retry
          </button>
        </>
      ) : (
        <>
          <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
          <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>Loading…</div>
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
    </div>
  );

  const totalBeds   = wards.reduce((s, w) => s + (w.total_beds ?? 0), 0); // capacity (not categorized sum)
  const { totalVacant, totalOccupied: totalOcc } = calculateWardTotals(wards);

  return (
    <div className="preui">
    <AppShell
      menu={[
        { key: "dash",       icon: icons.home,      label: "Dashboard" },
        { key: "beds",       icon: icons.bed,       label: "Manage Beds" },
        { key: "discharges", icon: icons.clipboard, label: "Discharges" },
      ]}
      active={navTab}
      onSelect={(k) => { setNavTab(k); setOpenWard(null); }}
      title={{ dash: stations.length === 1 ? (stationName || "Dashboard") : "Dashboard", beds: "Manage Beds", discharges: "Discharges" }[navTab]}
      user={{ name: user.name || user.username || "Nurse", role: "NURSE" }}
      onLogout={onLogout}
      topExtra={
        <button onClick={load} className="appbar-btn" title="Refresh">
          <Ic d={icons.refresh} s={17} />
        </button>
      }
    >
      {navTab === "discharges" ? (
        <DischargesPage role="NURSE" />
      ) : openWard ? (
        <WardPage
          ward={{ ...openWard.ward, ward: openWard.ward.name }}
          initialTab={openWard.tab}
          cfg={NURSE_CFG}
          allWards={[]}
          onBack={() => { setOpenWard(null); load(); }}
        />
      ) : navTab === "beds" ? (<>
      {/* Manage Beds — station picker + ward cards */}
      {stations.length > 1 && (
        <select className="field" aria-label="Filter by station" value={stationFilter}
          onChange={(e) => setStationFilter(e.target.value)}
          style={{ marginBottom: 14, maxWidth: 380, fontWeight: 600 }}>
          <option value="all">All stations ({stations.length})</option>
          {stations.map((st) => <option key={st.id} value={String(st.id)}>{st.name}</option>)}
        </select>
      )}

      {wards.length === 0 ? (
        <div className="card empty" style={{ marginTop: 20 }}>
          <Ic d={icons.grid} s={32} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>
            {configError ? "No nursing station assigned" : "No wards in this station"}
          </div>
          <div style={{ fontSize: 12, marginTop: 4, color: "var(--ink-3)" }}>
            {configError ?? "Ask the Manager to assign wards to your nursing station."}
          </div>
        </div>
      ) : stations.length > 1 ? (
        stations
          .filter((st) => stationFilter === "all" || String(st.id) === stationFilter)
          .map((st) => {
          const list = wards.filter((w) => w.station_id === st.id);
          if (list.length === 0) return null;
          const beds = list.reduce((s, w) => s + (w.total_beds ?? 0), 0);
          return (
            <div key={st.id} style={{ marginBottom: 18 }}>
              <div className="floor-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{st.name}</span>
                <span className="dim" style={{ fontSize: 11, fontWeight: 600 }}>
                  {list.length} ward{list.length !== 1 ? "s" : ""} · {beds} beds
                </span>
              </div>
              <div className="card-grid">
                {list.map((ward, i) => (
                  <WardCard key={ward.id} ward={ward} index={i} onManage={(w) => setOpenWard({ ward: w, tab: "manage" })} />
                ))}
              </div>
            </div>
          );
        })
      ) : (
        <>
          <div className="floor-head">Ward summary</div>
          <div className="card-grid">
            {wards.map((ward, i) => (
              <WardCard key={ward.id} ward={ward} index={i} onManage={(w) => setOpenWard({ ward: w, tab: "manage" })} />
            ))}
          </div>
        </>
      )}
      </>) : (<>
      {/* Dashboard — stats + clickable station directory */}
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="row" style={{ gap: 10 }}>
            <span className="ic"><Ic d={icons.building} s={16} /></span>
            <div className="n" style={{ fontSize: 18 }}>
              {stations.length > 1 ? stations.length : (stationName || "—")}
            </div>
          </div>
          <div className="l">{stations.length > 1 ? "NURSING STATIONS" : "NURSING STATION"}</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 10 }}>
            <span className="ic"><Ic d={icons.grid} s={16} /></span>
            <div className="n" style={{ fontSize: 18 }}>{wards.length}</div>
          </div>
          <div className="l">TOTAL WARDS</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 10 }}>
            <span className="ic" style={{ background: "var(--st-v-bg)", color: "var(--st-v)" }}><Ic d={icons.bed} s={16} /></span>
            <div className="n" style={{ fontSize: 18 }}>{totalBeds}</div>
          </div>
          <div className="l">TOTAL BEDS · {totalVacant} vacant · {totalOcc} occ</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 10 }}>
            <span className="ic" style={{ background: "var(--st-vr-bg)", color: "var(--st-vr)" }}><Ic d={icons.clock} s={16} /></span>
            <div className="n" style={{ fontSize: 18 }}>
              {lastSync ? lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
            </div>
          </div>
          <div className="l">LAST UPDATE</div>
        </div>
      </div>

      {wards.length === 0 ? (
        <div className="card empty" style={{ marginTop: 20 }}>
          <Ic d={icons.grid} s={32} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>
            {configError ? "No nursing station assigned" : "No wards in this station"}
          </div>
          <div style={{ fontSize: 12, marginTop: 4, color: "var(--ink-3)" }}>
            {configError ?? "Ask the Manager to assign wards to your nursing station."}
          </div>
        </div>
      ) : stations.length > 1 ? (
        <>
          <div className="floor-head">Stations — tap to open its wards</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stations.map((st) => {
              const list = wards.filter((w) => w.station_id === st.id);
              const beds = list.reduce((s, w) => s + (w.total_beds ?? 0), 0);
              const t = calculateWardTotals(list);
              return (
                <button key={st.id} className="card" style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                  width: "100%", padding: "13px 16px", cursor: "pointer", textAlign: "left",
                }} onClick={() => { setStationFilter(String(st.id)); setNavTab("beds"); }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{st.name}</div>
                    <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                      {list.length} ward{list.length !== 1 ? "s" : ""} · {beds} beds · {t.totalVacant} vacant · {t.totalOccupied} occupied
                    </div>
                  </div>
                  <Ic d={icons.chevron} s={15} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <button className="btn btn-primary" onClick={() => setNavTab("beds")}>
          <Ic d={icons.bed} s={15} /> Manage Beds
        </button>
      )}
      </>)}

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}
      <ProfileThemeRow />
    </AppShell>
    </div>
  );
}
