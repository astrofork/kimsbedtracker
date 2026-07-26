import React, { useState, useEffect, useRef, useCallback } from "react";
import { api, createSocket } from "./lib.js";
import { Ic, icons, StatusBar } from "./ui.jsx";
import { AppShell } from "./shell.jsx";
import { WardPage, ProfileThemeRow } from "./PREApp.jsx";
import { LiveBedDashboard, OverstayPanel } from "./COOApp.jsx";
import DischargesPage from "./DischargesPage.jsx";

// Nurse endpoints for the shared ward/bed pages (same UI as PRE, nurse APIs + role).
const NURSE_CFG = {
  role: "NURSE",
  listBeds: (wardId) => api.nurseBeds(wardId),
  updateBedStatus: (...a) => api.nurseUpdateBedStatus(...a),
  payerTypes: () => api.nursePayerTypes(),
  destinations: () => api.nurseDestinations(),
  reviewWard: (wardId) => api.nurseReviewWard(wardId),
  bedDetails: () => api.nurseBedDetails(),
};

// ── Occupancy summary bar (mirrors PRE Entry OccupancyCards) ─────────────────
function NurseOccupancy({ wards }) {
  const v  = wards.reduce((s, w) => s + (w.vacant   ?? 0), 0);
  const r  = wards.reduce((s, w) => s + (w.reserved ?? 0), 0);
  const o  = wards.reduce((s, w) => s + (w.occupied ?? 0), 0);
  const or = wards.reduce((s, w) => s + (w.occupied_reserved ?? 0), 0);
  const total = v + r + o + or;
  const occPct = total > 0 ? Math.round((o + or) / total * 100) : 0;
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className="h2">My occupancy</span>
        <span className="chip mono">{occPct}% full</span>
      </div>
      <StatusBar v={v} r={r} o={o} or={or} total={total} />
      <div className="occ-chips">
        <span className="tag v">{v} vacant</span>
        <span className="tag r">{r} vac+res</span>
        <span className="tag o">{o} occupied</span>
        {or > 0 && <span className="tag or">{or} occ+res</span>}
      </div>
    </div>
  );
}

// ── Ward summary card (PRE Entry style) ──────────────────────────────────────
export function WardCard({ ward, index, onOpen }) {
  const v  = ward.vacant   ?? 0;
  const r  = ward.reserved ?? 0;
  const o  = ward.occupied ?? 0;
  const or = ward.occupied_reserved ?? 0;
  const total = ward.total_beds ?? 0;

  const warningBlock = (msg, title) => (
    <div className="ward-card slide-up" style={{ animationDelay: index * 0.03 + "s", padding: 16, opacity: 0.8 }}>
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
          <Ic d={icons.alert} s={12} /> {title}
        </span>
      </div>
      <div style={{ background: "var(--panel-2)", borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Ic d={icons.alert} s={16} style={{ color: "var(--warn, #b45309)", flexShrink: 0, marginTop: 1 }} />
        <div className="dim" style={{ fontSize: 12 }}>{msg}</div>
      </div>
    </div>
  );

  if (ward.operational === false)
    return warningBlock("This ward has been marked non-operational by the manager. Beds cannot be updated.", "Non-op");
  if (ward.beds_warning)
    return warningBlock("Contact your manager to assign beds to your account for this ward.", "No access");

  return (
    <div className="ward-card slide-up" style={{
      animationDelay: index * 0.03 + "s", padding: 16,
      display: "flex", flexDirection: "column",
      borderColor: "var(--st-v)",
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
          <div className="dim" style={{ fontSize: 12 }}>{total} beds</div>
        </div>
        <span className="tag v"><Ic d={icons.check} s={12} /> Complete</span>
      </div>

      {/* 4-column stats block */}
      <div className="ward-stats-4">
        {[
          { label: "Vacant",   val: v,  color: "var(--st-v)"  },
          { label: "Vac+Res",  val: r,  color: "var(--st-vr)" },
          { label: "Occupied", val: o,  color: "var(--st-o)"  },
          { label: "Occ+Res",  val: or, color: "var(--st-or)" },
        ].map(({ label, val, color }) => (
          <div key={label} className="ws-col">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span className="ws-label">{label}</span>
            </div>
            <div className="ws-val" style={{ color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="row ward-card-btns" style={{ gap: 8, marginTop: "auto", flexWrap: "wrap" }}>
        <button className="btn btn-primary" style={{ flex: "1 1 100px", padding: "9px 0", fontSize: 13 }}
          onClick={() => onOpen(ward, "manage")}>
          <Ic d={icons.bed} s={13} /> Manage Beds
        </button>
        <button className="btn btn-ghost" style={{ flex: "1 1 88px", padding: "9px 0", fontSize: 13 }}
          onClick={() => onOpen(ward, "discharge")}>
          <Ic d={icons.clipboard} s={13} /> Discharges
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
  const [navTab, setNavTab] = useState("dash"); // "dash" | "wards" | "discharges"
  const [stationFilter, setStationFilter] = useState("all"); // "all" | station id
  const [wardFilter, setWardFilter] = useState("all"); // "all" | ward id
  const [wardSearch, setWardSearch] = useState("");
  const [ipMatch, setIpMatch] = useState(null); // { wardId } | null — resolved IP lookup
  const [ipNotFound, setIpNotFound] = useState(false);
  // Hospital-wide bed list — same data the Home dashboard already fetches —
  // pulled once, lazily, the first time it's needed, then cached for the rest
  // of this page visit. Every IP search after that is a pure client-side scan.
  const [bedDetails, setBedDetails] = useState(null);
  const bedDetailsLoadingRef = useRef(false);
  const [stationName, setStationName] = useState(user.nursing_station || "");
  const [stations,    setStations]    = useState([]); // [{id, name}] — every station this nurse covers
  const [liveKey,     setLiveKey]     = useState(0); // bumped on every live event — feeds the Home dashboard
  // Home's summary numbers — computed server-side (DB aggregate, excludes
  // non-operational wards + Discharge Lounge) instead of reducing `wards` in
  // the browser. null until first load.
  const [totals, setTotals] = useState(null);
  // Ref so the socket event handler always calls the latest load without recreating the socket
  const loadRef = useRef(null);

  // Derived: always the current ward object from live wards state


  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await api.nurseMe();
      setConfigError(null);
      setWards(data.wards || []);
      setStationName(data.nursing_station || "");
      setStations(data.stations || []);
      setTotals(data.totals || null);
    } catch (e) {
      const msg = e?.message ?? "";
      if (msg === "Unauthorized") return;
      if (msg.includes("No nursing station")) {
        setConfigError(msg);
        setWards([]);
      } else {
        setLoadError("Unable to connect to server");
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
      setLiveKey(k => k + 1);
    });

    socket.on("discharge:update", () => { loadRef.current(); setLiveKey(k => k + 1); });
    socket.on("discharge:overstay", () => { loadRef.current(); setLiveKey(k => k + 1); });

    // On reconnect, do a full reload to catch any updates missed while disconnected
    socket.on("connect", () => { loadRef.current(); setLiveKey(k => k + 1); });

    return () => { socket.disconnect(); };
  }, []); // socket created once per mount; loadRef keeps the callback fresh

  // A 6-digit search value is treated as an IP lookup instead of a ward-name
  // filter — narrows the ward grid to the one matching ward's card (same as
  // ward-name search narrowing), but doesn't navigate in automatically; the
  // user still clicks the card. WardPage's search box is pre-seeded with the
  // IP once opened, so it shows just that one bed.
  useEffect(() => {
    const ip = wardSearch.trim();
    setIpNotFound(false);
    if (!/^\d{6}$/.test(ip)) { setIpMatch(null); return; }
    if (bedDetails === null) {
      if (!bedDetailsLoadingRef.current) {
        bedDetailsLoadingRef.current = true;
        NURSE_CFG.bedDetails().then((r) => setBedDetails(r || [])).catch(() => setIpNotFound(true));
      }
      return; // effect re-runs once bedDetails lands
    }
    const bed = bedDetails.find((b) => b.ip_last6 === ip);
    if (bed) setIpMatch({ wardId: bed.ward_id });
    else { setIpMatch(null); setIpNotFound(true); }
  }, [wardSearch, bedDetails]);

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
    </div>
    </div>
  );

  // Home's headline numbers come straight from the server (data.totals) —
  // already excludes non-operational wards and the Discharge Lounge, matching
  // the Dashboard. Falls back to 0s only for the brief window before the
  // first /nurse/me response lands.
  const totalWards = totals?.wards ?? 0;
  const totalBeds  = totals?.totalBeds ?? 0;

  return (
    <div className="preui">
    <AppShell
      menu={[
        { key: "dash",       icon: icons.home,      label: "Home" },
        { key: "wards",      icon: icons.bed,       label: "Wards" },
        { key: "discharges", icon: icons.clipboard, label: "Discharges" },
        { key: "overstay",   icon: icons.alert,     label: "Overstay" },
      ]}
      active={navTab}
      onSelect={(k) => { setNavTab(k); setOpenWard(null); }}
      title={openWard ? "Bed Entry" : { dash: "Home", wards: "Wards", discharges: "Discharges", overstay: "Overstay Alerts" }[navTab] || "Home"}
      user={{ name: user.name || user.username || "Nurse", role: "NURSE" }}
      onLogout={onLogout}
      topExtra={null}
    >
      {navTab === "discharges" ? (
        <DischargesPage role="NURSE" />
      ) : navTab === "overstay" ? (
        <OverstayPanel loadFn={api.nurseOverstay} />
      ) : openWard ? (
        <WardPage
          ward={{ ...openWard.ward, ward: openWard.ward.name }}
          initialTab={openWard.tab}
          initialSearch={openWard.search}
          cfg={NURSE_CFG}
          allWards={wards.map(w => ({ id: w.id, ward: w.name }))}
          onBack={() => { setOpenWard(null); load(); }}
        />
      ) : navTab === "wards" ? (<>
      {/* Occupancy summary bar */}
      {wards.length > 0 && <NurseOccupancy wards={wards} />}

      {ipNotFound && (
        <div className="dim" style={{ fontSize: 13, padding: "10px 2px", marginBottom: 8 }}>
          No patient found with that IP in your wards.
        </div>
      )}

      {/* Search + ward picker */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex" }}>
            <Ic d={icons.search} s={15} />
          </span>
          <input
            className="field"
            value={wardSearch}
            placeholder="Search ward / IP…"
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
            {wards.map((w) => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
          </select>
        )}
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
        stations
          .filter((st) => stationFilter === "all" || String(st.id) === stationFilter)
          .map((st) => {
            const nq = wardSearch.trim().toLowerCase();
            const isIpSearch = /^\d{6}$/.test(nq);
            const list = wards.filter((w) =>
              w.station_id === st.id && (wardFilter === "all" || String(w.id) === wardFilter) &&
              (isIpSearch ? ipMatch?.wardId === w.id : (!nq || w.name.toLowerCase().includes(nq)))
            );
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
                    <WardCard key={ward.id} ward={ward} index={i}
                      onOpen={(w, tab) => setOpenWard({ ward: w, tab, search: isIpSearch ? nq : undefined })} />
                  ))}
                </div>
              </div>
            );
          })
      ) : (
        <div className="card-grid">
          {wards
            .filter((w) => {
              const nq = wardSearch.trim().toLowerCase();
              const isIpSearch = /^\d{6}$/.test(nq);
              return (wardFilter === "all" || String(w.id) === wardFilter) &&
                (isIpSearch ? ipMatch?.wardId === w.id : (!nq || w.name.toLowerCase().includes(nq)));
            })
            .map((ward, i) => (
              <WardCard key={ward.id} ward={ward} index={i}
                onOpen={(w, tab) => setOpenWard({ ward: w, tab, search: /^\d{6}$/.test(wardSearch.trim()) ? wardSearch.trim() : undefined })} />
            ))}
        </div>
      )}
      </>) : (<>
      {/* Home — 3 summary cards + full hospital dashboard */}
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="row" style={{ gap: 10 }}>
            <span className="ic"><Ic d={icons.grid} s={16} /></span>
            <div className="n" style={{ fontSize: 18 }}>{totalWards}</div>
          </div>
          <div className="l">NURSING WARDS</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 10 }}>
            <span className="ic" style={{ background: "var(--st-v-bg)", color: "var(--st-v)" }}><Ic d={icons.bed} s={16} /></span>
            <div className="n" style={{ fontSize: 18 }}>{totalBeds}</div>
          </div>
          <div className="l">BEDS ALLOCATED</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 10 }}>
            <span className="ic"><Ic d={icons.building} s={16} /></span>
            <div className="n" style={{ fontSize: 18 }}>
              {stations.length > 1 ? stations.length : (stationName || "—")}
            </div>
          </div>
          <div className="l">{stations.length > 1 ? "NURSING STATIONS" : "NURSING STATION"}</div>
        </div>
      </div>
      <LiveBedDashboard refreshKey={liveKey} userName={user.name || user.username || "Nurse"} scope="nurse-full" />
      </>)}

      <ProfileThemeRow />
    </AppShell>
    </div>
  );
}
