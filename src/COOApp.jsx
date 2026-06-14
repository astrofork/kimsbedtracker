import React, { useState, useEffect, useRef, useCallback } from "react";
import { api, fmtTime, toastErr, friendlyError, toMs, createSocket } from "./lib.js";
import {
  Ic, icons, StatusBar, useModal, AppError, useConfirm, BlockAvatar,
  THEMES, T_LABEL, T_COLOR, getTheme, applyTheme,
} from "./ui.jsx";
import { AppShell } from "./shell.jsx";
import { HistoryViewer, actionLabel } from "./ManagerApp.jsx";
import {
  snapshotDownload, snapshotCopy, snapshotShare, snapshotCanShare,
} from "./snapshot.js";
import { naturalSort } from "./bedUtils.js";

const HOSPITAL_NAME = "KIMS Hospitals";

function fmtReminderLabel(hhmm) {
  const [h] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM", hh = h % 12 === 0 ? 12 : h % 12;
  return hh + " " + ap;
}

// Backend role stays COO — the UI presents it as the Admin module.
const ADMIN_TITLES = {
  dashboard:  "Live Bed Dashboard",
  activity:   "PRE & Nurse Activity",
  matrix:     "Hospital Matrix",
  analytics:  "Analytics",
  reports:    "Reports",
  savedviews: "Saved Views",
  alerts:     "Alerts",
  audit:      "Audit Log",
  settings:   "Settings",
};

export default function COOApp({ user, meta, onLogout }) {
  const [tab,       setTab]       = useState("dashboard");
  const [data,      setData]      = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast,     setToast]     = useState("");
  const [dismissed, setDismissed] = useState({});
  const [sheet,     setSheet]     = useState(null);
  const [bedsBlock, setBedsBlock] = useState(null); // { pre, label, wards }
  // date selection: 'live' or a YYYY-MM-DD historical day
  const [dates, setDates] = useState([]);
  const [selDate, setSelDate] = useState("live");
  const [history, setHistory] = useState(null);
  const loadRef    = useRef(null);
  const [liveKey,  setLiveKey]  = useState(0);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [overviewRes, complianceRes] = await Promise.allSettled([
      api.cooOverview(),
      api.cooCompliance(),
    ]);
    if (overviewRes.status === "fulfilled") {
      setData(overviewRes.value);
    } else {
      const e = overviewRes.reason;
      if ((e?.message ?? "") !== "Unauthorized") {
        setLoadError(true);
        showToast(toastErr(e));
      }
    }
    if (complianceRes.status === "fulfilled") setCompliance(complianceRes.value.compliance);
    setLoading(false);
  }, []);

  // Keep loadRef fresh so socket handler always calls the latest load
  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  // Real-time updates via WebSocket — replaces 15-second polling
  useEffect(() => {
    const socket = createSocket();
    const refresh = () => { loadRef.current(); setLiveKey(k => k + 1); };
    socket.on("bed:update",   refresh);
    socket.on("round:submit", refresh);
    socket.on("connect",      refresh); // catch missed updates on reconnect
    return () => { socket.disconnect(); };
  }, []);
  useEffect(() => { api.mgrHistoryDates().then((d) => setDates(d.dates || [])).catch(() => { }); }, []);

  // when a historical date is picked, load that day's rounds
  useEffect(() => {
    if (selDate === "live") { setHistory(null); return; }
    api.mgrHistory(selDate).then((d) => setHistory(d.rounds || [])).catch(() => setHistory([]));
  }, [selDate]);

  if (!data) return (
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
          <div className="dim" style={{ marginTop: 12 }}>Loading…</div>
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );

  const due = data.dueReminder;

  const menu = [
    { key: "dashboard",  icon: icons.home,     label: "Dashboard" },
    { key: "activity",   icon: icons.user,     label: "PRE & Nurse" },
    { key: "matrix",     icon: icons.grid,     label: "Hospital Matrix" },
    { key: "analytics",  icon: icons.chart,    label: "Analytics" },
    { key: "reports",    icon: icons.clock,    label: "Reports" },
    { key: "savedviews", icon: icons.layers,   label: "Saved Views" },
    { key: "alerts",     icon: icons.bell,     label: "Alerts", dot: !!(due && !dismissed[due]) },
    { key: "audit",      icon: icons.list,     label: "Audit Log" },
    { key: "settings",   icon: icons.settings, label: "Settings" },
  ];

  return (
    <AppShell
      menu={menu}
      active={tab}
      onSelect={setTab}
      title={ADMIN_TITLES[tab]}
      user={{ name: user?.name || user?.username || "Admin", role: "ADMIN" }}
      onLogout={onLogout}
      topExtra={
        <span className="pre-pill" style={{ fontSize: 11, flexDirection: "column", gap: 1, lineHeight: 1.2, padding: "5px 9px" }}>
          <span><Ic d={icons.clock} s={11} /> {fmtTime(Date.now())}</span>
          <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{new Date().toLocaleDateString("en-GB")}</span>
        </span>
      }
    >
      {due && !dismissed[due] && tab !== "alerts" && (
        <div className="card slide-up" style={{ padding: 15, marginBottom: 14, borderColor: "var(--blue)", background: "var(--blue-bg)" }}>
          <div className="row between">
            <div className="row"><span style={{ color: "var(--blue)" }}><Ic d={icons.bell} s={20} /></span>
              <div><div style={{ fontWeight: 700, color: "var(--blue)" }}>3-hour review reminder</div>
                <div style={{ fontSize: 12, color: "var(--blue)" }}>Your {fmtReminderLabel(due)} bed-status check</div></div></div>
            <button className="chip" onClick={() => setDismissed((d) => ({ ...d, [due]: 1 }))}>Dismiss</button>
          </div>
        </div>
      )}

      {/* date selector — applies to the round-based views */}
      {(tab === "analytics" || tab === "matrix") && (
        <DatePicker dates={dates} selDate={selDate} setSelDate={setSelDate} />
      )}

      {tab === "dashboard"  && <LiveBedDashboard refreshKey={liveKey} />}
      {tab === "activity"   && <ActivityPage />}
      {tab === "matrix"     && <Matrix data={data} selDate={selDate} history={history} userId={user?.id} />}
      {tab === "analytics"  && <Overview data={data} compliance={compliance} selDate={selDate} history={history} onViewBeds={setBedsBlock} />}
      {tab === "reports"    && <HistoryViewer />}
      {tab === "savedviews" && <SavedViewsPage data={data} userId={user?.id} onOpenInMatrix={() => setTab("matrix")} />}
      {tab === "alerts"     && <AlertsPage data={data} compliance={compliance} due={due} dismissed={dismissed} setDismissed={setDismissed} />}
      {tab === "audit"      && <AuditPage />}
      {tab === "settings"   && <SettingsPage user={user} />}

      {sheet     && <WardSheet    pre={sheet}      onClose={() => setSheet(null)} />}
      {bedsBlock && <BlockBedsSheet pre={bedsBlock.pre} label={bedsBlock.label} wards={bedsBlock.wards} onClose={() => setBedsBlock(null)} />}

      {toast && <div className="toast">{toast}</div>}
    </AppShell>
  );
}

// Date dropdown: "Live" plus any historical day that has data.
function DatePicker({ dates, selDate, setSelDate }) {
  return (
    <div className="row between" style={{ marginBottom: 14, gap: 10 }}>
      <span className="dim" style={{ fontSize: 12, fontWeight: 600 }}>Viewing</span>
      <select className="field" style={{ width: "auto", flex: 1, maxWidth: 220, padding: "9px 12px" }}
        value={selDate} onChange={(e) => setSelDate(e.target.value)}>
        <option value="live">● Live (now)</option>
        {dates.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  LIVE BED DASHBOARD — Admin landing page
//  Fetches ALL operational wards directly via /coo/live-wards — not filtered
//  through pre_block_wards — so nurse-updated wards appear even without a PRE.
// ══════════════════════════════════════════════════════════════════════════════
function LiveBedDashboard({ refreshKey = 0 }) {
  const [liveData,   setLiveData]   = useState(null);
  const [viewBy,     setViewBy]     = useState("TOTAL");
  const [lastSync,   setLastSync]   = useState(new Date());
  const [search,     setSearch]     = useState("");
  const [searchBy,   setSearchBy]   = useState("ward");
  const [groupBy,    setGroupBy]    = useState("none");
  const [snapToast,  setSnapToast]  = useState("");
  const [snapBusy,   setSnapBusy]   = useState(null);
  const snapshotRef = useRef(null);

  const showSnapToast = useCallback((msg) => { setSnapToast(msg); setTimeout(() => setSnapToast(""), 2400); }, []);

  const runSnap = useCallback(async (kind, fn, okMsg) => {
    if (snapBusy) return;
    const el = snapshotRef.current;
    if (!el) return;
    setSnapBusy(kind);
    try { await fn(el); showSnapToast(okMsg); }
    catch (e) {
      const msg = e?.message || "";
      if (msg.includes("not supported")) showSnapToast(msg);
      else if (e?.name !== "AbortError") showSnapToast("Unable to generate snapshot. Try again.");
    } finally { setSnapBusy(null); }
  }, [snapBusy, showSnapToast]);

  const load = useCallback(async () => {
    try {
      const d = await api.cooLiveWards();
      setLiveData(d);
      setLastSync(new Date());
    } catch { /* non-fatal — keep stale data on screen */ }
  }, []);

  // Must be before any early return — hooks cannot be called conditionally
  const searchFilter = useCallback((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    if (searchBy === "room_type") return (r.room_type || "").toLowerCase().includes(q);
    return r.ward.toLowerCase().includes(q);
  }, [search, searchBy]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (!liveData) return (
    <div className="empty" style={{ paddingTop: 80 }}>
      <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
      <div className="dim" style={{ marginTop: 12 }}>Loading…</div>
    </div>
  );

  // All wards from the backend — already deduplicated and includes bed_type
  const allRows = liveData.wards.map(w => ({
    id: w.id, ward: w.ward, total: w.total || 0, unit_type: w.unit_type || null,
    vacant: w.vacant, reserved: w.reserved, occupied: w.occupied,
    occupied_reserved: w.occupied_reserved,
    bed_type: w.bed_type || "Census",
    room_type:  w.room_type  || null,
    block_name: w.block_name || null,
    floor_name: w.floor_name || null,
  }));

  const rows = allRows.filter((r) => {
    if (viewBy === "KIMS")   return r.unit_type === "KIMS";
    if (viewBy === "RENOVA") return (r.unit_type || "").toLowerCase().includes("renova");
    return true;
  });

  const censusRows    = rows.filter((r) => r.bed_type !== "Non-Census");
  const nonCensusRows = rows.filter((r) => r.bed_type === "Non-Census");

  const sum = (list, fn) => list.reduce((a, r) => a + (fn(r) || 0), 0);
  const totalBeds = sum(rows, (r) => r.total);
  const census    = sum(censusRows, (r) => r.total);
  const nonCensus = sum(nonCensusRows, (r) => r.total);
  const vacant    = sum(rows, (r) => r.vacant);
  const vacRes_r  = sum(rows, (r) => r.reserved);
  const occupied  = sum(rows, (r) => r.occupied || 0);
  const occRes    = sum(rows, (r) => r.occupied_reserved || 0);
  const totalOcc  = occupied + occRes;
  const totalVac  = vacant + vacRes_r;
  const allBeds   = liveData.allBeds   || totalBeds;
  const nonOpBeds = liveData.nonOpBeds || 0;
  const pct = (n) => totalBeds > 0 ? Math.round((n / totalBeds) * 100) + "%" : "0%";

  const KPIS = [
    { label: "TOTAL BEDS",      val: allBeds,   sub: `${totalBeds} operational · ${nonOpBeds} non-operational`, color: "var(--ink)"     },
    { label: "CENSUS BEDS",     val: census,    sub: pct(census),      color: "var(--st-v)"    },
    { label: "NON-CENSUS BEDS", val: nonCensus, sub: pct(nonCensus),   color: "var(--st-o)"    },
    { label: "TOTAL OCCUPIED",  val: totalOcc,  sub: pct(totalOcc),    color: "var(--st-o)"    },
    { label: "ON BED",          val: occupied,  sub: pct(occupied),    color: "var(--st-o)"    },
    { label: "OCC + RES",       val: occRes,    sub: pct(occRes),      color: "var(--st-or)"   },
    { label: "TOTAL VACANT",    val: totalVac,  sub: pct(totalVac),    color: "var(--st-v)"    },
    { label: "VACANT",          val: vacant,    sub: pct(vacant),      color: "var(--st-v)"    },
    { label: "VAC + RES",       val: vacRes_r,  sub: pct(vacRes_r),    color: "var(--st-vr)"   },
  ];

  const canShare = snapshotCanShare();

  return (
    <div>
      {/* Header strip: subtitle + LIVE badge */}
      <div className="row between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div className="dim" style={{ fontSize: 13 }}>Real-time overview of beds</div>
        <div className="row" style={{ gap: 8 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 12px", borderRadius: 99, fontSize: 11, fontWeight: 800,
            background: "var(--st-v)", color: "#fff", letterSpacing: ".05em",
          }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: "#fff" }} className="pulse" />
            LIVE
          </span>
          <span className="dim" style={{ fontSize: 11 }}>Auto refresh · every 15 sec</span>
        </div>
      </div>

      {/* View By + info banner */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div className="card row" style={{ padding: "8px 12px", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>View By</span>
          {["TOTAL", "KIMS", "RENOVA"].map((k) => (
            <button key={k} className={"fchip" + (viewBy === k ? " on" : "")}
              style={{ padding: "6px 16px", fontSize: 12 }}
              onClick={() => setViewBy(k)}>{k}</button>
          ))}
        </div>
        <div className="card row" style={{
          padding: "8px 14px", flex: 1, minWidth: 0, gap: 10,
          background: "var(--blue-bg)", borderColor: "var(--blue)",
        }}>
          <span style={{ color: "var(--blue)", flexShrink: 0 }}><Ic d={icons.alert} s={16} /></span>
          <span style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.45 }}>
            Select KIMS, RENOVA or TOTAL to view corresponding bed status.
            Census and Non-Census beds are shown separately.
          </span>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{
        display: "grid", gap: 10, marginBottom: 16,
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
      }}>
        {KPIS.map(({ label, val, sub, color }) => (
          <div key={label} className="card" style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color, letterSpacing: ".04em" }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, letterSpacing: "-.02em" }}>{val}</div>
            <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Search + Group by */}
      <div className="card" style={{ padding: "10px 14px", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {/* Search type toggle */}
          <div className="row" style={{ gap: 0, borderRadius: 7, overflow: "hidden", border: "1px solid var(--line)", flexShrink: 0 }}>
            {[{ value: "ward", label: "Ward" }, { value: "room_type", label: "Room Type" }].map(opt => (
              <button key={opt.value}
                onClick={() => { setSearchBy(opt.value); setSearch(""); }}
                style={{
                  padding: "5px 12px", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                  background: searchBy === opt.value ? "var(--primary)" : "transparent",
                  color: searchBy === opt.value ? "#fff" : "var(--ink-3)",
                  transition: "background .15s, color .15s",
                }}>
                {opt.label}
              </button>
            ))}
          </div>
          {/* Search input */}
          <div style={{ position: "relative", flex: 1, minWidth: 140 }}>
            <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", pointerEvents: "none", display: "flex" }}>
              <Ic d={icons.search} s={13} />
            </span>
            <input
              className="field"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={searchBy === "room_type" ? "Search room type…" : "Search ward name…"}
              style={{ paddingLeft: 28, fontSize: 13, height: 34, width: "100%" }}
            />
          </div>
          {/* Group by */}
          <div className="row" style={{ gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)", whiteSpace: "nowrap" }}>Group by</span>
            <select
              className="field"
              value={groupBy}
              onChange={e => setGroupBy(e.target.value)}
              style={{ fontSize: 12, height: 34, paddingTop: 0, paddingBottom: 0 }}
            >
              {GROUP_BY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Snapshot buttons — above the tables */}
      <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
        <button className="btn btn-primary"
          style={{ padding: "5px 14px", fontSize: 12, gap: 6 }}
          disabled={snapBusy !== null}
          onClick={() => runSnap("download", snapshotDownload, "Snapshot downloaded")}>
          {snapBusy === "download"
            ? <><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={13} /></span> Generating…</>
            : <>📸 Snapshot</>}
        </button>
        <button className="chip"
          style={{ padding: "5px 12px", fontSize: 12 }}
          disabled={snapBusy !== null}
          title="Copy as image"
          onClick={() => runSnap("copy", snapshotCopy, "Snapshot copied to clipboard")}>
          {snapBusy === "copy" ? "…" : "📋 Copy"}
        </button>
        {canShare && (
          <button className="chip"
            style={{ padding: "5px 12px", fontSize: 12 }}
            disabled={snapBusy !== null}
            onClick={() => runSnap("share", snapshotShare, "Shared successfully")}>
            {snapBusy === "share" ? "…" : "📤 Share"}
          </button>
        )}
      </div>

      {/* Ward tables — this is what gets captured */}
      <div ref={snapshotRef}>
        {groupBy === "none" ? (
          <>
            <WardStatusTable title="Census Beds" accent="var(--st-v)" rows={censusRows} totalLabel="TOTAL (CENSUS)" searchFilter={searchFilter} />
            <WardStatusTable title="Non-Census Beds" accent="var(--st-o)" rows={nonCensusRows} totalLabel="TOTAL (NON-CENSUS)" searchFilter={searchFilter} />
          </>
        ) : (
          <UnifiedGroupedTable rows={rows} searchFilter={searchFilter} groupBy={groupBy} />
        )}
      </div>

      <div className="row between" style={{ marginTop: 4, flexWrap: "wrap", gap: 8 }}>
        <span className="dim" style={{ fontSize: 11 }}>
          Note: Occupancy % = (On Bed + Occ+Res) / Total Beds × 100 · "–" = not yet reported this round
        </span>
        <span className="dim" style={{ fontSize: 11 }}>
          Last updated {lastSync.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {snapToast && <div className="toast">{snapToast}</div>}
    </div>
  );
}

const GROUP_BY_OPTIONS = [
  { value: "none",       label: "None"           },
  { value: "room_type",  label: "Room Type"      },
  { value: "unit_type",  label: "Unit Type"      },
  { value: "block_name", label: "Building Block" },
  { value: "floor_name", label: "Floor"          },
];

// Defined outside table components so function references are stable across renders
function OccBar({ p }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <div style={{ flex: 1, height: 7, borderRadius: 6, background: "var(--panel-2)", overflow: "hidden", minWidth: 60 }}>
        <div style={{ width: `${Math.min(100, p)}%`, height: "100%", borderRadius: 6, background: "var(--st-o)" }} />
      </div>
      <span className="mono" style={{ fontSize: 12, fontWeight: 700, minWidth: 44, textAlign: "right" }}>{Math.round(p)}%</span>
    </div>
  );
}

const wstSum = (list, fn) => list.reduce((a, r) => a + (fn(r) || 0), 0);
const wstC   = { textAlign: "center" };

function renderWardRow(r, showBadge) {
  const reported = r.vacant !== null && r.vacant !== undefined;
  const o   = r.occupied          || 0;
  const or_ = r.occupied_reserved || 0;
  const v   = r.vacant            || 0;
  const vr  = r.reserved          || 0;
  const occ = o + or_;
  const vac = v + vr;
  const p   = reported && r.total > 0 ? (occ / r.total) * 100 : 0;
  const d   = (n) => reported ? n : "–";
  const isCensus = r.bed_type !== "Non-Census";
  return (
    <tr key={r.id}>
      <td style={{ fontWeight: 600 }}>
        {r.ward}
        {showBadge && (
          <span style={{
            marginLeft: 7, fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
            padding: "2px 5px", borderRadius: 4, verticalAlign: "middle",
            background: isCensus ? "rgba(34,197,94,.12)" : "rgba(249,115,22,.12)",
            color: isCensus ? "var(--st-v)" : "var(--st-o)",
          }}>
            {isCensus ? "Census" : "Non-Census"}
          </span>
        )}
      </td>
      <td style={wstC}>{r.total}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-o)"  }}>{d(occ)}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-o)"  }}>{d(o)}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-or)" }}>{d(or_)}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-v)"  }}>{d(vac)}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-v)"  }}>{d(v)}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-vr)" }}>{d(vr)}</td>
      <td>{reported ? <OccBar p={p} /> : <span className="dim">–</span>}</td>
    </tr>
  );
}

function renderSubtotalRow(grpRows) {
  const gb   = wstSum(grpRows, r => r.total);
  const go   = wstSum(grpRows, r => r.occupied || 0);
  const gor  = wstSum(grpRows, r => r.occupied_reserved || 0);
  const gv   = wstSum(grpRows, r => r.vacant || 0);
  const gvr  = wstSum(grpRows, r => r.reserved || 0);
  const gocc = go + gor;
  const gvac = gv + gvr;
  const gp   = gb > 0 ? Math.round((gocc / gb) * 100) : 0;
  return (
    <tr key="__sub__" style={{ background: "var(--panel-2)", fontSize: 12 }}>
      <td style={{ fontWeight: 700, color: "var(--ink-2)", paddingLeft: 28 }}>
        Subtotal ({grpRows.length} ward{grpRows.length !== 1 ? "s" : ""})
      </td>
      <td style={{ ...wstC, fontWeight: 700 }}>{gb}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-o)"  }}>{gocc}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-o)"  }}>{go}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-or)" }}>{gor}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-v)"  }}>{gvac}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-v)"  }}>{gv}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-vr)" }}>{gvr}</td>
      <td><OccBar p={gp} /></td>
    </tr>
  );
}

// Flat table — shown when Group by = None
function WardStatusTable({ title, accent, rows, totalLabel, searchFilter }) {
  const filtered = rows.filter(searchFilter);

  const totBeds = wstSum(filtered, r => r.total);
  const totV    = wstSum(filtered, r => r.vacant);
  const totR    = wstSum(filtered, r => r.reserved);
  const totO    = wstSum(filtered, r => r.occupied || 0);
  const totOR   = wstSum(filtered, r => r.occupied_reserved || 0);
  const totOcc  = totO + totOR;
  const totVac  = totV + totR;
  const totPct  = totBeds > 0 ? Math.round((totOcc / totBeds) * 100) : 0;

  return (
    <div className="card" style={{ marginBottom: 16, overflow: "hidden" }}>
      <div className="row between" style={{ padding: "13px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: accent }}>{title}</div>
        <span className="chip" style={{ color: accent }}>Total: {wstSum(rows, r => r.total)} beds</span>
      </div>
      <div className="tbl-wrap" style={{ border: "none", borderRadius: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>WARD</th>
              <th style={wstC}>TOTAL BEDS</th>
              <th style={{ ...wstC, color: "var(--st-o)"  }}>TOTAL OCC</th>
              <th style={{ ...wstC, color: "var(--st-o)"  }}>ON BED</th>
              <th style={{ ...wstC, color: "var(--st-or)" }}>OCC+RES</th>
              <th style={{ ...wstC, color: "var(--st-v)"  }}>TOTAL VAC</th>
              <th style={{ ...wstC, color: "var(--st-v)"  }}>VACANT</th>
              <th style={{ ...wstC, color: "var(--st-vr)" }}>VAC+RES</th>
              <th style={{ minWidth: 160 }}>OCCUPANCY %</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--ink-3)", padding: "22px 14px" }}>
                No wards match the current filter.
              </td></tr>
            ) : (
              <>
                {filtered.map(r => renderWardRow(r, false))}
                <tr style={{ background: "var(--panel-2)" }}>
                  <td style={{ fontWeight: 800, color: accent }}>{totalLabel}</td>
                  <td style={{ ...wstC, fontWeight: 800 }}>{totBeds}</td>
                  <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)"  }}>{totOcc}</td>
                  <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)"  }}>{totO}</td>
                  <td style={{ ...wstC, fontWeight: 800, color: "var(--st-or)" }}>{totOR}</td>
                  <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)"  }}>{totVac}</td>
                  <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)"  }}>{totV}</td>
                  <td style={{ ...wstC, fontWeight: 800, color: "var(--st-vr)" }}>{totR}</td>
                  <td><OccBar p={totPct} /></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Unified grouped table — shown when any Group by is active
function UnifiedGroupedTable({ rows, searchFilter, groupBy }) {
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => { setExpanded(new Set()); }, [groupBy]);

  const toggleSection = (key) =>
    setExpanded(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });

  const filtered = rows.filter(searchFilter);

  const totBeds = wstSum(filtered, r => r.total);
  const totV    = wstSum(filtered, r => r.vacant);
  const totR    = wstSum(filtered, r => r.reserved);
  const totO    = wstSum(filtered, r => r.occupied || 0);
  const totOR   = wstSum(filtered, r => r.occupied_reserved || 0);
  const totOcc  = totO + totOR;
  const totVac  = totV + totR;
  const totPct  = totBeds > 0 ? Math.round((totOcc / totBeds) * 100) : 0;

  const groups = (() => {
    const map = new Map();
    for (const r of filtered) {
      const k = r[groupBy] || "—";
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return [...map.entries()]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([k, grpRows]) => ({ key: k, grpRows }));
  })();

  const groupLabel = GROUP_BY_OPTIONS.find(o => o.value === groupBy)?.label ?? groupBy;

  return (
    <div className="card" style={{ marginBottom: 16, overflow: "hidden" }}>
      <div className="row between" style={{ padding: "13px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          All Wards
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, color: "var(--ink-3)" }}>
            — grouped by {groupLabel}
          </span>
        </div>
        <span className="chip">Total: {wstSum(rows, r => r.total)} beds</span>
      </div>
      <div className="tbl-wrap" style={{ border: "none", borderRadius: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>WARD</th>
              <th style={wstC}>TOTAL BEDS</th>
              <th style={{ ...wstC, color: "var(--st-o)"  }}>TOTAL OCC</th>
              <th style={{ ...wstC, color: "var(--st-o)"  }}>ON BED</th>
              <th style={{ ...wstC, color: "var(--st-or)" }}>OCC+RES</th>
              <th style={{ ...wstC, color: "var(--st-v)"  }}>TOTAL VAC</th>
              <th style={{ ...wstC, color: "var(--st-v)"  }}>VACANT</th>
              <th style={{ ...wstC, color: "var(--st-vr)" }}>VAC+RES</th>
              <th style={{ minWidth: 160 }}>OCCUPANCY %</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--ink-3)", padding: "22px 14px" }}>
                No wards match the current filter.
              </td></tr>
            ) : (
              <>
                {groups.map(({ key, grpRows }) => {
                  const isOpen = expanded.has(key);
                  return (
                    <React.Fragment key={key}>
                      <tr onClick={() => toggleSection(key)}
                        style={{ cursor: "pointer", background: "var(--panel)", userSelect: "none" }}>
                        <td colSpan={9} style={{ fontWeight: 800, fontSize: 12, letterSpacing: ".04em", color: "var(--primary)", padding: "8px 14px" }}>
                          <span style={{ marginRight: 8, display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", fontSize: 10 }}>▶</span>
                          {key}
                          <span style={{ marginLeft: 10, fontWeight: 600, color: "var(--ink-3)", fontSize: 11 }}>
                            {grpRows.length} ward{grpRows.length !== 1 ? "s" : ""} · {wstSum(grpRows, r => r.total)} beds
                          </span>
                        </td>
                      </tr>
                      {isOpen && grpRows.map(r => renderWardRow(r, true))}
                      {isOpen && grpRows.length > 1 && renderSubtotalRow(grpRows)}
                    </React.Fragment>
                  );
                })}
                <tr style={{ background: "var(--panel-2)" }}>
                  <td style={{ fontWeight: 800 }}>GRAND TOTAL</td>
                  <td style={{ ...wstC, fontWeight: 800 }}>{totBeds}</td>
                  <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)"  }}>{totOcc}</td>
                  <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)"  }}>{totO}</td>
                  <td style={{ ...wstC, fontWeight: 800, color: "var(--st-or)" }}>{totOR}</td>
                  <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)"  }}>{totVac}</td>
                  <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)"  }}>{totV}</td>
                  <td style={{ ...wstC, fontWeight: 800, color: "var(--st-vr)" }}>{totR}</td>
                  <td><OccBar p={totPct} /></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  SAVED VIEWS — manage matrix views from a dedicated page
// ══════════════════════════════════════════════════════════════════════════════
function SavedViewsPage({ data, userId, onOpenInMatrix }) {
  const [views,     setViews]     = useState([]);
  const [viewModal, setViewModal] = useState(null); // null | { mode, view? }
  const [toast,     setToast]     = useState("");
  const [confirm, confirmDialog]  = useConfirm();

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  const loadViews = async () => {
    try { setViews((await api.cooViews()).views || []); } catch {}
  };
  useEffect(() => { loadViews(); }, []);

  const wardSet = new Set();
  for (const f of data.floors) for (const p of f.pres)
    if (p.summary.wards > 0) for (const w of p.wards) wardSet.add(w.ward);
  const wardTypes = [...wardSet].sort();

  const openInMatrix = (v) => {
    if (userId != null) localStorage.setItem(`coo_last_view_${userId}`, String(v.id));
    onOpenInMatrix();
  };

  const groups = [
    ["Default", views.filter(v => v.is_system)],
    ["Shared",  views.filter(v => !v.is_system && v.is_shared)],
    ["Mine",    views.filter(v => !v.is_system && !v.is_shared)],
  ];

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="h1" style={{ fontSize: 18 }}>Saved Views</div>
        <button className="btn btn-primary" style={{ padding: "8px 14px", fontSize: 13 }}
          onClick={() => setViewModal({ mode: "new" })}>
          + Add View
        </button>
      </div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        Reusable ward selections for the Hospital Matrix.
      </div>

      {views.length === 0 && (
        <div className="card empty">
          <Ic d={icons.layers} s={28} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>No saved views yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Save a ward selection to reuse it in the matrix.</div>
        </div>
      )}

      {groups.map(([label, list]) => list.length > 0 && (
        <div key={label}>
          <div className="floor-head">{label}</div>
          <div className="card-grid" style={{ marginBottom: 6 }}>
            {list.map((v) => (
              <div key={v.id} className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="row between">
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{v.name}</div>
                  {v.is_shared && !v.is_system && <span className="tag r">shared</span>}
                  {v.is_system && <span className="tag b">default</span>}
                </div>
                <div className="dim" style={{ fontSize: 12, flex: 1 }}>
                  {v.selected_wards.length > 0 ? v.selected_wards.join(" · ") : "All wards"}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" style={{ padding: "7px 12px", fontSize: 12 }}
                    onClick={() => openInMatrix(v)}>
                    Open in Matrix
                  </button>
                  {!v.is_system && (
                    <>
                      <button className="chip" onClick={() => setViewModal({ mode: "edit", view: v })}>Edit</button>
                      <button className="chip" style={{ color: "var(--red)" }}
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Delete view "${v.name}"?`,
                            message: v.is_shared
                              ? "This view is shared with all Admin users. Deleting it removes it for everyone.\n\nThis cannot be undone."
                              : "This cannot be undone.",
                            confirmLabel: "Delete view", danger: true,
                          });
                          if (!ok) return;
                          try {
                            await api.cooDeleteView(v.id);
                            await loadViews();
                            showToast(`View "${v.name}" deleted`);
                          } catch (e) { showToast(toastErr(e)); }
                        }}>Delete</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {viewModal && (
        <SaveViewModal
          mode={viewModal.mode}
          existingView={viewModal.view}
          currentWards={[]}
          wardTypes={wardTypes}
          onClose={() => setViewModal(null)}
          onSaved={async () => {
            setViewModal(null);
            await loadViews();
            showToast(viewModal.mode === "new" ? "View saved ✓" : "View updated ✓");
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
      {confirmDialog}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRE & NURSE ACTIVITY PAGE
// ══════════════════════════════════════════════════════════════════════════════
function ActivityPage() {
  const [subTab,     setSubTab]     = useState("pre");
  const [preData,    setPreData]    = useState(null);
  const [nurseData,  setNurseData]  = useState(null);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([api.cooPreActivity(), api.cooNurseActivity()]).then(([p, n]) => {
      if (p.status === "fulfilled") setPreData(p.value);
      if (n.status === "fulfilled") setNurseData(n.value);
      setLoading(false);
    });
  }, []);

  if (loading) return (
    <div className="empty" style={{ paddingTop: 80 }}>
      <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
      <div className="dim" style={{ marginTop: 12 }}>Loading…</div>
    </div>
  );

  const tabs = [{ key: "pre", label: "PRE Activity" }, { key: "nurse", label: "Nurse Activity" }];

  return (
    <div>
      {/* Sub-tab toggle */}
      <div className="row" style={{ gap: 8, marginBottom: 18 }}>
        {tabs.map(t => (
          <button key={t.key}
            className={"fchip" + (subTab === t.key ? " on" : "")}
            style={{ padding: "8px 18px", fontSize: 13 }}
            onClick={() => setSubTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {subTab === "pre"   && <PreActivityTab   data={preData} />}
      {subTab === "nurse" && <NurseActivityTab data={nurseData} />}
    </div>
  );
}

function PreActivityTab({ data }) {
  const [expanded, setExpanded] = useState({});
  if (!data) return <div className="card empty">No PRE data available.</div>;
  const blocks = data.blocks || [];
  if (blocks.length === 0) return (
    <div className="card empty"><Ic d={icons.list} s={28} /><div style={{ marginTop: 10 }}>No PRE blocks configured.</div></div>
  );

  return (
    <div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 14 }}>
        {blocks.length} PRE block{blocks.length !== 1 ? "s" : ""} · rounds and ward counts for today
      </div>
      {blocks.map((b) => {
        const isOpen  = !!expanded[b.id];
        const score   = b.compliance.score;
        const scoreColor = score >= 80 ? "var(--green)" : score >= 50 ? "var(--amber)" : "var(--red)";
        const noUser  = !b.assignedUser;
        const totalW  = b.wards.length;
        const doneW   = b.wards.filter(w => w.vacant !== null).length;

        return (
          <div key={b.id} className="card" style={{ padding: 14, marginBottom: 10 }}>
            {/* Header */}
            <div className="row between" style={{ marginBottom: 12 }}>
              <div className="row" style={{ gap: 10 }}>
                <BlockAvatar code={b.name} size={38} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{b.name}</div>
                  <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                    {noUser
                      ? <span style={{ color: "var(--amber)" }}>⚠ No PRE assigned</span>
                      : <>{b.assignedUser.name} · {b.assignedUser.shift} shift</>}
                    {" · "}{totalW} ward{totalW !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                {b.status !== "active"
                  ? <span className="tag b">{b.status}</span>
                  : <span className="tag" style={{ background: score >= 80 ? "var(--st-v-bg)" : score >= 50 ? "#FEF3C7" : "var(--st-or-bg)", color: scoreColor, border: `1px solid ${scoreColor}` }}>
                      {score}% on-time
                    </span>}
              </div>
            </div>

            {/* Round summary row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "var(--panel-2)", borderRadius: 10, overflow: "hidden", marginBottom: 10 }}>
              {[
                { label: "ROUNDS TODAY",  val: b.roundsToday },
                { label: "EXPECTED",      val: b.compliance.expected },
                { label: "WARDS ENTERED", val: `${doneW}/${totalW}` },
              ].map(({ label, val }, i) => (
                <div key={label} style={{ textAlign: "center", padding: "9px 4px", borderLeft: i > 0 ? "1px solid var(--line)" : "none" }}>
                  <div style={{ fontSize: 9, color: "var(--ink-3)", fontWeight: 600, marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{val}</div>
                </div>
              ))}
            </div>

            {b.lastSubmittedAt && (
              <div className="dim" style={{ fontSize: 11, marginBottom: 8 }}>
                Last round submitted {fmtTime(b.lastSubmittedAt)}
              </div>
            )}

            {/* Ward breakdown toggle */}
            {b.wards.length > 0 && (
              <>
                <button style={{
                  width: "100%", padding: "7px 0", borderRadius: 8,
                  background: "var(--panel-2)", border: "none", cursor: "pointer",
                  fontSize: 12, color: "var(--ink-2)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }} onClick={() => setExpanded(p => ({ ...p, [b.id]: !p[b.id] }))}>
                  {isOpen ? "▲ Hide" : "▼ Show"} ward breakdown ({b.wards.length})
                </button>
                {isOpen && <WardTableActivity wards={b.wards} />}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NurseActivityTab({ data }) {
  const [expanded, setExpanded] = useState({});
  if (!data) return <div className="card empty">No nurse data available.</div>;
  const { stations = [], unassignedNurses = [], unassignedWards = [] } = data;

  const StationCard = ({ id, name, nurses, wards }) => {
    const isOpen = !!expanded[id ?? name];
    return (
      <div className="card" style={{ padding: 14, marginBottom: 10 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{name}</div>
            <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
              {nurses.length} nurse{nurses.length !== 1 ? "s" : ""} · {wards.length} ward{wards.length !== 1 ? "s" : ""}
            </div>
          </div>
          {nurses.length === 0 && <span className="tag o">No nurses</span>}
        </div>

        {/* Nurse roster */}
        {nurses.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {nurses.map(n => (
              <span key={n.id} className="chip" style={{ fontSize: 11 }}>
                <Ic d={icons.user} s={11} /> {n.name} <span className="dim">@{n.username}</span>
              </span>
            ))}
          </div>
        )}

        {/* Ward toggle */}
        {wards.length > 0 && (
          <>
            <button style={{
              width: "100%", padding: "7px 0", borderRadius: 8,
              background: "var(--panel-2)", border: "none", cursor: "pointer",
              fontSize: 12, color: "var(--ink-2)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }} onClick={() => setExpanded(p => ({ ...p, [id ?? name]: !p[id ?? name] }))}>
              {isOpen ? "▲ Hide" : "▼ Show"} ward breakdown ({wards.length})
            </button>
            {isOpen && <WardTableActivity wards={wards} showUpdatedBy />}
          </>
        )}
        {wards.length === 0 && <div className="dim" style={{ fontSize: 12 }}>No wards assigned to this station.</div>}
      </div>
    );
  };

  return (
    <div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 14 }}>
        {stations.length} nursing station{stations.length !== 1 ? "s" : ""}
        {unassignedNurses.length > 0 && ` · ${unassignedNurses.length} unassigned nurse${unassignedNurses.length !== 1 ? "s" : ""}`}
        {unassignedWards.length > 0  && ` · ${unassignedWards.length} ward${unassignedWards.length !== 1 ? "s" : ""} without station`}
      </div>

      {stations.map(s => <StationCard key={s.id} {...s} />)}

      {/* Unassigned nurses */}
      {unassignedNurses.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 10, borderColor: "var(--amber)" }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--amber)", marginBottom: 8 }}>
            ⚠ Nurses without a station ({unassignedNurses.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {unassignedNurses.map(n => (
              <span key={n.id} className="chip" style={{ fontSize: 11 }}>
                <Ic d={icons.user} s={11} /> {n.name} <span className="dim">@{n.username}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Unassigned wards */}
      {unassignedWards.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 10, borderColor: "var(--amber)" }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--amber)", marginBottom: 8 }}>
            ⚠ Wards without a nursing station ({unassignedWards.length})
          </div>
          <WardTableActivity wards={unassignedWards} showUpdatedBy />
        </div>
      )}

      {stations.length === 0 && unassignedNurses.length === 0 && (
        <div className="card empty"><Ic d={icons.user} s={28} /><div style={{ marginTop: 10 }}>No nursing stations configured.</div></div>
      )}
    </div>
  );
}

// Shared ward table for activity page — extends WardTable with Last Updated column
function WardTableActivity({ wards, showUpdatedBy = false }) {
  const hdr  = { fontSize: 9, fontWeight: 700, padding: "5px 8px", textAlign: "center", letterSpacing: 0.3 };
  const cell = { padding: "6px 8px", textAlign: "center", fontSize: 12 };
  const div  = "1px solid var(--line)";

  return (
    <div className="tbl-scroll" style={{ marginTop: 8, borderRadius: 8, border: div }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
        <thead>
          <tr>
            <th style={{ ...hdr, textAlign: "left", background: "var(--panel-2)", borderRight: div }}>WARD</th>
            <th style={{ ...hdr, background: "var(--panel-2)", borderRight: div }}>TOTAL</th>
            <th style={{ ...hdr, color: "var(--st-o)",  background: "var(--st-o-bg)",  borderRight: div }}>TOTAL OCC</th>
            <th style={{ ...hdr, color: "var(--st-o)",  background: "var(--st-o-bg)"                   }}>ON BED</th>
            <th style={{ ...hdr, color: "var(--st-or)", background: "var(--st-or-bg)", borderRight: div }}>OCC+RES</th>
            <th style={{ ...hdr, color: "var(--st-v)",  background: "var(--st-v-bg)",  borderRight: div }}>TOTAL VAC</th>
            <th style={{ ...hdr, color: "var(--st-v)",  background: "var(--st-v-bg)"                   }}>VACANT</th>
            <th style={{ ...hdr, color: "var(--st-vr)", background: "var(--st-vr-bg)", borderRight: div }}>VAC+RES</th>
            <th style={{ ...hdr, background: "var(--panel-2)", borderRight: showUpdatedBy ? div : "none" }}>LAST UPDATE</th>
            {showUpdatedBy && <th style={{ ...hdr, background: "var(--panel-2)" }}>UPDATED BY</th>}
          </tr>
        </thead>
        <tbody>
          {wards.map((w, j) => {
            const reported = w.vacant !== null && w.vacant !== undefined;
            const o   = w.occupied          || 0;
            const or_ = w.occupied_reserved || 0;
            const v   = w.vacant            || 0;
            const r   = w.reserved          || 0;
            const d   = (n) => reported ? n : <span className="dim">–</span>;
            return (
              <tr key={j} style={{ background: j % 2 ? "var(--panel-2)" : "transparent" }}>
                <td style={{ ...cell, textAlign: "left", fontWeight: 600, borderRight: div, whiteSpace: "nowrap" }}>{w.ward}</td>
                <td style={{ ...cell, fontWeight: 700, borderRight: div }}>{w.total || 0}</td>
                <td style={{ ...cell, color: "var(--st-o)",  fontWeight: 700, borderRight: div }}>{d(o + or_)}</td>
                <td style={{ ...cell, color: "var(--st-o)"  }}>{d(o)}</td>
                <td style={{ ...cell, color: "var(--st-or)", borderRight: div }}>{d(or_)}</td>
                <td style={{ ...cell, color: "var(--st-v)",  fontWeight: 700, borderRight: div }}>{d(v + r)}</td>
                <td style={{ ...cell, color: "var(--st-v)"  }}>{d(v)}</td>
                <td style={{ ...cell, color: "var(--st-vr)", borderRight: div }}>{d(r)}</td>
                <td style={{ ...cell, borderRight: showUpdatedBy ? div : "none", whiteSpace: "nowrap" }}>
                  {w.updatedAt ? <span style={{ color: "var(--ink-2)" }}>{fmtTime(w.updatedAt)}</span> : <span className="dim">–</span>}
                </td>
                {showUpdatedBy && (
                  <td style={{ ...cell, whiteSpace: "nowrap", color: "var(--ink-2)" }}>
                    {w.updatedBy || <span className="dim">–</span>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  ALERTS — review reminders, stale wards, lagging rounds
// ══════════════════════════════════════════════════════════════════════════════
const STALE_MS = 3 * 60 * 60 * 1000;

function AlertsPage({ data, compliance, due, dismissed, setDismissed }) {
  const now = Date.now();
  const stale = [];
  for (const f of data.floors) for (const p of f.pres)
    for (const w of p.wards || []) {
      const ts = toMs(w.updatedAt);
      if (w.vacant !== null && ts && now - ts > STALE_MS)
        stale.push({ pre: p.pre, ward: w.ward, updatedAt: ts });
    }
  stale.sort((a, b) => a.updatedAt - b.updatedAt);

  const lagging = (compliance || []).filter((c) => c.expected > 0 && c.hasPre !== false && c.score < 100);
  const showDue = due && !dismissed[due];
  const empty = !showDue && stale.length === 0 && lagging.length === 0;

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>Alerts</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        Review reminders, outdated wards and lagging rounds.
      </div>

      {empty && (
        <div className="card empty">
          <span style={{ color: "var(--st-v)" }}><Ic d={icons.check} s={30} /></span>
          <div style={{ marginTop: 10, fontWeight: 600 }}>All clear</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>No active alerts right now.</div>
        </div>
      )}

      {showDue && (
        <div className="card" style={{ padding: 15, marginBottom: 14, borderColor: "var(--blue)", background: "var(--blue-bg)" }}>
          <div className="row between">
            <div className="row"><span style={{ color: "var(--blue)" }}><Ic d={icons.bell} s={20} /></span>
              <div><div style={{ fontWeight: 700, color: "var(--blue)" }}>3-hour review reminder</div>
                <div style={{ fontSize: 12, color: "var(--blue)" }}>Your {fmtReminderLabel(due)} bed-status check</div></div></div>
            <button className="chip" onClick={() => setDismissed((d) => ({ ...d, [due]: 1 }))}>Dismiss</button>
          </div>
        </div>
      )}

      {stale.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 14, borderColor: "var(--red)" }}>
          <div style={{ padding: "12px 14px", background: "var(--red-bg)" }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ color: "var(--red)" }}><Ic d={icons.bell} s={17} /></span>
              <span style={{ fontWeight: 700, fontSize: 14, color: "var(--red)" }}>
                {stale.length} ward{stale.length > 1 ? "s" : ""} not updated in over 3 hours
              </span>
            </div>
          </div>
          <div style={{ padding: "0 14px" }}>
            {stale.map((s, i) => (
              <div key={i} className="row between" style={{
                padding: "10px 0",
                borderBottom: i < stale.length - 1 ? "1px solid var(--line)" : "none",
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {s.pre} · <span style={{ color: "var(--ink-2)" }}>{s.ward}</span>
                  </div>
                  <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>Last updated {fmtTime(s.updatedAt)}</div>
                </div>
                <span className="tag or">stale</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {lagging.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", background: "var(--amber-bg)" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--amber)" }}>
              {lagging.length} block{lagging.length > 1 ? "s" : ""} behind on rounds today
            </span>
          </div>
          <div style={{ padding: "0 14px" }}>
            {lagging.map((c, i) => (
              <div key={i} className="row between" style={{
                padding: "10px 0",
                borderBottom: i < lagging.length - 1 ? "1px solid var(--line)" : "none",
              }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.floor || c.block}</div>
                <span className="mono" style={{
                  fontSize: 12, fontWeight: 700,
                  color: c.score >= 50 ? "var(--amber)" : "var(--red)",
                }}>{c.submitted}/{c.expected} rounds · {Math.round(c.score)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  AUDIT LOG — organization-wide activity (existing /coo/audit API)
// ══════════════════════════════════════════════════════════════════════════════
function AuditPage() {
  const [logs, setLogs] = useState(null);

  useEffect(() => {
    const load = () => api.cooAudit()
      .then((d) => setLogs(d.logs || []))
      .catch(() => setLogs((prev) => prev ?? [])); // preserve existing data; only fall back to [] on initial failure
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  if (logs === null) return (
    <div className="empty"><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={24} /></span></div>
  );

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>Audit Log</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        Most recent activity across all users and roles.
      </div>

      {logs.length === 0 ? (
        <div className="card empty">
          <Ic d={icons.list} s={28} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>No activity yet</div>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Time</th><th>Action</th><th>Entity</th><th>User</th></tr>
            </thead>
            <tbody>
              {logs.map((a, i) => {
                const ms = toMs(a.ts);
                const d  = ms ? new Date(ms) : null;
                return (
                  <tr key={i}>
                    <td className="mono" style={{ whiteSpace: "nowrap", color: "var(--ink-2)" }}>
                      {d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) + " " + fmtTime(ms) : "—"}
                    </td>
                    <td style={{ fontWeight: 600 }}>{actionLabel(a.action)}</td>
                    <td className="dim">{a.entity || "—"}</td>
                    <td className="dim">{a.username || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  SETTINGS — account info + appearance
// ══════════════════════════════════════════════════════════════════════════════
function SettingsPage({ user }) {
  const [theme, setTheme] = useState(getTheme);

  const pick = (t) => { applyTheme(t); setTheme(t); };
  const initial = (user?.name || user?.username || "A").trim().charAt(0).toUpperCase();

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="h1" style={{ fontSize: 18, marginBottom: 14 }}>Settings</div>

      <div className="floor-head">Account</div>
      <div className="card row" style={{ padding: 16, gap: 14 }}>
        <div className="avatar" style={{
          width: 44, height: 44, borderRadius: 99, background: "var(--primary)", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 17,
        }}>{initial}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{user?.name || user?.username}</div>
          <div className="dim" style={{ fontSize: 12 }}>@{user?.username}</div>
        </div>
        <span className="role-badge" style={{ fontSize: 11, padding: "3px 10px" }}>ADMIN</span>
      </div>

      <div className="floor-head">Appearance</div>
      <div className="card" style={{ padding: 16 }}>
        <div className="dim" style={{ fontSize: 12, marginBottom: 12 }}>Choose a theme for this device.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 }}>
          {THEMES.map((t) => (
            <button key={t} onClick={() => pick(t)} style={{
              padding: "12px 8px", borderRadius: 10, fontWeight: 700, fontSize: 13,
              border: `2px solid ${theme === t ? T_COLOR[t] : "var(--line)"}`,
              background: theme === t ? T_COLOR[t] + "14" : "var(--panel)",
              color: theme === t ? T_COLOR[t] : "var(--ink-2)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
              cursor: "pointer", transition: "all .15s",
            }}>
              <span style={{ width: 18, height: 18, borderRadius: 99, background: T_COLOR[t] }} />
              {T_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="floor-head">Data</div>
      <div className="card" style={{ padding: 16 }}>
        <div className="row between">
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Live refresh</div>
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>Dashboards refresh automatically every 15 seconds.</div>
          </div>
          <span className="tag v">Active</span>
        </div>
      </div>
    </div>
  );
}

// COO Overview — clean executive summary. Honors the date selector: when a past
// date is chosen, totals are computed from that day's submitted rounds.
function Overview({ data, compliance, selDate, history, onViewBeds }) {
  const isLive = selDate === "live";

  // compute totals from history snapshot when viewing a past day —
  // only the LAST round of each PRE Block counts, otherwise beds are
  // summed once per round submitted that day
  let t = data.totals;
  if (!isLive && history) {
    const lastByBlock = {};
    for (const round of history) lastByBlock[round.floorName || round.preBlockId] = round;
    let v = 0, o = 0, r = 0, or_ = 0, total = 0;
    for (const round of Object.values(lastByBlock)) for (const w of round.wards || []) {
      v += w.vacant || 0; o += w.occupied || 0; or_ += w.occupied_reserved || 0; r += w.reserved || 0;
      total += w.total || 0;
    }
    t = { v, o, r, or: or_, total, presReporting: Object.keys(lastByBlock).length, presTotal: data.totals.presTotal };
  }

  const live = t.v + t.o + (t.or || 0) + t.r;
  const occRate = live > 0 ? Math.round((t.o + (t.or || 0)) / live * 100) : 0;
  const reporting = t.presTotal > 0 ? Math.round((t.presReporting / t.presTotal) * 100) : 0;

  const scored = (compliance || []).filter((c) => c.expected > 0 && c.hasPre !== false);
  const avg = scored.length ? Math.round(scored.reduce((a, c) => a + c.score, 0) / scored.length) : 100;

  return (
    <div>
      {!isLive && (
        <div className="card" style={{ padding: 12, marginBottom: 14, background: "var(--blue-bg)", borderColor: "var(--blue)" }}>
          <div className="row" style={{ gap: 8 }}>
            <Ic d={icons.clock} s={16} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--blue)" }}>Showing {selDate} — final submitted data</span>
          </div>
        </div>
      )}

      <div className="floor-head">{isLive ? "Live occupancy · all floors" : "Occupancy · " + selDate}</div>
      <div className="stat-grid">
        <div className="stat"><div className="n" style={{ color: "var(--st-v)"  }}>{t.v}</div><div className="l">VACANT</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--st-vr)" }}>{t.r}</div><div className="l">VACANT + RESERVED</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--st-o)"  }}>{t.o}</div><div className="l">OCCUPIED</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--st-or)" }}>{t.or || 0}</div><div className="l">OCC + RES</div></div>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 14 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="h2">Occupancy rate</span><span className="chip mono">{occRate}%</span>
        </div>
        <StatusBar v={t.v} r={t.r} o={t.o} or={t.or || 0} total={t.total} />
        <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>{live} of {t.total} beds {isLive ? "reported live" : "recorded"}</div>
      </div>

      {/* executive KPI row */}
      <div className="stat-grid" style={{ marginTop: 14 }}>
        <div className="stat">
          <div className="n" style={{ color: "var(--primary)", fontSize: 22 }}>{reporting}%</div>
          <div className="l">REPORTING</div>
        </div>
        <div className="stat">
          <div className="n" style={{ color: avg >= 80 ? "var(--green)" : avg >= 50 ? "var(--amber)" : "var(--red)", fontSize: 22 }}>{avg}%</div>
          <div className="l">ON-TIME</div>
        </div>
        <div className="stat">
          <div className="n" style={{ color: "var(--ink)", fontSize: 22 }}>{t.presReporting}/{t.presTotal}</div>
          <div className="l">PRES IN</div>
        </div>
      </div>

      {isLive && (
        <>
          <div className="floor-head" style={{ marginTop: 14 }}>Block beds</div>
          {data.floors.map((f) => {
            const p = f.pres[0];
            if (!p || p.summary.total === 0) return null;
            const s = p.summary;

            // Last updated = most recent updatedAt across wards
            const wardTs = (p.wards || []).map(w => w.updatedAt).filter(Boolean);
            const lastTs = wardTs.length ? Math.max(...wardTs) : null;
            const lastUpdated = lastTs ? (() => {
              const d = new Date(lastTs);
              const now = new Date();
              const isToday = d.toDateString() === now.toDateString();
              return isToday
                ? `Today ${fmtTime(lastTs)}`
                : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + fmtTime(lastTs);
            })() : null;

            const hasData = s.v + s.o + (s.or || 0) + s.r > 0;

            return (
              <div key={f.name} className="card" style={{ padding: 14, marginBottom: 10 }}>
                {/* Card header */}
                <div className="row between" style={{ marginBottom: 12 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <BlockAvatar code={p.pre} size={38} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.label || `Block ${p.pre}`}</div>
                      <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                        {s.total} beds · {s.wards} ward{s.wards !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                  <button
                    className="chip"
                    style={{ fontSize: 11, color: "var(--teal)" }}
                    onClick={() => onViewBeds({ pre: p.pre, label: p.label, wards: p.wards })}
                  >
                    <Ic d={icons.grid} s={12} /> View beds
                  </button>
                </div>

                {/* Occupancy bar */}
                {hasData
                  ? <StatusBar v={s.v} r={s.r} o={s.o} or={s.or || 0} total={s.total} />
                  : <div className="bar"><span style={{ flex: 1, background: "var(--line)" }} /></div>
                }

                {/* 4-stat mini grid */}
                <div className="mini-grid mini-grid-4" style={{ gap: 1, marginTop: 12 }}>
                  {[
                    { label: "Vacant",   val: s.v,          color: "var(--st-v)"  },
                    { label: "V+R",      val: s.r,          color: "var(--st-vr)" },
                    { label: "Occupied", val: s.o,          color: "var(--st-o)"  },
                    { label: "Occ+Res",  val: s.or || 0,    color: "var(--st-or)" },
                  ].map(({ label, val, color }, i) => (
                    <div key={label} style={{
                      textAlign: "center", padding: "9px 4px",
                      borderLeft: i > 0 ? "1px solid var(--line)" : "none",
                    }}>
                      <div style={{ fontSize: 9, color: "var(--ink-3)", fontWeight: 600, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Last updated */}
                {lastUpdated && (
                  <div className="dim" style={{ fontSize: 10, marginTop: 6, textAlign: "right" }}>
                    Last updated {lastUpdated}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function Matrix({ data, selDate, history, userId }) {
  const isLive = selDate === "live";

  // ── Live ward data — fetches ALL wards (bypasses pre_block_wards filter) ─
  const [liveWards, setLiveWards] = useState(null);
  useEffect(() => {
    if (!isLive) { setLiveWards(null); return; }
    api.cooLiveWards().then(setLiveWards).catch(() => {});
  }, [isLive, data]); // re-fetches whenever parent socket update refreshes data

  // ── Ward filter — existing logic unchanged ────────────────────────────────
  const [selectedWards, setSelectedWards] = useState(() => {
    try { return JSON.parse(localStorage.getItem("coo_matrix_order") || "[]"); }
    catch { return []; }
  });
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("coo_matrix_order", JSON.stringify(selectedWards));
  }, [selectedWards]);

  const toggleWard = (ward) => setSelectedWards((prev) =>
    prev.includes(ward) ? prev.filter((w) => w !== ward) : [...prev, ward]
  );
  const showAllWards = () => setSelectedWards([]);

  // ── Saved Views state ─────────────────────────────────────────────────────
  const [views,        setViews]        = useState([]);
  const [activeViewId, setActiveViewId] = useState(() => {
    const stored = localStorage.getItem(`coo_last_view_${userId}`);
    return stored ? Number(stored) : null;
  });
  const [viewModal,    setViewModal]    = useState(null); // null | { mode:"new"|"edit", view?:obj }
  const [viewToast,    setViewToast]    = useState("");
  const [confirm, confirmDialog]        = useConfirm();

  const showVToast = (m) => { setViewToast(m); setTimeout(() => setViewToast(""), 2200); };

  const loadViews = async () => {
    try { setViews((await api.cooViews()).views || []); }
    catch { /* non-fatal */ }
  };
  useEffect(() => { loadViews(); }, []);

  // When activeViewId changes, apply the view's ward selection
  useEffect(() => {
    if (activeViewId == null) return;
    const v = views.find(x => x.id === activeViewId);
    if (v) setSelectedWards(v.selected_wards || []);
  }, [activeViewId, views]);

  // Persist last-used view
  useEffect(() => {
    if (userId == null) return;
    if (activeViewId != null)
      localStorage.setItem(`coo_last_view_${userId}`, String(activeViewId));
    else
      localStorage.removeItem(`coo_last_view_${userId}`);
  }, [activeViewId, userId]);

  // When user manually toggles a ward, detach from active view
  const handleToggleWard = (ward) => {
    setActiveViewId(null);
    toggleWard(ward);
  };
  const handleShowAllWards = () => {
    setActiveViewId(null);
    showAllWards();
  };

  const activeView = activeViewId != null ? views.find(v => v.id === activeViewId) : null;

  // Group views for the dropdown
  const systemViews = views.filter(v => v.is_system);
  const sharedViews = views.filter(v => !v.is_system && v.is_shared);
  const myViews     = views.filter(v => !v.is_system && !v.is_shared);

  // ── Data build ────────────────────────────────────────────────────────────
  // History rounds are keyed by PRE Block; later rounds overwrite earlier
  // ones so each ward reflects the block's final submission of the day.
  const histMap = {};
  if (!isLive && history) {
    for (const round of history) {
      const key = round.floorName || round.preBlockId;
      histMap[key] = histMap[key] || {};
      for (const w of round.wards || []) histMap[key][w.ward] = w;
    }
  }

  // Ward list: live → all operational wards from allWardsLive();
  //            history → PRE-submitted wards (only source available)
  const wardSet = new Set();
  if (isLive && liveWards) {
    for (const w of liveWards.wards) wardSet.add(w.ward);
  } else {
    for (const f of data.floors) for (const p of f.pres) {
      if (p.summary.wards > 0) for (const w of p.wards) wardSet.add(w.ward);
    }
  }
  const wardTypes = [...wardSet].sort();

  const allRows = wardTypes.map((ward) => {
    let v = 0, r = 0, o = 0, or_ = 0, hasData = false;
    if (isLive && liveWards) {
      const w = liveWards.wards.find(x => x.ward === ward);
      if (w && w.vacant !== null) {
        v = w.vacant || 0; r = w.reserved || 0;
        o = w.occupied || 0; or_ = w.occupied_reserved || 0;
        hasData = true;
      }
    } else if (!isLive) {
      for (const wardsByName of Object.values(histMap)) {
        const h = wardsByName[ward];
        if (h) {
          v   += h.vacant            || 0;
          r   += h.reserved          || 0;
          o   += h.occupied          || 0;
          or_ += h.occupied_reserved || 0;
          hasData = true;
        }
      }
    }
    return { ward, v, r, o, or: or_, hasData };
  });

  const isFiltered = selectedWards.length > 0;
  const rows = isFiltered
    ? selectedWards.map((ward) => allRows.find((r) => r.ward === ward)).filter(Boolean)
    : allRows;
  const visibleCount = isFiltered ? selectedWards.length : wardTypes.length;
  const grandV        = rows.reduce((a, r) => a + r.v,  0);
  const grandR        = rows.reduce((a, r) => a + r.r,  0);
  const grandO        = rows.reduce((a, r) => a + r.o,  0);
  const grandOR       = rows.reduce((a, r) => a + r.or, 0);
  const grandTotalOcc = grandO + grandOR;
  const grandTotalVac = grandV + grandR;

  // ── Styles ────────────────────────────────────────────────────────────────
  const thStyle = (color) => ({
    padding: "11px 16px", fontWeight: 700, fontSize: 13,
    color: color || "var(--ink-2)", borderLeft: "1px solid var(--line)",
    textAlign: "center", background: "var(--panel-2)",
  });
  const tdStyle = (color, stripe) => ({
    textAlign: "center", padding: "10px 16px",
    borderTop: "1px solid var(--line)", borderLeft: "1px solid var(--line)",
    fontWeight: 700, fontSize: 15, color,
    background: stripe ? "rgba(0,0,0,.022)" : "transparent",
  });

  // ── Snapshot export ───────────────────────────────────────────────────────
  const snapshotRef = useRef(null);
  const viewLabel = activeView ? activeView.name : (isFiltered ? "Custom selection" : "All wards");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>Hospital Matrix</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 12 }}>
        {isLive ? `All bed states by ward · all operational wards · updated ${fmtTime(Date.now())}.` : `PRE round data for ${selDate}.`}
      </div>

      <SnapshotActions
        target={snapshotRef}
        onToast={showVToast}
      />

      {/* ── Saved Views selector ─────────────────────────────────────────── */}
      <div className="card" style={{ padding: "10px 12px", marginBottom: 10 }}>
        {/* Single compact row: select + Add View button */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            className="field"
            style={{ flex: 1, padding: "8px 10px", fontSize: 13 }}
            value={activeViewId ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              setActiveViewId(val === "" ? null : Number(val));
            }}
          >
            {activeViewId == null && <option value="">— Custom —</option>}
            {systemViews.length > 0 && (
              <optgroup label="Default">
                {systemViews.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </optgroup>
            )}
            {sharedViews.length > 0 && (
              <optgroup label="Shared">
                {sharedViews.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </optgroup>
            )}
            {myViews.length > 0 && (
              <optgroup label="Mine">
                {myViews.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </optgroup>
            )}
          </select>
          <button
            className="btn btn-primary"
            style={{ padding: "8px 12px", fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}
            onClick={() => setViewModal({ mode: "new" })}
          >
            + Add View
          </button>
        </div>

        {/* Active view info — compact, only when a view is selected */}
        {activeView && (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--teal)", fontWeight: 700, flexShrink: 0 }}>
              {activeView.name}
            </span>
            {activeView.is_shared && !activeView.is_system && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10, background: "rgba(0,210,180,.15)", color: "var(--teal)" }}>shared</span>
            )}
            <span className="dim" style={{ fontSize: 11, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeView.selected_wards.length > 0 ? activeView.selected_wards.join(" · ") : "All wards"}
            </span>
            {!activeView.is_system && (
              <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                <button className="chip" style={{ fontSize: 10, padding: "2px 7px" }}
                  onClick={() => setViewModal({ mode: "edit", view: activeView })}>Edit</button>
                <button className="chip" style={{ fontSize: 10, padding: "2px 7px", color: "var(--red)" }}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Delete view "${activeView.name}"?`,
                      message: activeView.is_shared
                        ? "This view is shared with all Admin users. Deleting it removes it for everyone.\n\nThis cannot be undone."
                        : "This cannot be undone.",
                      confirmLabel: "Delete view",
                      danger: true,
                    });
                    if (!ok) return;
                    try {
                      await api.cooDeleteView(activeView.id);
                      setActiveViewId(null); setSelectedWards([]);
                      await loadViews(); showVToast(`View "${activeView.name}" deleted`);
                    } catch (e) { showVToast(toastErr(e)); }
                  }}>Del</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Ward filter panel — unchanged except toggle handlers ──────────── */}
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 12 }}>
        <button
          onClick={() => setFilterOpen((o) => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center",
            justifyContent: "space-between", padding: "11px 16px",
            background: "var(--panel-2)", border: "none", cursor: "pointer", gap: 8,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--ink-2)" }}>
            Filter wards
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isFiltered && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                background: "rgba(0,210,180,.18)", color: "var(--teal)",
              }}>
                {visibleCount}/{wardTypes.length} shown
              </span>
            )}
            <span style={{
              display: "inline-flex", color: "var(--ink-3)",
              transform: filterOpen ? "rotate(270deg)" : "rotate(90deg)",
              transition: "transform .2s",
            }}>
              <Ic d={icons.chevron} s={15} />
            </span>
          </span>
        </button>

        {filterOpen && (
          <div style={{ padding: "12px 14px", borderTop: "1px solid var(--line)" }}>
            {isFiltered && (
              <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                <button className="chip" style={{ fontSize: 12 }} onClick={handleShowAllWards}>
                  ✕ Clear selection — show all
                </button>
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {wardTypes.map((ward) => {
                const idx = selectedWards.indexOf(ward);
                const ticked = idx !== -1;
                return (
                  <button
                    key={ward}
                    onClick={() => handleToggleWard(ward)}
                    style={{
                      padding: "6px 12px", borderRadius: 20, fontSize: 12,
                      fontWeight: 600, cursor: "pointer", border: "1px solid",
                      borderColor: ticked ? "var(--teal)" : "var(--line)",
                      background: ticked ? "rgba(0,210,180,.12)" : "var(--panel)",
                      color: ticked ? "var(--teal)" : "var(--ink-3)",
                      transition: "all .15s",
                    }}
                  >
                    {ticked ? `${idx + 1}. ` : ""}{ward}
                  </button>
                );
              })}
            </div>
            {isFiltered && (
              <div className="dim" style={{ fontSize: 11, marginTop: 10 }}>
                Numbers show the order wards appear in the table.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Matrix table ─────────────────────────────────────────────────── */}
      <div className="card tbl-scroll" style={{ padding: 0 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 560 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "11px 16px", fontWeight: 700, fontSize: 13, color: "var(--ink-2)", background: "var(--panel-2)", minWidth: 140 }}>Ward</th>
              {/* Occupied group */}
              <th style={{ ...thStyle("var(--st-o)"),  background: "var(--st-o-bg)"  }}>Total Occ</th>
              <th style={{ ...thStyle("var(--st-o)"),  background: "var(--st-o-bg)"  }}>On Bed</th>
              <th style={{ ...thStyle("var(--st-or)"), background: "var(--st-or-bg)" }}>Occ+Res</th>
              {/* Vacant group */}
              <th style={{ ...thStyle("var(--st-v)"),  background: "var(--st-v-bg)"  }}>Total Vac</th>
              <th style={{ ...thStyle("var(--st-v)"),  background: "var(--st-v-bg)"  }}>Vacant</th>
              <th style={{ ...thStyle("var(--st-vr)"), background: "var(--st-vr-bg)" }}>Vac+Res</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "24px 16px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
                  {isLive && !liveWards ? "Loading…" : "No data available."}
                </td>
              </tr>
            ) : (
              rows.map((row, ri) => {
                const stripe = ri % 2;
                const d = (val, color) => row.hasData
                  ? <span style={{ color: val > 0 ? color : "var(--ink-3)" }}>{val}</span>
                  : <span className="dim">–</span>;
                return (
                  <tr key={row.ward}>
                    <td style={{ padding: "10px 16px", fontWeight: 600, borderTop: "1px solid var(--line)", background: stripe ? "var(--panel)" : "var(--panel-2)" }}>{row.ward}</td>
                    <td style={tdStyle("var(--st-o)",  stripe)}>{d(row.o + row.or, "var(--st-o)")}</td>
                    <td style={tdStyle("var(--st-o)",  stripe)}>{d(row.o,          "var(--st-o)")}</td>
                    <td style={tdStyle("var(--st-or)", stripe)}>{d(row.or,         "var(--st-or)")}</td>
                    <td style={tdStyle("var(--st-v)",  stripe)}>{d(row.v + row.r,  "var(--st-v)")}</td>
                    <td style={tdStyle("var(--st-v)",  stripe)}>{d(row.v,          "var(--st-v)")}</td>
                    <td style={tdStyle("var(--st-vr)", stripe)}>{d(row.r,          "var(--st-vr)")}</td>
                  </tr>
                );
              })
            )}
            {rows.length > 0 && (
              <tr>
                <td style={{ padding: "12px 16px", fontWeight: 800, color: "var(--primary)", borderTop: "2px solid var(--line)", background: "var(--panel-2)" }}>
                  Total{isFiltered ? <span style={{ fontWeight: 400, fontSize: 11, color: "var(--ink-3)", marginLeft: 6 }}>(filtered)</span> : null}
                </td>
                {[
                  [grandTotalOcc, "var(--st-o)"],
                  [grandO,        "var(--st-o)"],
                  [grandOR,       "var(--st-or)"],
                  [grandTotalVac, "var(--st-v)"],
                  [grandV,        "var(--st-v)"],
                  [grandR,        "var(--st-vr)"],
                ].map(([val, color], i) => (
                  <td key={i} style={{ textAlign: "center", padding: "12px 16px", borderTop: "2px solid var(--line)", borderLeft: "1px solid var(--line)", fontWeight: 800, fontSize: 16, color, background: "var(--panel-2)" }} className="mono">{val}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ gap: 14, marginTop: 12, flexWrap: "wrap" }}>
        <span className="dim" style={{ fontSize: 11 }}>– = not yet entered for this round</span>
      </div>

      {/* ── Save/Edit View Modal ──────────────────────────────────────────── */}
      {viewModal && (
        <SaveViewModal
          mode={viewModal.mode}
          existingView={viewModal.view}
          currentWards={selectedWards}
          wardTypes={wardTypes}
          onClose={() => setViewModal(null)}
          onSaved={async (newId) => {
            setViewModal(null);
            await loadViews();
            if (newId != null) setActiveViewId(newId);
            showVToast(viewModal.mode === "new" ? "View saved ✓" : "View updated ✓");
          }}
        />
      )}

      {viewToast && <div className="toast">{viewToast}</div>}
      {confirmDialog}

      {/* Snapshot target — clipped to 0-height so it's invisible but still at
          screen position (0,0) so html-to-image getBoundingClientRect works. */}
      <div aria-hidden="true" style={{
        position: "fixed", top: 0, left: 0, width: 720,
        height: 0, overflow: "hidden", pointerEvents: "none", zIndex: -1,
      }}>
        <div ref={snapshotRef} id="snapshot-report" style={{ width: 720 }}>
          <SnapshotReport
            viewLabel={viewLabel}
            isLive={isLive}
            selDate={selDate}
            rows={rows}
            grandV={grandV}
            grandR={grandR}
            grandO={grandO}
            grandOR={grandOR}
            grandTotalOcc={grandTotalOcc}
            grandTotalVac={grandTotalVac}
            isFiltered={isFiltered}
          />
        </div>
      </div>
    </div>
  );
}

function SaveViewModal({ mode, existingView, currentWards, wardTypes, onClose, onSaved }) {
  useModal(onClose);
  const isNew = mode === "new";
  const [name,       setName]       = useState(existingView?.name || "");
  const [isShared,   setIsShared]   = useState(existingView?.is_shared ?? false);
  const [selWards,   setSelWards]   = useState(
    isNew ? [...currentWards] : [...(existingView?.selected_wards || [])]
  );
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState("");

  const toggleW = (w) => setSelWards((prev) =>
    prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w]
  );

  const save = async () => {
    if (!name.trim()) { setErr("View name required"); return; }
    setBusy(true);
    try {
      let newId = null;
      if (isNew) {
        const r = await api.cooSaveView({ name: name.trim(), selected_wards: selWards, is_shared: isShared });
        newId = r.id;
      } else {
        await api.cooEditView(existingView.id, { name: name.trim(), selected_wards: selWards, is_shared: isShared });
      }
      onSaved(newId);
    } catch (e) { setErr(friendlyError(e).message); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "88vh", overflowY: "auto" }}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="h1" style={{ fontSize: 18 }}>{isNew ? "Save View" : "Edit View"}</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          <label className="label">View name</label>
          <input className="field" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="e.g. Critical Care" />
          <div style={{ height: 14 }} />

          <label className="label">Visibility</label>
          <div className="seg" style={{ marginBottom: 16 }}>
            <button className={!isShared ? "on" : ""} onClick={() => setIsShared(false)}>Private</button>
            <button className={isShared  ? "on" : ""} onClick={() => setIsShared(true)}>Shared (all Admins)</button>
          </div>

          <label className="label">Selected wards
            <span className="dim" style={{ fontSize: 11, marginLeft: 6 }}>
              ({selWards.length === 0 ? "all wards" : `${selWards.length} selected`})
            </span>
          </label>
          {selWards.length > 0 && (
            <button className="chip" style={{ fontSize: 11, marginBottom: 10 }}
              onClick={() => setSelWards([])}>✕ Clear — use all wards</button>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
            {wardTypes.map((w) => {
              const on = selWards.includes(w);
              return (
                <button key={w} onClick={() => toggleW(w)} style={{
                  padding: "5px 11px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", border: "1px solid",
                  borderColor: on ? "var(--teal)" : "var(--line)",
                  background: on ? "rgba(0,210,180,.12)" : "var(--panel)",
                  color: on ? "var(--teal)" : "var(--ink-3)",
                }}>{w}</button>
              );
            })}
          </div>

          {err && <AppError message={err} />}

          <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
            {busy ? "Saving…" : isNew ? "Save view" : "Update view"}
          </button>
          <div style={{ height: 14 }} />
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Snapshot — one-tap button row + off-screen report card
// ══════════════════════════════════════════════════════════════════════════════

function SnapshotActions({ target, onToast }) {
  const [busy, setBusy] = useState(null); // "download" | "copy" | "share" | null
  const canShare = snapshotCanShare();

  const run = async (kind, fn, okMessage) => {
    if (busy) return;
    const el = target.current;
    if (!el) return;
    setBusy(kind);
    try {
      await fn(el);
      onToast(okMessage);
    } catch (e) {
      const msg = (e && e.message) || "";
      if (msg.includes("not supported")) onToast(msg);
      else if (e?.name === "AbortError") { /* user cancelled share — silent */ }
      else onToast("Unable to generate report. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card" style={{ padding: 10, marginBottom: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button
          className="btn btn-primary"
          style={{ flex: 1, minWidth: 160, padding: "10px 12px", fontSize: 13, justifyContent: "center" }}
          disabled={busy !== null}
          onClick={() => run("download", snapshotDownload, "Snapshot report downloaded")}
        >
          {busy === "download"
            ? <><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={15} /></span> Generating…</>
            : <>📸 Snapshot Report</>}
        </button>
        <button
          className="chip"
          style={{ padding: "8px 12px", fontSize: 12 }}
          disabled={busy !== null}
          onClick={() => run("copy", snapshotCopy, "Snapshot copied to clipboard")}
          title="Copy as image — paste into WhatsApp / Teams / Email"
        >
          {busy === "copy" ? "…" : "📋 Copy"}
        </button>
        {canShare && (
          <button
            className="chip"
            style={{ padding: "8px 12px", fontSize: 12 }}
            disabled={busy !== null}
            onClick={() => run("share", snapshotShare, "Snapshot shared successfully")}
            title="Share via system dialog"
          >
            {busy === "share" ? "…" : "📤 Share"}
          </button>
        )}
      </div>
    </div>
  );
}

function SnapshotReport({ viewLabel, isLive, selDate, rows, grandV, grandR, grandO, grandOR, grandTotalOcc, grandTotalVac, isFiltered }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });

  // Hard-coded light palette — same output regardless of active theme
  const C = {
    ink: "#0b1220", ink2: "#3b4350", ink3: "#7a8493",
    line: "#e3e8ef", panel: "#ffffff", panel2: "#f6f8fb",
    teal: "#2563EB", tealDeep: "#1D4ED8",
    green: "#16a34a", orange: "#ea580c", purple: "#7c3aed", blue: "#2563EB",
  };

  const th = (color, bg) => ({
    textAlign: "center", padding: "10px 10px", fontWeight: 700, fontSize: 11,
    color, textTransform: "uppercase", letterSpacing: ".04em",
    borderLeft: `1px solid ${C.line}`, background: bg || C.panel2,
  });
  const td = (color, stripe) => ({
    textAlign: "center", padding: "10px 10px", fontWeight: 700, fontSize: 14,
    color, borderTop: `1px solid ${C.line}`, borderLeft: `1px solid ${C.line}`,
    background: stripe ? C.panel : C.panel2,
  });

  return (
    <div style={{
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      background: C.panel, color: C.ink,
      padding: 28, width: "100%", boxSizing: "border-box",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 11,
            background: `linear-gradient(135deg, ${C.teal}, ${C.tealDeep})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 800, fontSize: 20,
          }}>B</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.ink, lineHeight: 1.2 }}>{HOSPITAL_NAME}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.teal, marginTop: 2 }}>BedFlow · Hospital Matrix Snapshot</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: C.ink3, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>Generated</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginTop: 2 }}>{dateStr}</div>
          <div style={{ fontSize: 11, color: C.ink2 }}>{timeStr}</div>
        </div>
      </div>

      {/* View name banner */}
      <div style={{
        background: C.panel2, borderRadius: 8, padding: "10px 14px",
        marginBottom: 14, borderLeft: `4px solid ${C.teal}`,
      }}>
        <div style={{ fontSize: 10, color: C.ink3, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>View</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginTop: 2 }}>
          {viewLabel}
          {isFiltered && <span style={{ fontSize: 10, color: C.ink3, fontWeight: 500, marginLeft: 8 }}>(filtered)</span>}
        </div>
        <div style={{ fontSize: 11, color: C.ink2, marginTop: 3 }}>
          {isLive ? "Live data — all operational wards" : `PRE round data for ${selDate}`}
        </div>
      </div>

      {/* Summary stat strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
        {[
          { label: "Total Occupied", val: grandTotalOcc, color: C.orange },
          { label: "On Bed",         val: grandO,        color: C.orange },
          { label: "Total Vacant",   val: grandTotalVac, color: C.green  },
          { label: "Vac+Res",        val: grandR,        color: C.blue   },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ background: C.panel2, borderRadius: 8, padding: "12px 14px", borderTop: `3px solid ${color}` }}>
            <div style={{ fontSize: 10, color: C.ink3, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1.1, marginTop: 3 }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ height: 1, background: C.line, marginBottom: 14 }} />

      {/* Matrix table */}
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: "hidden" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700, fontSize: 11, color: C.ink2, textTransform: "uppercase", letterSpacing: ".04em", background: C.panel2 }}>Ward</th>
              <th style={th(C.orange, "#fff7ed")}>Total Occ</th>
              <th style={th(C.orange, "#fff7ed")}>On Bed</th>
              <th style={th(C.purple, "#f5f3ff")}>Occ+Res</th>
              <th style={th(C.green,  "#f0fdf4")}>Total Vac</th>
              <th style={th(C.green,  "#f0fdf4")}>Vacant</th>
              <th style={th(C.blue,   "#eff6ff")}>Vac+Res</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "24px 16px", textAlign: "center", color: C.ink3, fontSize: 13 }}>
                  No data available.
                </td>
              </tr>
            ) : (
              rows.map((row, ri) => {
                const stripe = ri % 2 !== 0;
                const d = (val, color) => row.hasData
                  ? <span style={{ color: val > 0 ? color : C.ink3 }}>{val}</span>
                  : <span style={{ color: C.ink3 }}>–</span>;
                return (
                  <tr key={row.ward}>
                    <td style={{ padding: "10px 14px", fontWeight: 600, color: C.ink, borderTop: `1px solid ${C.line}`, background: stripe ? C.panel : C.panel2 }}>{row.ward}</td>
                    <td style={td(C.orange, stripe)}>{d(row.o + row.or, C.orange)}</td>
                    <td style={td(C.orange, stripe)}>{d(row.o,          C.orange)}</td>
                    <td style={td(C.purple, stripe)}>{d(row.or,         C.purple)}</td>
                    <td style={td(C.green,  stripe)}>{d(row.v + row.r,  C.green)}</td>
                    <td style={td(C.green,  stripe)}>{d(row.v,          C.green)}</td>
                    <td style={td(C.blue,   stripe)}>{d(row.r,          C.blue)}</td>
                  </tr>
                );
              })
            )}
            {rows.length > 0 && (
              <tr style={{ background: C.panel2 }}>
                <td style={{ padding: "11px 14px", fontWeight: 800, color: C.tealDeep, borderTop: `2px solid ${C.line}` }}>Total</td>
                {[
                  [grandTotalOcc, C.orange],
                  [grandO,        C.orange],
                  [grandOR,       C.purple],
                  [grandTotalVac, C.green],
                  [grandV,        C.green],
                  [grandR,        C.blue],
                ].map(([val, color], i) => (
                  <td key={i} style={{ textAlign: "center", padding: "11px 10px", fontWeight: 800, fontSize: 15, color, borderTop: `2px solid ${C.line}`, borderLeft: `1px solid ${C.line}`, background: C.panel2 }}>{val}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 18, paddingTop: 12, borderTop: `1px solid ${C.line}`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 10, color: C.ink3,
      }}>
        <span>Generated by BedFlow · Hospital Bed Management</span>
        <span style={{ fontWeight: 600 }}>{HOSPITAL_NAME}</span>
      </div>
    </div>
  );
}

// ── Block Beds Sheet (read-only bed grid for COO) ─────────────────────────────
function BlockBedsSheet({ pre, label, wards, onClose }) {
  useModal(onClose);
  const [bedsByWard, setBedsByWard] = useState({});
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState("ALL");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = {};
      await Promise.all(
        wards.map(async (w) => {
          try { result[w.ward] = (await api.wardBeds(w.id)).beds || []; }
          catch { result[w.ward] = []; }
        })
      );
      if (!cancelled) { setBedsByWard(result); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [pre]);

  const allBeds = Object.values(bedsByWard).flat();
  const counts  = { vn: 0, vr: 0, on_: 0 };
  for (const b of allBeds) {
    if (b.physical_status === "VACANT"   && b.reservation_status === "NONE")     counts.vn++;
    else if (b.physical_status === "VACANT"   && b.reservation_status === "RESERVED") counts.vr++;
    else if (b.physical_status === "OCCUPIED") counts.on_++;
  }

  function stateColor(p, r) {
    if (p === "VACANT" && r === "RESERVED") return "var(--st-vr)";
    if (p === "VACANT")   return "var(--st-v)";
    if (p === "OCCUPIED") return "var(--st-o)";
    return "var(--ink-3)";
  }
  function stateBg(p, r) {
    if (p === "VACANT" && r === "RESERVED") return "var(--st-vr-bg)";
    if (p === "VACANT")   return "var(--st-v-bg)";
    if (p === "OCCUPIED") return "var(--st-o-bg)";
    return "var(--panel-2)";
  }
  function stateShort(p, r) {
    if (p === "VACANT" && r === "RESERVED") return "Vac + Res";
    if (p === "VACANT")   return "Vacant";
    if (p === "OCCUPIED") return "Occupied";
    return "?";
  }

  const chips = [
    { key: "ALL",  label: `All (${allBeds.length})` },
    { key: "V",    label: `Vacant (${counts.vn})` },
    { key: "V+R",  label: `Vac+Res (${counts.vr})` },
    { key: "O",    label: `Occupied (${counts.on_})` },
    { key: "R",    label: `Reserved (${counts.vr})` },
  ];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div>
              <div className="h1" style={{ fontSize: 18 }}>{label || `Block ${pre}`}</div>
              <div className="dim" style={{ fontSize: 12 }}>{allBeds.length} beds</div>
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          {/* Filter chips */}
          {!loading && allBeds.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {chips.map(({ key, label }) => (
                <button key={key} className={"fchip" + (filter === key ? " on" : "")}
                  onClick={() => setFilter(key)}>{label}</button>
              ))}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: "center", padding: 32 }}>
              <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={22} /></span>
            </div>
          ) : allBeds.length === 0 ? (
            <div className="card empty">
              <Ic d={icons.bed} s={26} />
              <div style={{ marginTop: 10, fontWeight: 600 }}>No beds configured</div>
            </div>
          ) : (
            wards.map((w) => {
              const wardBeds = (bedsByWard[w.ward] || [])
                .filter(b => {
                  if (filter === "V")   return b.physical_status === "VACANT"   && b.reservation_status === "NONE";
                  if (filter === "V+R") return b.physical_status === "VACANT"   && b.reservation_status === "RESERVED";
                  if (filter === "O")   return b.physical_status === "OCCUPIED" && b.reservation_status === "NONE";
                  if (filter === "R")   return b.reservation_status === "RESERVED";
                  return true;
                })
                .sort((a, b) => naturalSort(a.bed_name, b.bed_name));
              if (wardBeds.length === 0) return null;
              return (
                <div key={w.ward} style={{ marginBottom: 18 }}>
                  <div className="row between" style={{ marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{w.ward}</span>
                    <span className="dim" style={{ fontSize: 12 }}>{(bedsByWard[w.ward] || []).length} beds</span>
                  </div>
                  <div className="bed-grid">
                    {wardBeds.map((bed) => {
                      const color = stateColor(bed.physical_status, bed.reservation_status);
                      return (
                        <div key={bed.id} className="bed-tile"
                          style={{ borderColor: color, background: stateBg(bed.physical_status, bed.reservation_status) }}>
                          <span className="bname">{bed.bed_name}</span>
                          <span className="bstate" style={{ color }}>{stateShort(bed.physical_status, bed.reservation_status)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
          <div style={{ height: 8 }} />
        </div>
      </div>
    </div>
  );
}

function WardSheet({ pre, onClose }) {
  useModal(onClose);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 4 }}>
            <div className="h1" style={{ fontSize: 18 }}>{pre.pre}</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>
          <div className="dim" style={{ fontSize: 12, marginBottom: 16 }}>{pre.floor} · {pre.label}</div>
          {pre.wards.map((w) => {
            const entered = w.vacant !== null;
            return (
              <div className="ward-card" key={w.ward}>
                <div className="row between" style={{ marginBottom: entered ? 10 : 0 }}>
                  <div style={{ fontWeight: 700 }}>{w.ward}</div>
                  <span className="dim" style={{ fontSize: 12 }}>{w.total} beds</span>
                </div>
                {entered ? (
                  <>
                    <StatusBar v={w.vacant} r={w.reserved} o={w.occupied} or={w.occupied_reserved || 0} total={w.total} />
                    <div className="row" style={{ gap: 8, marginTop: 10 }}>
                      <span className="tag v">{w.vacant} vacant</span>
                      <span className="tag r">{w.reserved} vac+res</span>
                      <span className="tag o">{w.occupied} occupied</span>
                      {(w.occupied_reserved || 0) > 0 && <span className="tag or">{w.occupied_reserved} occ+res</span>}
                    </div>
                  </>
                ) : <span className="tag b">not entered yet</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
