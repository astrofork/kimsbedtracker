import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { api, fmtTime, fmtRelative, fmtDateTime, toastErr, friendlyError, toMs, createSocket } from "./lib.js";
import {
  Ic, icons, ThemeToggle, StatusBar, useModal, AppError, useConfirm, BlockAvatar, Pagination,
  THEMES, T_LABEL, T_COLOR, getTheme, applyTheme,
} from "./ui.jsx";
import { AppShell, useTopBarSlot, useSidebarState } from "./shell.jsx";
import {
  HistoryViewer, actionLabel,
  HierarchyManager, PreBlockManager, PreManager,
  StationManager, NurseManager, PayerTypeManager, DestinationManager,
  DoctorBlockManager, DoctorManager, ConsultantManager,
  DepartmentDoctorManager, DischargeLoungeManager, DischargePhaseManager, PayerTATManager,
  SimpleLoginManager, PWO_LOGIN_TABS,
} from "./ManagerApp.jsx";
import {
  snapshotDownload, snapshotCopy, snapshotShare, snapshotCanShare,
} from "./snapshot.js";
import { naturalSort, calculateWardTotals } from "./bedUtils.js";
import BedExplorerModal from "./BedExplorerModal.jsx";

const HOSPITAL_NAME = "KIMS Hospitals";

// Flip to true to bring back the old draggable KPI grid at the top of the
// Dashboard tab — its code is untouched below, just not rendered.
const SHOW_OLD_KPI_GRID = false;

// Canonical KPI card order — mirrors the labels in LiveBedDashboard's KPIS
// array. Kept static (not derived from live data) so the drag-to-reorder
// hooks can run unconditionally even before the dashboard's data has loaded.
const KPI_DEFAULT_ORDER = [
  "Total Beds", "Operational Beds", "Census Beds", "Non-Census Beds",
  "Total Occupied", "Census Occupied", "On Bed", "OCC + RES",
  "Non-Census Occupied", "Total Vacant", "Vacant", "VAC + RES",
];

function dashboardUnitKey(unitType) {
  const raw = (unitType || "").trim();
  if (!raw) return null;
  if (raw.includes("Renova")) return "Renova";
  if (raw === "KIMS") return "KIMS";
  return raw;
}

function fmtReminderLabel(hhmm) {
  const [h] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM", hh = h % 12 === 0 ? 12 : h % 12;
  return hh + " " + ap;
}

// Backend role stays COO — the UI presents it as the Admin module.
const ADMIN_TITLES = {
  dashboard: "Live Bed Dashboard",
  commandcenter: "Command Center",
  analytics: "Analytics",
  matrix: "Hospital Matrix",
  activity: "PRE & Nurse Activity",
  reports: "Reports",
  savedviews: "Saved Views",
  alerts: "Alerts",
  tatboard: "Discharge TAT Leaderboard",
  overstay: "Overstay Alerts",
  pres: "PRE Users",
  nurses: "Nurse Users",
  doctors: "DMO Users",
  welfare: "Patient Welfare Officers",
  setup: "Blocks",
  preblocks: "PRE Blocks",
  doctorblocks: "DMO Blocks",
  stations: "Stations",
  payers: "Payer Types",
  deptdoctors: "Departments & Doctors",
  lounge: "Discharge Lounge",
  dischargephases: "Discharge Phase SLAs",
  payertat: "Payer TAT Config",
  settings: "Settings",
};

export default function COOApp({ user, meta, onLogout }) {
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [dischargeCounts, setDischargeCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState("");
  const [dismissed, setDismissed] = useState({});
  const [sheet, setSheet] = useState(null);
  const [bedsBlock, setBedsBlock] = useState(null); // { pre, label, wards }
  // date selection: 'live' or a YYYY-MM-DD historical day
  const [dates, setDates] = useState([]);
  const [selDate, setSelDate] = useState("live");
  const [history, setHistory] = useState(null);
  const [reportsView, setReportsView] = useState("activity"); // "activity" | "history" | "census"
  const [analyticsView, setAnalyticsView] = useState("overview"); // "overview" | "payer"
  const loadRef = useRef(null);
  const [liveKey, setLiveKey] = useState(0);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [overviewRes, complianceRes, dischargeRes] = await Promise.allSettled([
      api.cooOverview(),
      api.cooCompliance(),
      api.dischargeDashboard(),
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
    if (dischargeRes.status === "fulfilled") setDischargeCounts(dischargeRes.value);
    setLoading(false);
  }, []);

  // Keep loadRef fresh so socket handler always calls the latest load
  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  // Real-time updates via WebSocket — replaces 15-second polling
  useEffect(() => {
    const socket = createSocket();
    const refresh = () => { loadRef.current(); setLiveKey(k => k + 1); };
    socket.on("bed:update", refresh);
    socket.on("discharge:update", refresh);
    socket.on("discharge:overstay", refresh);
    socket.on("round:submit", refresh);
    socket.on("ward:operational", refresh);
    socket.on("alarm:active", refresh); // overdue PRE round → refresh compliance badge
    socket.on("connect", refresh); // catch missed updates on reconnect
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
    {
      section: "Dashboard", items: [
        { key: "dashboard", icon: icons.home, label: "Dashboard" },
        { key: "commandcenter", icon: icons.layers, label: "Command Center" },
        { key: "analytics", icon: icons.chart, label: "Analytics" },
      ]
    },
    {
      section: "Operations", items: [
        { key: "matrix", icon: icons.grid, label: "Hospital Matrix" },
        { key: "activity", icon: icons.user, label: "PRE & Nurse" },
        { key: "reports", icon: icons.clock, label: "Reports" },
        { key: "savedviews", icon: icons.layers, label: "Saved Views" },
        { key: "alerts", icon: icons.bell, label: "Alerts", dot: !!(due && !dismissed[due]) },
        { key: "tatboard", icon: icons.chart, label: "TAT Leaderboard" },
        { key: "overstay", icon: icons.alert, label: "Overstay Alerts" },
      ]
    },
    {
      section: "Users", items: [
        { key: "pres", icon: icons.user, label: "PRE Users" },
        { key: "nurses", icon: icons.user, label: "Nurse Users" },
        { key: "doctors", icon: icons.stethoscope, label: "DMO Users" },
        { key: "consultants", icon: icons.stethoscope, label: "Consultant Users" },
        { key: "fcpharmacy", icon: icons.list, label: "FC & Pharmacy" },
        { key: "welfare", icon: icons.shield, label: "Welfare Officers" },
      ]
    },
    {
      section: "Setup", items: [
        { key: "setup", icon: icons.layers, label: "Blocks" },
        { key: "preblocks", icon: icons.grid, label: "PRE Blocks" },
        { key: "doctorblocks", icon: icons.stethoscope, label: "DMO Blocks" },
        { key: "stations", icon: icons.bed, label: "Stations" },
        { key: "payers", icon: icons.list, label: "Payer Types" },
        { key: "destinations", icon: icons.list, label: "Destinations" },
        { key: "deptdoctors", icon: icons.layers, label: "Departments & Groups" },
        { key: "lounge", icon: icons.bed, label: "Discharge Lounge" },
        { key: "dischargephases", icon: icons.clock, label: "Discharge Phase SLAs" },
        { key: "payertat", icon: icons.list, label: "Payer TAT Config" },
      ]
    },
    {
      section: "System", items: [
        { key: "settings", icon: icons.settings, label: "Settings" },
      ]
    },
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
        tab === "dashboard" ? null : (
          <span className="pre-pill" style={{ fontSize: 11, flexDirection: "column", gap: 1, lineHeight: 1.2, padding: "5px 9px" }}>
            <span><Ic d={icons.clock} s={11} /> {fmtTime(Date.now())}</span>
            <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{new Date().toLocaleDateString("en-GB")}</span>
          </span>
        )
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

      {tab === "dashboard" && <LiveBedDashboard refreshKey={liveKey} userName={user?.name || user?.username || "Admin"} currentUsername={user?.username || null} />}
      {tab === "activity" && <ActivityPage />}
      {tab === "matrix" && <Matrix data={data} selDate={selDate} history={history} userId={user?.id} />}
      {tab === "analytics" && (
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
            {[["overview", "Overview"], ["payer", "Payer & Trends"]].map(([key, label]) => (
              <button key={key}
                className={"fchip" + (analyticsView === key ? " on" : "")}
                style={{ padding: "8px 18px", fontSize: 13 }}
                onClick={() => setAnalyticsView(key)}>
                {label}
              </button>
            ))}
          </div>
          {analyticsView === "overview" && <Overview data={data} compliance={compliance} selDate={selDate} history={history} onViewBeds={setBedsBlock} discharge={dischargeCounts} />}
          {analyticsView === "payer" && <PayerTrendsPanel refreshKey={liveKey} />}
        </div>
      )}
      {tab === "reports" && (
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
            {[["activity", "Activity"], ["history", "PRE Rounds"], ["census", "Midnight Census"]].map(([key, label]) => (
              <button key={key}
                className={"fchip" + (reportsView === key ? " on" : "")}
                style={{ padding: "8px 18px", fontSize: 13 }}
                onClick={() => setReportsView(key)}>
                {label}
              </button>
            ))}
          </div>
          {reportsView === "activity" && <ActivityHistoryPage />}
          {reportsView === "history" && <HistoryViewer showCensusCard={false} />}
          {reportsView === "census" && <MidnightCensusMatrix userId={user?.id} />}
        </div>
      )}
      {tab === "savedviews" && <SavedViewsPage data={data} userId={user?.id} onOpenInMatrix={() => setTab("matrix")} />}
      {tab === "alerts" && <AlertsPage data={data} compliance={compliance} due={due} dismissed={dismissed} setDismissed={setDismissed} />}
      {tab === "tatboard" && <TATLeaderboard />}
      {tab === "overstay" && <OverstayPanel />}
      {tab === "commandcenter" && <CommandCenter discharge={dischargeCounts} />}

      {/* Users */}
      {tab === "pres" && <PreManager showToast={showToast} />}
      {tab === "nurses" && <NurseManager showToast={showToast} />}
      {tab === "doctors" && <DoctorManager showToast={showToast} />}
      {tab === "consultants" && <ConsultantManager showToast={showToast} />}
      {tab === "fcpharmacy" && <SimpleLoginManager showToast={showToast} />}
      {tab === "welfare" && (
        <SimpleLoginManager
          showToast={showToast}
          tabs={PWO_LOGIN_TABS}
          title="Patient Welfare Officers"
          blurb="Manage Patient Welfare Officer (PWO) logins. PWOs handle patient complaints raised from the Patient Portal."
        />
      )}

      {/* Setup */}
      {tab === "setup" && <HierarchyManager showToast={showToast} />}
      {tab === "preblocks" && <PreBlockManager showToast={showToast} />}
      {tab === "doctorblocks" && <DoctorBlockManager showToast={showToast} />}
      {tab === "stations" && <StationManager showToast={showToast} />}
      {tab === "payers" && <PayerTypeManager showToast={showToast} />}
      {tab === "destinations" && <DestinationManager showToast={showToast} />}
      {tab === "deptdoctors" && <DepartmentDoctorManager showToast={showToast} />}
      {tab === "lounge" && <DischargeLoungeManager showToast={showToast} />}
      {tab === "dischargephases" && <DischargePhaseManager showToast={showToast} />}
      {tab === "payertat" && <PayerTATManager showToast={showToast} />}

      {tab === "settings" && <SettingsPage user={user} />}

      {sheet && <WardSheet pre={sheet} onClose={() => setSheet(null)} />}
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
// Lightweight SVG occupancy line chart — no chart lib, scales to container width.
// Catmull-Rom → cubic-bezier smoothing for a premium curved line.
function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function TrendChart({ points, height = 300 }) {
  const ref = useRef(null);
  const [w, setW] = useState(760);
  const [activeIdx, setActiveIdx] = useState(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((es) => { for (const e of es) setW(Math.max(320, e.contentRect.width)); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  if (!points || points.length === 0)
    return <div ref={ref} className="dim" style={{ height, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>No trend data captured yet.</div>;

  const padL = 38, padR = 16, padT = 14, padB = 26;
  const innerW = w - padL - padR, innerH = height - padT - padB;

  // Zoom the Y axis to the data range (with padding) so real occupancy variation
  // is visible instead of a flat line pinned to a fixed 0–100 scale.
  const vals = points.map((p) => p.pct);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 8) { const mid = (hi + lo) / 2; lo = mid - 4; hi = mid + 4; }
  lo = Math.max(0, Math.floor(lo - 2));
  hi = Math.min(100, Math.ceil(hi + 2));
  if (hi <= lo) hi = lo + 1;
  const span = hi - lo;

  const xs = points.length > 1 ? points.length - 1 : 1;
  const x = (i) => padL + (i / xs) * innerW;
  const y = (v) => padT + (1 - (v - lo) / span) * innerH;

  const pts = points.map((p, i) => [x(i), y(p.pct)]);
  const linePath = smoothPath(pts);
  const baseY = padT + innerH;
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(lo + span * f));
  const step = Math.max(1, Math.ceil(points.length / 7));
  const dotEvery = points.length <= 14 ? 1 : step; // dot every point when few, else sample

  // X-axis ticks: full "15 Jun, 05:00 am" labels (used by multi-day ranges)
  // are too wide to show ~7 of side-by-side without overlapping, so the axis
  // only ever shows the date portion (before the comma) — the full label with
  // time still appears in the hover callout below. Consecutive ticks landing
  // on the same calendar day are skipped so dates aren't repeated.
  const axisLabel = (lbl) => (lbl.includes(",") ? lbl.split(",")[0] : lbl);
  let lastAxisLabel = null;
  const ticks = points.map((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return null;
    const lbl = axisLabel(p.label);
    if (lbl === lastAxisLabel) return null;
    lastAxisLabel = lbl;
    return { i, lbl };
  }).filter(Boolean);

  const shownIdx = activeIdx ?? (points.length - 1);
  const sx = x(shownIdx), sy = y(points[shownIdx].pct);
  const handlePointer = (clientX) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const rel = Math.max(padL, Math.min(rect.width - padR, clientX - rect.left));
    const idx = Math.round(((rel - padL) / innerW) * xs);
    setActiveIdx(Math.max(0, Math.min(points.length - 1, idx)));
  };

  return (
    <div
      ref={ref}
      className="tr-chart"
      style={{ width: "100%" }}
      onMouseLeave={() => setActiveIdx(null)}
      onTouchEnd={() => setActiveIdx(null)}
    >
      <svg width={w} height={height} style={{ display: "block" }}>
        <defs>
          <linearGradient id="ccTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((g, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 5" />
            <text x={padL - 7} y={y(g) + 4} fontSize="10.5" fill="var(--ink-3)" textAnchor="end">{g}%</text>
          </g>
        ))}
        <path d={areaPath} fill="url(#ccTrendFill)" />
        <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => ((i % dotEvery === 0 && i !== points.length - 1)
          ? <circle key={i} cx={x(i)} cy={y(p.pct)} r="3.5" fill="var(--panel)" stroke="var(--primary)" strokeWidth="2" /> : null))}
        <rect
          x={padL}
          y={padT}
          width={innerW}
          height={innerH}
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onMouseMove={(e) => handlePointer(e.clientX)}
          onTouchStart={(e) => handlePointer(e.touches[0].clientX)}
          onTouchMove={(e) => handlePointer(e.touches[0].clientX)}
        />
        {ticks.map(({ i, lbl }) => (
          <text key={"t" + i} x={x(i)} y={height - 8} fontSize="10.5" fill="var(--ink-3)" textAnchor="middle">{lbl}</text>
        ))}
        {/* Interactive value callout */}
        {(() => {
          const bw = 58, bh = 36;
          const bx = Math.max(padL, Math.min(w - padR - bw, sx - bw / 2));
          const by = Math.max(2, sy - bh - 12);
          return (
            <g>
              <line x1={sx} y1={by + bh} x2={sx} y2={sy} stroke="var(--line)" strokeWidth="1" />
              <rect x={bx} y={by} width={bw} height={bh} rx="8" fill="var(--panel)" stroke="var(--line)" />
              <text x={bx + bw / 2} y={by + 16} fontSize="13" fontWeight="800" fill="var(--ink)" textAnchor="middle">{points[shownIdx].pct}%</text>
              <text x={bx + bw / 2} y={by + 28} fontSize="9.5" fill="var(--ink-3)" textAnchor="middle">{points[shownIdx].label}</text>
              <circle cx={sx} cy={sy} r="5" fill="var(--panel)" stroke="var(--primary)" strokeWidth="2.5" />
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// Tiny smooth sparkline with a gradient area fill (real data from snapshots).
function Sparkline({ values, color, id, h = 38 }) {
  if (!values || values.length < 2) return <div style={{ height: h }} />;
  const w = 100;
  const min = Math.min(...values), max = Math.max(...values), span = (max - min) || 1;
  const x = (i) => (i / (values.length - 1)) * w;
  const y = (v) => (h - 3) - ((v - min) / span) * (h - 9);
  const pts = values.map((v, i) => [x(i), y(v)]);
  const line = smoothPath(pts);
  const area = `${line} L${w},${h} L0,${h} Z`;
  const gid = "spk-" + id;
  return (
    <svg className="kc-spark" width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.34" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Richer trend chart for the "Total Patients" hero card only — same gradient
// area + line as Sparkline, plus a highlighted current-value dot, min/max
// labels, and a delta badge vs the start of the window. The small per-card
// Sparklines elsewhere stay bare on purpose (too little room for labels).
function HeroTrendChart({ values, color, id }) {
  if (!values || values.length < 2) return <div style={{ height: 44 }} />;
  const w = 240, h = 56, padTop = 9, padBottom = 9;
  const min = Math.min(...values), max = Math.max(...values), span = (max - min) || 1;
  const x = (i) => (i / (values.length - 1)) * w;
  const y = (v) => (h - padBottom) - ((v - min) / span) * (h - padTop - padBottom);
  const pts = values.map((v, i) => [x(i), y(v)]);
  const line = smoothPath(pts);
  const area = `${line} L${w},${h} L0,${h} Z`;
  const gid = "spk-" + id;
  const [lastX, lastY] = pts[pts.length - 1];
  const last = values[values.length - 1];
  const baseline = values.length > 24 ? values[values.length - 25] : values[0];
  const delta = last - baseline;
  const deltaPct = baseline !== 0 ? Math.round((delta / baseline) * 100) : (delta > 0 ? 100 : 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
      <div className="row" style={{ gap: 8, fontSize: 10.5 }}>
        <span className="dim">Low {min}</span>
        <span className="dim">High {max}</span>
        {delta !== 0 && (
          <span style={{ fontWeight: 800, color: delta > 0 ? "var(--st-or, #dc2626)" : "var(--st-v, #16a34a)" }}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(deltaPct)}%
          </span>
        )}
      </div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", maxWidth: w, height: h }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.34" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lastX} cy={lastY} r="4.5" fill={color} stroke="var(--panel-2)" strokeWidth="2" />
      </svg>
    </div>
  );
}

const PAYER_PALETTE = ["#6366f1", "#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6", "#ef4444"];
const payerColor = (name) => {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PAYER_PALETTE[h % PAYER_PALETTE.length];
};
const payerIcon = (name) => {
  const n = (name || "").toLowerCase();
  if (/insur|tpa/.test(n)) return icons.shield;
  if (/cash|self/.test(n)) return icons.banknote;
  if (/corp|company|employer/.test(n)) return icons.clipboard;
  if (/arogya|ehs|scheme|govt|government/.test(n)) return icons.fileText;
  return icons.clipboard;
};

// Cards absent from this set (Total/Operational/Census/Non-Census Beds) are
// plain inventory counts, not occupancy filters — they don't open the Bed
// Explorer. The matching default-filter logic for each of these labels lives
// in BedExplorerModal's ENTRY_PRESETS.
const CLICKABLE_KPI_LABELS = new Set([
  "Total Occupied", "Census Occupied", "Non-Census Occupied", "On Bed", "OCC + RES",
  "Total Vacant", "Vacant", "VAC + RES",
]);

// Transaction Board cards → admission list, not a bed-status filter (that's
// BedExplorerModal's job) — these are discharge_tracking rows, so they need
// their own small viewer. "PLANNED"/"INITIATED" reuse the existing active-
// discharges list (filtered client-side by status); every step-pending card
// reuses the exact endpoint FC's dashboard already uses for the same data.
function DischargeListModal({ entry, onClose }) {
  useModal(onClose);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setRows(null); setError("");
    let req;
    if (entry.step === "ADMITTED_TODAY") {
      req = api.dischargesAdmittedToday(entry.hospitalWide, entry.unit).then((r) => r.admissions || []);
    } else if (entry.step === "PLANNED") {
      const todayStr = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
      req = api.dischargesActive(undefined, entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) =>
        d.status === "PLANNED" && d.planned_date === todayStr));
    } else if (entry.step === "INITIATED") {
      req = api.dischargesActive(undefined, entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) => d.status === "DISCHARGE_INITIATED"));
    } else if (entry.step === "PENDING_INPROGRESS") {
      req = api.dischargesActive(undefined, entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) =>
        d.status === "DISCHARGE_INITIATED" || d.status === "IN_PROGRESS"));
    } else if (entry.step === "OVERDUE_PLANNED") {
      const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
      req = api.dischargesActive(undefined, entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) =>
        d.status === "PLANNED" && d.planned_date < today));
    } else if (entry.step === "INITIATED_TODAY") {
      req = api.dischargesInitiatedToday(entry.hospitalWide, entry.unit).then((r) => r.discharges || []);
    } else if (entry.step === "UNPLANNED_TODAY") {
      const todayStr = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
      const todayStartMs = new Date(todayStr + "T00:00:00+05:30").getTime();
      req = api.dischargesInitiatedToday(entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) =>
        d.planned_date === todayStr && d.created_at >= todayStartMs));
    } else if (entry.step === "AWAITING_PATIENT_LEAVE") {
      req = api.dischargesActive(undefined, entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) =>
        (d.status === "DISCHARGE_INITIATED" || d.status === "IN_PROGRESS") &&
        d.system_checkout_status === "COMPLETED" && d.physical_checkout_status !== "COMPLETED"));
    } else if (entry.step === "COMPLETED_TODAY") {
      req = api.dischargesCompletedToday(entry.hospitalWide, entry.unit).then((r) => r.discharges || []);
    } else if (entry.step === "IN_DISCHARGE_LOUNGE") {
      req = api.dischargesActive(undefined, entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) =>
        (d.status === "DISCHARGE_INITIATED" || d.status === "IN_PROGRESS") &&
        d.physical_checkout_status === "COMPLETED" && d.system_checkout_status !== "COMPLETED"));
    } else if (entry.step === "ALL_PENDING") {
      const todayStr = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
      req = api.dischargesActive(undefined, entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) =>
        (d.status === "DISCHARGE_INITIATED" || d.status === "IN_PROGRESS") ||
        (d.status === "PLANNED" && d.planned_date === todayStr)));
    } else if (entry.step === "SCHEDULED_TODAY") {
      const todayStr = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
      req = api.dischargesActive(undefined, entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) =>
        d.planned_date === todayStr && (
          d.status === "PLANNED" ||
          d.status === "DISCHARGE_INITIATED" ||
          d.status === "IN_PROGRESS"
        )));
    } else if (entry.step === "CANCELLED_TODAY") {
      req = api.dischargesCancelledToday(entry.hospitalWide, entry.unit).then((r) => r.discharges || []);
    } else if (entry.step === "PATIENT_LEFT") {
      req = api.dischargesPatientLeft(entry.hospitalWide, entry.unit).then((r) => r.discharges || []);
    } else if (entry.step === "DRUG_RETURN_DONE") {
      req = api.dischargesInitiatedToday(entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) => d.drug_return_status === "COMPLETED"));
    } else if (entry.step === "PHARMACY_DONE") {
      req = api.dischargesInitiatedToday(entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) => d.pharmacy_clearance_status === "COMPLETED"));
    } else if (entry.step === "PROCEDURE_DONE") {
      req = api.dischargesInitiatedToday(entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) =>
        d.procedure_reconciliation_status === "COMPLETED" || d.procedure_reconciliation_status === "NOT_APPLICABLE"));
    } else if (entry.step === "BILLING_DONE") {
      req = api.dischargesInitiatedToday(entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) => d.billing_started_status === "COMPLETED"));
    } else if (entry.step === "AUDIT_DONE") {
      req = api.dischargesInitiatedToday(entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) => d.audit_status === "COMPLETED"));
    } else if (entry.step === "BILL_READY_DONE") {
      req = api.dischargesInitiatedToday(entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) => d.bill_ready_status === "COMPLETED"));
    } else if (entry.step === "PAYMENT_DONE") {
      req = api.dischargesInitiatedToday(entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) => d.payment_status === "COMPLETED"));
    } else if (entry.step === "SC_DONE") {
      req = api.dischargesInitiatedToday(entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) => d.system_checkout_status === "COMPLETED"));
    } else if (entry.step === "PC_DONE") {
      req = api.dischargesInitiatedToday(entry.hospitalWide, entry.unit).then((r) => (r.discharges || []).filter((d) => d.physical_checkout_status === "COMPLETED"));
    } else {
      req = api.dischargesPendingStep(entry.step, entry.hospitalWide, entry.unit).then((r) => r.discharges || []);
    }
    req.then((data) => { if (!cancelled) setRows(data); })
      .catch((e) => { if (!cancelled) setError(toastErr(e)); });
    return () => { cancelled = true; };
  }, [entry.step, entry.hospitalWide, entry.unit]);

  const [dlSearch, setDlSearch] = useState("");
  const [dlSearchBy, setDlSearchBy] = useState("ward");

  const filtered = rows ? rows.filter((d) => {
    const q = dlSearch.trim().toLowerCase();
    if (!q) return true;
    if (dlSearchBy === "ip") return (d.ip_last6 || "").toLowerCase().includes(q);
    if (dlSearchBy === "ward") return (d.ward_name || "").toLowerCase().includes(q);
    return (d.bed_name || "").toLowerCase().includes(q);
  }) : null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet bx-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="bx-header">
          <div className="bx-header-title">
            <span className="bx-header-icon" style={{ color: entry.color || "var(--primary)", background: (entry.color || "var(--primary)") + "18" }}>
              <Ic d={icons.fileText} s={20} />
            </span>
            <div>
              <div className="h1" style={{ fontSize: 18 }}>{entry.label}</div>
              <div className="dim" style={{ fontSize: 12.5 }}>
                {rows === null ? "Loading…"
                  : filtered.length === rows.length ? `${rows.length} admission${rows.length === 1 ? "" : "s"}`
                    : `${filtered.length} of ${rows.length} admissions`}
              </div>
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close"><Ic d={icons.x} s={18} /></button>
        </div>

        {rows && rows.length > 0 && (
          <div style={{ display: "flex", gap: 8, padding: "0 16px 10px", alignItems: "center" }}>
            <div className="seg-pill" style={{ flexShrink: 0 }}>
              {[{ value: "ward", label: "Ward" }, { value: "bed", label: "Bed" }, { value: "ip", label: "IP" }].map((o) => (
                <button key={o.value} className={dlSearchBy === o.value ? "on" : ""}
                  onClick={() => { setDlSearchBy(o.value); setDlSearch(""); }}>{o.label}</button>
              ))}
            </div>
            <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", pointerEvents: "none", display: "flex" }}>
                <Ic d={icons.search} s={14} />
              </span>
              <input className="field" value={dlSearch} onChange={(e) => setDlSearch(e.target.value)}
                placeholder={dlSearchBy === "ip" ? "Search by IP…" : dlSearchBy === "ward" ? "Search by ward…" : "Search by bed name…"}
                style={{ paddingLeft: 30, fontSize: 12, height: 32, width: "100%", borderRadius: 9 }} maxLength={40} />
            </div>
          </div>
        )}

        <div className="bx-main">
          {error && <div style={{ fontSize: 12, color: "var(--red)" }}>{error}</div>}
          {rows === null && !error && <div className="dim" style={{ padding: "24px 0", textAlign: "center" }}>Loading…</div>}
          {filtered && filtered.length === 0 && (
            <div className="dim" style={{ padding: "24px 0", textAlign: "center" }}>
              {dlSearch.trim() ? "No admissions match your search." : "No admissions match right now."}
            </div>
          )}
          {filtered && filtered.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(152px, 1fr))", gap: 8 }}>
              {filtered.map((d) => (
                <div key={d.admission_id} style={{
                  display: "flex", flexDirection: "column", gap: 5,
                  background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12,
                  padding: "10px 11px", boxShadow: "var(--shadow)", minHeight: 90,
                }}>
                  <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-.01em", lineHeight: 1.2, wordBreak: "break-word" }}>
                    {d.bed_name}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, lineHeight: 1.4 }}>
                    <span style={{ color: "var(--ink-3)", fontWeight: 600, flexShrink: 0 }}>IP</span>
                    <span style={{ fontWeight: 700, color: "var(--ink)", textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.ip_last6 || "—"}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, lineHeight: 1.4 }}>
                    <span style={{ color: "var(--ink-3)", fontWeight: 600, flexShrink: 0 }}>Ward</span>
                    <span style={{ fontWeight: 700, color: "var(--ink)", textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.ward_name}>
                      {d.ward_name}
                    </span>
                  </div>
                  {d.planned_date && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, lineHeight: 1.4 }}>
                      <span style={{ color: "var(--ink-3)", fontWeight: 600, flexShrink: 0 }}>Plan</span>
                      <span style={{ fontWeight: 600, color: "var(--ink-2)", textAlign: "right", whiteSpace: "nowrap" }}>
                        {d.planned_date}{d.planned_time ? " " + d.planned_time : ""}
                      </span>
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "var(--ink-3)", fontWeight: 500, marginTop: "auto" }}>
                    {fmtRelative(d.updated_at || d.admitted_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const CONSULT_ACCENT = "#0d9488"; // teal — distinct from ward table blues/oranges

const CONSULTANT_GROUP_BY_OPTIONS = [
  { value: "department", label: "Department" },
  { value: "none", label: "None" },
];

// A consultant can have active patients spread across more than one
// department (c.departments is a per-department patient-count breakdown,
// not a single assignment) — grouped view puts them under whichever
// department they have the most active patients in right now, so every
// consultant appears exactly once instead of being duplicated per department.
function primaryDepartment(c) {
  const entries = Object.entries(c.departments || {});
  if (entries.length === 0) return "Unassigned";
  return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
}

function ConsultantsTable({ data, search = "", searchBy = "ward" }) {
  const { payerTypes, consultants: allConsultants } = data;
  const [groupBy, setGroupBy] = useState("department");
  const [expanded, setExpanded] = useState(new Set());
  useEffect(() => { setExpanded(new Set()); }, [groupBy]);
  const toggleSection = (key) =>
    setExpanded(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });
  const q = search.trim().toLowerCase();
  const consultants = !q ? allConsultants
    : searchBy === "payer_type" ? allConsultants.filter(c => Object.keys(c.payers || {}).some(p => p.toLowerCase().includes(q)))
      : searchBy === "department" ? allConsultants.filter(c => Object.keys(c.departments || {}).some(d => d.toLowerCase().includes(q)))
        : allConsultants;
  const grandTotal = consultants.reduce((s, c) => s + c.total, 0);

  // One stable color per payer type (same hash palette as payer cards)
  const pColors = {};
  payerTypes.forEach(p => { pColors[p] = payerColor(p); });

  const thBase = {
    fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em",
    color: "var(--ink-2)", whiteSpace: "nowrap", padding: "8px 12px",
    borderBottom: "2px solid var(--line)", background: "var(--panel-2)",
  };
  const tdC = { textAlign: "center", padding: "7px 12px", minWidth: 72 };

  const consultantRow = (c) => {
    const pct = grandTotal > 0 ? Math.round((c.total / grandTotal) * 100) : 0;
    return (
      <tr key={c.name}>
        <td style={{ fontWeight: 600, padding: "7px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{
              width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
              background: `${CONSULT_ACCENT}18`, color: CONSULT_ACCENT,
              fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {c.name.trim().charAt(0).toUpperCase()}
            </span>
            <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>
              {c.name}
            </span>
          </div>
        </td>
        <td style={{ ...tdC, fontWeight: 700, color: CONSULT_ACCENT }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span>{c.total}</span>
            <span style={{ fontSize: 9, fontWeight: 600, color: "var(--ink-3)" }}>{pct}%</span>
          </div>
        </td>
        {payerTypes.map(p => {
          const n = c.payers[p] ?? 0;
          return (
            <td key={p} style={{ ...tdC, fontWeight: n > 0 ? 700 : 400, color: n > 0 ? pColors[p] : "var(--ink-3)" }}>
              {n > 0 ? n : <span style={{ opacity: 0.35 }}>—</span>}
            </td>
          );
        })}
      </tr>
    );
  };

  // Grouped-by-department: sections sorted by patient count (busiest
  // department first), each with its own subtotal row, consultants sorted
  // the same way as the flat view (most patients first) within each group.
  const groups = groupBy !== "department" ? null : (() => {
    const byDept = new Map();
    for (const c of consultants) {
      const dept = primaryDepartment(c);
      if (!byDept.has(dept)) byDept.set(dept, []);
      byDept.get(dept).push(c);
    }
    return [...byDept.entries()]
      .map(([dept, list]) => ({ dept, list, total: list.reduce((s, c) => s + c.total, 0) }))
      .sort((a, b) => b.total - a.total || a.dept.localeCompare(b.dept));
  })();

  return (
    <div className="card" style={{ marginBottom: 16, overflow: "hidden" }}>
      {/* Header bar */}
      <div className="row between" style={{ padding: "13px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: `${CONSULT_ACCENT}18`, display: "flex", alignItems: "center", justifyContent: "center", color: CONSULT_ACCENT }}>
            <Ic d={icons.user} s={15} />
          </span>
          <span style={{ fontWeight: 700, fontSize: 14, color: CONSULT_ACCENT }}>Consultants</span>
        </div>
        {/* Shorter labels ("Group by: Department" → "Department", "active
            patients" → "active") + tighter padding so the dropdown and both
            chips actually fit on one line on a phone instead of the second
            chip wrapping onto its own line. */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
          <select className="field" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}
            style={{ padding: "3px 6px", fontSize: 10.5, width: "auto", flexShrink: 1, minWidth: 0 }}>
            {CONSULTANT_GROUP_BY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className="chip" style={{ color: CONSULT_ACCENT, whiteSpace: "nowrap", fontSize: 10.5, padding: "3px 8px", flexShrink: 0 }}>{consultants.length} consultants</span>
          <span className="chip" style={{ color: CONSULT_ACCENT, whiteSpace: "nowrap", fontSize: 10.5, padding: "3px 8px", flexShrink: 0 }}>{grandTotal} active</span>
        </div>
      </div>

      {/* Table */}
      <div className="tbl-wrap" style={{ border: "none", borderRadius: 0 }}>
        <table className="tbl tbl-pin1">
          <thead>
            <tr>
              <th style={{ ...thBase, textAlign: "left", minWidth: 160 }}>Consultant</th>
              <th style={{ ...thBase, ...wstC, color: CONSULT_ACCENT }}>Total</th>
              {payerTypes.map(p => (
                <th key={p} style={{ ...thBase, ...wstC, color: pColors[p] }}>{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Grand total row */}
            <tr className="tbl-total-row" style={{ background: `${CONSULT_ACCENT}0d`, "--tbl-total-accent": CONSULT_ACCENT }}>
              <td style={{ fontWeight: 800, fontSize: 13, color: CONSULT_ACCENT, background: `${CONSULT_ACCENT}0d` }}>
                TOTAL
              </td>
              <td style={{ ...tdC, fontWeight: 800, color: CONSULT_ACCENT }}>{grandTotal}</td>
              {payerTypes.map(p => (
                <td key={p} style={{ ...tdC, fontWeight: 800, color: pColors[p] }}>
                  {consultants.reduce((s, c) => s + (c.payers[p] ?? 0), 0)}
                </td>
              ))}
            </tr>

            {groups ? groups.map((g) => {
              const isOpen = expanded.has(g.dept);
              return (
                <React.Fragment key={g.dept}>
                  <tr onClick={() => toggleSection(g.dept)}
                    style={{ cursor: "pointer", background: "var(--panel-2)", borderTop: "1px solid var(--line)", userSelect: "none" }}>
                    <td style={{ fontWeight: 800, fontSize: 12, letterSpacing: ".04em", color: "var(--primary)", padding: "8px 14px" }}>
                      <span style={{ marginRight: 8, display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", fontSize: 10 }}>▶</span>
                      {g.dept}
                    </td>
                    <td style={{ ...tdC, fontWeight: 800, color: CONSULT_ACCENT }}>{g.total}</td>
                    {payerTypes.map(p => (
                      <td key={p} style={{ ...tdC, fontWeight: 800, color: pColors[p] }}>
                        {g.list.reduce((s, c) => s + (c.payers[p] ?? 0), 0)}
                      </td>
                    ))}
                  </tr>
                  {isOpen && g.list.map(consultantRow)}
                </React.Fragment>
              );
            }) : consultants.map(consultantRow)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Section Navigator ──────────────────────────────────────────────────────────
const NAV_SECTIONS_DEF = [
  { id: "nav-filters", label: "Search & Filters", icon: "filter" },
  { id: "nav-snapshot", label: "Hospital Snapshot", icon: "home" },
  { id: "nav-occupancy", label: "Occupancy Board", icon: "chart" },
  { id: "nav-txn", label: "Transactions", icon: "refresh" },
  { id: "nav-wards", label: "Bed Matrix", icon: "grid" },
  { id: "nav-consultants", label: "Consultants", icon: "user" },
];

function SectionNavigator({ scanKey }) {
  const [activeId, setActiveId] = useState(null);
  const [sections, setSections] = useState([]);
  const [hovered, setHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const ratiosRef = useRef({});
  const leaveTimer = useRef(null);
  const obsRef = useRef(null);

  // (Re-)discover sections whenever scanKey changes
  useEffect(() => {
    const found = NAV_SECTIONS_DEF.filter(s => document.getElementById(s.id));
    setSections(found);
  }, [scanKey]);

  // Set up IntersectionObserver whenever discovered sections change
  useEffect(() => {
    if (obsRef.current) { obsRef.current.disconnect(); obsRef.current = null; }
    if (sections.length === 0) return;

    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) ratiosRef.current[e.target.id] = e.intersectionRatio;
      let bestId = null, bestRatio = 0.03;
      for (const [id, r] of Object.entries(ratiosRef.current)) {
        if (r > bestRatio) { bestRatio = r; bestId = id; }
      }
      if (bestId) setActiveId(bestId);
    }, {
      threshold: [0, .05, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1],
      rootMargin: "-60px 0px -15% 0px",
    });

    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    obsRef.current = obs;
    return () => obs.disconnect();
  }, [sections]);

  const scrollTo = useCallback((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setHovered(false);
    setMobileOpen(false);
    // Brief highlight pulse
    el.setAttribute("data-nav-hl", "1");
    setTimeout(() => el.removeAttribute("data-nav-hl"), 800);
  }, []);

  const onEnter = () => { clearTimeout(leaveTimer.current); setHovered(true); };
  const onLeave = () => { leaveTimer.current = setTimeout(() => setHovered(false), 280); };

  if (sections.length === 0) return null;

  return (
    <>
      {/* ── Desktop floating pill ─────────────────────────────────────────── */}
      <nav
        className={"snav" + (hovered ? " snav-open" : "")}
        aria-label="Section navigator"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onKeyDown={(e) => { if (e.key === "Escape") setHovered(false); }}
      >
        {hovered
          ? <div className="snav-header" aria-hidden="true">Navigation</div>
          : <div className="snav-bed-handle" aria-hidden="true"><Ic d={icons.bed} s={16} /></div>
        }
        <div className="snav-list" role="list">
          {sections.map(s => {
            const active = s.id === activeId;
            return (
              <button
                key={s.id}
                role="listitem"
                className={"snav-item" + (active ? " snav-active" : "")}
                onClick={() => scrollTo(s.id)}
                title={!hovered ? s.label : undefined}
                aria-label={`${s.label}${active ? " — current section" : ""}`}
              >
                <span className="snav-icon" aria-hidden="true">
                  <Ic d={icons[s.icon]} s={hovered ? 15 : 14} />
                </span>
                {hovered && <span className="snav-label">{s.label}</span>}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Mobile FAB ────────────────────────────────────────────────────── */}
      <button
        className="snav-fab"
        onClick={() => setMobileOpen(true)}
        aria-label="Navigate to section"
        aria-expanded={mobileOpen}
      >
        <Ic d={icons.bed} s={20} />
      </button>

      {/* ── Mobile bottom sheet ───────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="snav-overlay"
          role="presentation"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="snav-sheet"
            role="dialog"
            aria-label="Navigate to section"
            onClick={e => e.stopPropagation()}
          >
            <div className="snav-sheet-head">
              <span className="snav-sheet-title">Navigate to</span>
              <button className="snav-sheet-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                <Ic d={icons.x} s={16} />
              </button>
            </div>
            {sections.map(s => {
              const active = s.id === activeId;
              return (
                <button
                  key={s.id}
                  className={"snav-sheet-item" + (active ? " snav-active" : "")}
                  onClick={() => scrollTo(s.id)}
                  aria-label={`${s.label}${active ? " — current section" : ""}`}
                >
                  <span className="snav-sheet-icon" aria-hidden="true">
                    <Ic d={icons[s.icon]} s={18} />
                  </span>
                  <span className="snav-sheet-label">{s.label}</span>
                  {active && (
                    <span className="snav-sheet-check" aria-hidden="true">
                      <Ic d={icons.check} s={14} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// scope: "admin" (COO, default) | "pre" | "nurse" | "consultant".
//
// A scope entry only decides WHICH URLs this dashboard calls — it never widens
// or narrows what comes back. Breadth is decided server-side by the endpoint
// behind each role: /coo/* and /pre/* both return hospital-wide rows, while
// /nurse/* and /consultant/* filter to that user's own wards (see nurse.ts).
//
// So a nurse mount simply never receives hospital-wide rows, and PRE — which
// mirrors the Admin dashboard — never receives anything less than the Admin does.
const SCOPED_FETCHERS = {
  // PRE is a special case: it still calls PRE-authenticated URLs (so the server
  // authorises it as PRE, not COO), but every one of those endpoints returns
  // hospital-wide rows — see the "Admin dashboard" block in routes/pre.ts. That
  // makes it hospitalWide, so it renders the full admin dashboard, history
  // sparklines and consultants table included. Nurse/Consultant stay ward-scoped.
  pre: {
    hospitalWide: true,
    liveWards: () => api.preLiveWards(), bedDetails: api.preBedDetails,
    adminDashboard: (u) => api.preAdminDashboard(u), payerTypes: () => api.prePayerTypes(),
    adminDashboardHistory: (u) => api.preAdminDashboardHistory(u),
    consultants: () => api.preConsultants(), snapshots: () => api.preSnapshots(),
  },
  nurse: { liveWards: () => api.nurseLiveWards(), bedDetails: api.nurseBedDetails, adminDashboard: (u) => api.nurseAdminDashboard(u), payerTypes: () => api.nursePayerTypes() },
  "nurse-full": {
    hospitalWide: true,
    liveWards: () => api.nurseHospitalLiveWards(), bedDetails: api.nurseHospitalBedDetails,
    adminDashboard: (u) => api.nurseHospitalAdminDashboard(u), payerTypes: () => api.nursePayerTypes(),
    adminDashboardHistory: (u) => api.nurseHospitalAdminDashboardHistory(u),
    consultants: () => api.nurseHospitalConsultants(), snapshots: () => api.nurseHospitalSnapshots(),
  },
  consultant: {
    hospitalWide: true,
    liveWards: () => api.consultantLiveWards(), bedDetails: api.consultantBedDetails,
    adminDashboard: (u) => api.consultantAdminDashboard(u), payerTypes: () => api.consultantPayerTypes(),
    adminDashboardHistory: (u) => api.consultantAdminDashboardHistory(u),
    consultants: () => api.consultantConsultants(), snapshots: () => api.consultantSnapshots(),
  },
  doctor: {
    hospitalWide: true,
    liveWards: () => api.doctorLiveWards(), bedDetails: api.doctorBedDetails,
    adminDashboard: (u) => api.doctorAdminDashboard(u), payerTypes: () => api.doctorPayerTypes(),
    adminDashboardHistory: (u) => api.doctorAdminDashboardHistory(u),
    consultants: () => api.doctorConsultants(), snapshots: () => api.doctorSnapshots(),
  },
  fc: {
    hospitalWide: true,
    liveWards: () => api.fcLiveWards(), bedDetails: api.fcBedDetails,
    adminDashboard: (u) => api.fcAdminDashboard(u), payerTypes: () => api.fcPayerTypes(),
    adminDashboardHistory: (u) => api.fcAdminDashboardHistory(u),
    consultants: () => api.fcConsultants(), snapshots: () => api.fcSnapshots(),
  },
  pharmacy: {
    hospitalWide: true,
    liveWards: () => api.pharmacyLiveWards(), bedDetails: api.pharmacyBedDetails,
    adminDashboard: (u) => api.pharmacyAdminDashboard(u), payerTypes: () => api.pharmacyPayerTypes(),
    adminDashboardHistory: (u) => api.pharmacyAdminDashboardHistory(u),
    consultants: () => api.pharmacyConsultants(), snapshots: () => api.pharmacySnapshots(),
  },
};
// Transaction Board is temporarily restricted to this one username only —
// frontend-only gate, per explicit request ("hide it for other users, don't
// remove the code"). Everything the board depends on (adminCards.transaction,
// openDischargeList, etc.) still loads/works normally for every role; this
// only controls whether the board itself renders. Flip/remove this constant
// to restore it for everyone.
const TRANSACTION_BOARD_VISIBLE_TO = ["admin1"];

/** Draggable scroll indicator for the Occupancy Board strip, plus the edge
 *  fades that say "there is more this way".
 *
 *  Why a custom thumb rather than un-hiding the native scrollbar: the strip
 *  only exists inside `@container (max-width:880px)` — phones and small
 *  tablets — and that is exactly where iOS Safari and Android Chrome use
 *  overlay scrollbars, which are unstyleable and stay hidden until you are
 *  already scrolling. The native bar would be invisible to precisely the
 *  users who don't know the strip moves.
 *
 *  "Only when the cards are swipeable" is measured, not breakpointed: above
 *  880px the container query leaves .cv-groups as a grid, so scrollWidth ===
 *  clientWidth, `max` is 0, and this renders nothing. No second copy of the
 *  880px threshold to drift out of sync with the CSS.
 *
 *  Positions are written straight to the node. Routing a scroll handler
 *  through setState would re-render the whole occupancy panel on every frame
 *  of a momentum swipe; React state here holds only the show/hide flag, which
 *  changes rarely. */
function SwipeThumb({ targetRef, deps }) {
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const dragRef = useRef(null);
  const [scrollable, setScrollable] = useState(false);

  const measure = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const can = max > 1;
    setScrollable((was) => (was === can ? was : can));

    // Fades belong to the wrapper, and only on the side that still has content.
    const wrap = el.parentElement;
    if (wrap) {
      wrap.classList.toggle("cv-fade-l", can && el.scrollLeft > 2);
      wrap.classList.toggle("cv-fade-r", can && el.scrollLeft < max - 2);
    }

    const track = trackRef.current, thumb = thumbRef.current;
    if (!can || !track || !thumb) return;
    const free = track.clientWidth;
    const w = Math.max(free * (el.clientWidth / el.scrollWidth), 24);
    thumb.style.width = `${w}px`;
    thumb.style.transform = `translateX(${(el.scrollLeft / max) * (free - w)}px)`;
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // The panel is the container query's subject, so watching it catches the
    // grid↔strip flip and rotation; watching the strip catches content growth.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => { el.removeEventListener("scroll", measure); ro.disconnect(); };
    // `deps` re-measures when the group count changes — the board's data lands
    // after first paint, so the first measurement is of an empty strip.
  }, [measure, targetRef, deps]);

  // The track only exists once scrollable flips true, so it has to be sized
  // after that render rather than during the measure that caused it.
  useLayoutEffect(() => { measure(); }, [scrollable, measure]);

  const onDown = (e) => {
    const el = targetRef.current, track = trackRef.current, thumb = thumbRef.current;
    if (!el || !track || !thumb) return;
    e.preventDefault();
    thumb.setPointerCapture(e.pointerId);
    // scroll-snap-type:x proximity treats every scrollLeft write during a drag
    // as a re-snap candidate, which makes the pill stick and jump. Off for the
    // duration, restored on release.
    el.style.scrollSnapType = "none";
    dragRef.current = { x: e.clientX, left: el.scrollLeft, free: track.clientWidth - thumb.offsetWidth };
  };
  const onMove = (e) => {
    const d = dragRef.current, el = targetRef.current;
    if (!d || !el || d.free <= 0) return;
    const max = el.scrollWidth - el.clientWidth;
    el.scrollLeft = d.left + ((e.clientX - d.x) / d.free) * max;
  };
  const onUp = (e) => {
    const el = targetRef.current;
    if (dragRef.current && el) el.style.scrollSnapType = "";
    dragRef.current = null;
    thumbRef.current?.releasePointerCapture?.(e.pointerId);
  };

  if (!scrollable) return null;
  // aria-hidden rather than a half-built role="scrollbar": the metric rows
  // inside each group are already tabbable, so keyboard users scroll the strip
  // by tabbing and the browser scrolls them into view.
  return (
    <div className="cv-swipe-track" ref={trackRef} aria-hidden="true">
      <div className="cv-swipe-thumb" ref={thumbRef}
        onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={onUp} onPointerCancel={onUp} />
    </div>
  );
}

export function LiveBedDashboard({ refreshKey = 0, userName = "Admin", currentUsername = null, scope = "admin", hideUnitFilter = false }) {
  const scoped = SCOPED_FETCHERS[scope] ?? null; // null = admin/hospital-wide
  // Whether this mount shows the whole hospital. Admin (no scoped entry) and PRE
  // both do; Nurse/Consultant don't. Sections that would leak hospital totals to
  // a ward-scoped user gate on this rather than on `scoped`.
  const hospitalWide = !scoped || scoped.hospitalWide === true;
  const topBarSlot = useTopBarSlot();
  const [liveData, setLiveData] = useState(null);
  const [snaps, setSnaps] = useState(null);
  const [lastSync, setLastSync] = useState(new Date());
  const [viewBy, setViewBy] = useState("TOTAL");
  const [search, setSearch] = useState("");
  const [searchBy, setSearchBy] = useState("ward");
  const compact = scope === "consultant";
  const [groupBy, setGroupBy] = useState(compact ? "room_type" : "none");
  const [snapToast, setSnapToast] = useState("");
  const [payerTypes, setPayerTypes] = useState(null); // active payer types, sorted — drives dynamic payer cards
  const [adminCards, setAdminCards] = useState(null); // Hospital Snapshot / Occupancy / Transaction boards
  const [adminHistory, setAdminHistory] = useState(null); // hourly history for the flat-line cards' sparklines
  const [consultantData, setConsultantData] = useState(null); // { payerTypes, consultants }
  const snapshotRef = useRef(null);
  // Occupancy Board strip — read by SwipeThumb to size and drive its indicator.
  const occStripRef = useRef(null);

  // ── Adaptive header: sidebar state + greeting visibility observer
  const sidebarState = useSidebarState();
  const [heroGone, setHeroGone] = useState(false);
  const heroObsRef = useRef(null);
  const greetCallbackRef = useCallback((el) => {
    if (heroObsRef.current) { heroObsRef.current.disconnect(); heroObsRef.current = null; }
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      const gone = !entry.isIntersecting;
      setHeroGone(gone);
      document.body.classList.toggle("hero-gone", gone);
    }, { threshold: 0, rootMargin: "-60px 0px 0px 0px" });
    obs.observe(el);
    heroObsRef.current = obs;
  }, []);
  // Clean up body class if this component unmounts
  useEffect(() => () => { document.body.classList.remove("hero-gone"); heroObsRef.current?.disconnect(); }, []);

  // ── Sticky filter bar: only tracks whether the card is currently "stuck"
  // at the top so we can apply the glass visual. Movement is handled entirely
  //
  // by CSS position:sticky — no JS animation needed.
  const [filterStuck, setFilterStuck] = useState(false);
  const filterSentinelRef = useRef(null);

  // ── "Tap a card → open the Bed Explorer" — BedExplorerModal does its own
  // fetching/filtering, so this just records which card was clicked.
  const [bedExplorer, setBedExplorer] = useState(null); // null | { label, color, payer? }
  const openBedExplorer = useCallback((label, color, payer) => {
    setBedExplorer({ label, color, payer });
  }, []);

  // Also must be before the early return below — null-safe so it works before
  // liveData has loaded. Mirrors the activeUnit/unitOptions computed again
  // (identically) further down once liveData is guaranteed non-null; kept
  // separate only so these can be used unconditionally this early (both by
  // the fetch effect further down and by openDischargeList right below).
  const earlyUnitOptions = ["TOTAL", ...Array.from(
    new Set((liveData?.wards || []).filter((w) => !w.is_discharge_lounge).map((w) => dashboardUnitKey(w.unit_type)).filter(Boolean))
  ).sort()];
  const earlyActiveUnit = earlyUnitOptions.includes(viewBy) ? viewBy : "TOTAL";

  // ── Transaction Board cards → Discharge List (admission-based, not a bed
  // status filter, so it's a separate small modal from BedExplorerModal).
  const [dischargeList, setDischargeList] = useState(null); // null | { step, label, hospitalWide, unit }
  // Must use earlyActiveUnit, not activeUnit — this hook (like every hook)
  // has to run before the `if (!liveData) return` guard further down, but
  // `activeUnit` is only declared after that guard (it needs liveData to be
  // non-null). earlyActiveUnit is the same value, computed null-safely for
  // exactly this reason (see its own comment above). earlyActiveUnit IS a
  // required dep here: without it, switching the Unit toolbar filter (which
  // doesn't change `hospitalWide`) would keep reusing a stale, memoized
  // closure from whichever unit was active when this callback last changed.
  const openDischargeList = useCallback((step, label) => {
    setDischargeList({ step, label, hospitalWide, unit: earlyActiveUnit });
  }, [hospitalWide, earlyActiveUnit]);

  // ── KPI card layout customization — frontend/localStorage only, never touches
  // the backend. Locked by default on every load; an admin can unlock, drag
  // cards into a preferred order, then Save (persists) or Reset (clears it).
  const KPI_LAYOUT_KEY = scoped ? `dashboard_layout_${scope}` : "dashboard_layout_admin";
  const [layoutLocked, setLayoutLocked] = useState(true);
  const [kpiOrder, setKpiOrder] = useState(null); // string[] of labels, or null = default order
  const [dragKey, setDragKey] = useState(null);
  const [confirm, confirmDialog] = useConfirm();
  const kpiGridRef = useRef(null);
  const prevRectsRef = useRef(new Map());
  const draggingRef = useRef(false);

  // Sentinel callback: fires when the 1px div above the filter card enters/leaves
  // the viewport. Only used to toggle the glass visual — position:sticky in CSS
  // handles all the actual movement natively without any JS.
  const filterSentinelObsRef = useRef(null);
  const sentinelCallbackRef = useCallback((el) => {
    if (filterSentinelObsRef.current) { filterSentinelObsRef.current.disconnect(); filterSentinelObsRef.current = null; }
    filterSentinelRef.current = el;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setFilterStuck(!entry.isIntersecting),
      { threshold: 0, rootMargin: "-60px 0px 0px 0px" }
    );
    obs.observe(el);
    filterSentinelObsRef.current = obs;
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KPI_LAYOUT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setKpiOrder(parsed);
      }
    } catch { /* corrupt/old value — fall back to default order */ }
  }, []);

  const reorder = (fromKey, toKey, baseOrder) => {
    const arr = [...baseOrder];
    const fromIdx = arr.indexOf(fromKey);
    const toIdx = arr.indexOf(toKey);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return arr;
    arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, fromKey);
    return arr;
  };

  // Saved order merged against the static default — independent of whether
  // live dashboard data has loaded yet, so every hook below can run
  // unconditionally (this component has an early loading-state return, and
  // hooks must never be skipped on some renders but not others).
  const effectiveOrder = (() => {
    const saved = kpiOrder ?? KPI_DEFAULT_ORDER;
    const known = saved.filter((l) => KPI_DEFAULT_ORDER.includes(l));
    const missing = KPI_DEFAULT_ORDER.filter((l) => !known.includes(l));
    return [...known, ...missing];
  })();

  // Motion tuning — kept here so the whole drag feel can be adjusted in one
  // place. Curves favour a calm, deliberate enterprise feel over snappiness.
  const HOLD_MS = 220;                       // press-and-hold before a drag arms
  const HOLD_SLOP = 10;                        // px of movement that cancels the hold
  const SWAP_THRESH = 0.65;                      // must cross ≥65% into a neighbour before it swaps
  const EASE = "cubic-bezier(.4,0,.2,1)"; // ease-in-out everywhere — calm, predictable
  const LIFT_MS = 300;                       // grab lift-off
  const FLOW_MS = 320;                       // neighbour reflow
  const SETTLE_MS = 300;                       // ghost drop-into-place
  const DAMP_MS = 90;                        // ghost follows cursor with slight inertia/damping

  // The lifted card is a detached "ghost": an outer positioner that follows the
  // cursor via transform-translate (compositor-only, no layout → 60fps) wrapping
  // an inner visual clone that owns the scale/shadow "lift". The card's real
  // slot stays in the grid as a dashed drop-zone placeholder that glides (via
  // the FLIP effect below) to wherever the card will land.
  const ghostRef = useRef(null);  // positioner
  const ghostInnerRef = useRef(null);  // visual clone
  const grabOffsetRef = useRef({ x: 0, y: 0 });
  const pressTimerRef = useRef(null);
  const settleTimerRef = useRef(null);

  const beginDrag = (label, startX, startY) => {
    if (layoutLocked) return;
    if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
    const grid = kpiGridRef.current;
    const cardEl = grid && grid.querySelector(`[data-kpi-key="${label}"]`);
    if (!cardEl) return;
    cardEl.style.transform = "";           // drop any press-feedback scale before cloning

    const rect = cardEl.getBoundingClientRect();
    grabOffsetRef.current = { x: startX - rect.left, y: startY - rect.top };

    const positioner = document.createElement("div");
    positioner.style.cssText =
      `position:fixed;left:0;top:0;z-index:999;pointer-events:none;` +
      // A short transform transition makes the ghost trail the cursor with a
      // slight, premium inertia rather than locking to it 1:1.
      `transition:transform ${DAMP_MS}ms ${EASE};` +
      `transform:translate(${rect.left}px,${rect.top}px);`;
    const inner = cardEl.cloneNode(true);
    inner.classList.add("kc-ghost");
    inner.classList.remove("kc-draggable");
    inner.style.width = rect.width + "px";
    inner.style.height = rect.height + "px";
    inner.style.margin = "0";
    inner.style.transform = "scale(1)";
    inner.style.transition = `transform ${LIFT_MS}ms ${EASE}, box-shadow ${LIFT_MS}ms ${EASE}`;
    positioner.appendChild(inner);
    document.body.appendChild(positioner);
    ghostRef.current = positioner;
    ghostInnerRef.current = inner;
    // Next frame: animate the "lift" so the card visibly rises off the grid.
    requestAnimationFrame(() => { inner.style.transform = "scale(1.03)"; });

    draggingRef.current = true;
    dragStateRef.current.dragKey = label;
    dragStateRef.current.effectiveOrder = effectiveOrder;
    setDragKey(label);
  };

  // Press-and-hold gate: a drag only arms after the pointer is held still for
  // HOLD_MS. A quick click, or a press that immediately moves (a scroll/slip),
  // cancels it — this is what prevents accidental card movement.
  const pressStart = (label, e) => {
    if (layoutLocked) return;
    const startX = e.clientX, startY = e.clientY;
    const grid = kpiGridRef.current;
    const cardEl = grid && grid.querySelector(`[data-kpi-key="${label}"]`);
    if (cardEl) {
      cardEl.style.transition = "transform 140ms ease";
      cardEl.style.transform = "scale(.97)";   // subtle "pressed" feedback while holding
    }
    const cleanup = () => {
      if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
      if (cardEl) cardEl.style.transform = "";
      window.removeEventListener("pointermove", onPressMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
    };
    const onPressMove = (ev) => {
      if (Math.abs(ev.clientX - startX) > HOLD_SLOP || Math.abs(ev.clientY - startY) > HOLD_SLOP) cleanup();
    };
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      window.removeEventListener("pointermove", onPressMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      beginDrag(label, startX, startY);
    }, HOLD_MS);
    window.addEventListener("pointermove", onPressMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  };

  const moveByKeyboard = (label, dir) => {
    if (layoutLocked) return;
    const arr = [...effectiveOrder];
    const idx = arr.indexOf(label);
    const target = idx + dir;
    if (idx === -1 || target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    setKpiOrder(arr);
  };

  // Always-fresh snapshot for the mount-time window listeners below, so they
  // never act on stale closures from whatever render they happened to mount in.
  // Also written to synchronously during onMove so rapid pointermove events
  // within a single render cycle never reorder off a stale array.
  const dragStateRef = useRef({ dragKey: null, effectiveOrder: [] });
  useEffect(() => { dragStateRef.current = { dragKey, effectiveOrder }; });

  // Track the drag via elementFromPoint rather than per-card pointerenter —
  // pointerenter is unreliable for touch once a pointer is mid-drag, while
  // elementFromPoint works identically for mouse, touch, and pen.
  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return;
      const { dragKey: dk, effectiveOrder: eo } = dragStateRef.current;
      if (dk == null) return;

      const ghost = ghostRef.current;
      if (ghost) {
        const { x, y } = grabOffsetRef.current;
        ghost.style.transform = `translate(${e.clientX - x}px, ${e.clientY - y}px)`;
      }

      // elementFromPoint would otherwise resolve to the ghost itself (it's the
      // topmost element under the cursor) — briefly hide it to see what's below.
      if (ghost) ghost.style.visibility = "hidden";
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (ghost) ghost.style.visibility = "visible";
      const overEl = el && el.closest && el.closest("[data-kpi-key]");
      if (!overEl) return;
      const overLabel = overEl.getAttribute("data-kpi-key");
      if (overLabel === dk) return;

      // Swap threshold — the cure for twitchiness. Don't reorder the moment the
      // cursor grazes a neighbour; require it to cross ≥SWAP_THRESH of the way
      // into that neighbour, measured along the axis that separates it from the
      // dragged slot (horizontal within a row, vertical across rows). Below the
      // threshold the layout stays put, so cards don't rearrange "too early".
      const grid = kpiGridRef.current;
      const placeholder = grid && grid.querySelector(`[data-kpi-key="${dk}"]`);
      if (!placeholder) return;
      const o = overEl.getBoundingClientRect();
      const p = placeholder.getBoundingClientRect();
      const forward = eo.indexOf(overLabel) > eo.indexOf(dk);
      const sameRow = Math.abs(o.top - p.top) < o.height * 0.5;
      const frac = sameRow
        ? (e.clientX - o.left) / o.width
        : (e.clientY - o.top) / o.height;
      const crossed = forward ? frac >= SWAP_THRESH : frac <= (1 - SWAP_THRESH);
      if (!crossed) return;

      const next = reorder(dk, overLabel, eo);
      dragStateRef.current.effectiveOrder = next;
      setKpiOrder(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const dk = dragStateRef.current.dragKey;
      const grid = kpiGridRef.current;
      const cardEl = dk != null && grid && grid.querySelector(`[data-kpi-key="${dk}"]`);
      const positioner = ghostRef.current;
      const inner = ghostInnerRef.current;

      // Settle: glide the ghost into the placeholder's final slot, lower it back
      // to rest scale, then swap the real card back in — the "snap into place".
      if (positioner && inner && cardEl) {
        const finalRect = cardEl.getBoundingClientRect();
        positioner.style.transition = `transform ${SETTLE_MS}ms ${EASE}`;
        positioner.style.transform = `translate(${finalRect.left}px,${finalRect.top}px)`;
        inner.style.transition = `transform ${SETTLE_MS}ms ${EASE}, box-shadow ${SETTLE_MS}ms ${EASE}`;
        inner.style.transform = "scale(1)";
        inner.style.boxShadow = "0 10px 24px rgba(3,8,20,.18)";
        settleTimerRef.current = setTimeout(() => {
          settleTimerRef.current = null;
          positioner.remove();
          ghostRef.current = null; ghostInnerRef.current = null;
          dragStateRef.current.dragKey = null;
          setDragKey(null);
        }, SETTLE_MS + 20);
      } else {
        if (positioner) positioner.remove();
        ghostRef.current = null; ghostInnerRef.current = null;
        dragStateRef.current.dragKey = null;
        setDragKey(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  // FLIP animation: whenever the order changes, slide each card (incl. the
  // dashed placeholder) from its old screen position to its new one instead of
  // letting the grid just snap — this is what makes neighbours glide smoothly
  // aside and the drop-zone follow the cursor.
  const orderKey = effectiveOrder.join("|");
  useLayoutEffect(() => {
    const grid = kpiGridRef.current;
    const prevRects = prevRectsRef.current;
    if (grid) {
      const cards = grid.querySelectorAll("[data-kpi-key]");
      cards.forEach((el) => {
        const key = el.getAttribute("data-kpi-key");
        const prev = prevRects.get(key);
        const next = el.getBoundingClientRect();
        if (prev) {
          const dx = prev.left - next.left;
          const dy = prev.top - next.top;
          if (dx || dy) {
            el.style.transition = "none";
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            requestAnimationFrame(() => {
              el.style.transition = `transform ${FLOW_MS}ms ${EASE}`;
              el.style.transform = "";
            });
          }
        }
      });
      const newRects = new Map();
      cards.forEach((el) => newRects.set(el.getAttribute("data-kpi-key"), el.getBoundingClientRect()));
      prevRectsRef.current = newRects;
    }
  }, [orderKey]);

  const load = useCallback(async () => {
    try { setLiveData(await (scoped ? scoped.liveWards() : api.cooLiveWards())); setLastSync(new Date()); } catch { /* keep stale */ }
  }, [scoped]);
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    // Hospital-wide payer/occupancy trend history has no per-block/per-station
    // equivalent captured anywhere — showing it would leak hospital totals, so
    // ward-scoped dashboards just get flat (non-animated) cards instead of
    // skipping the feature outright. Hospital-wide mounts get the real series.
    if (!hospitalWide) { setSnaps([]); return; }
    (scoped ? scoped.snapshots() : api.cooSnapshots())
      .then((r) => setSnaps(r.snapshots || [])).catch(() => setSnaps([]));
  }, [refreshKey, scoped, hospitalWide]);
  useEffect(() => {
    (scoped ? scoped.payerTypes() : api.mgrPayerTypes()).then((r) => setPayerTypes((r.payerTypes || []).filter((p) => p.active)))
      .catch(() => setPayerTypes([]));
  }, [refreshKey, scoped]);

  const showSnapToast = useCallback((m) => { setSnapToast(m); setTimeout(() => setSnapToast(""), 2400); }, []);

  // Must be before any early return — hooks cannot be called conditionally
  // "department" is deliberately excluded here — it only scopes the
  // Consultants table below (see ConsultantsTable's own searchBy handling),
  // not the ward table, since department is a consultant/admission concept,
  // not a ward-level one. Ward rows stay unfiltered in that mode.
  const searchFilter = useCallback((r) => {
    const q = search.trim().toLowerCase();
    if (!q || searchBy === "department") return true;
    if (searchBy === "room_type") return (r.room_type || "").toLowerCase().includes(q);
    if (searchBy === "payer_type") return Object.keys(r.payersLive || {}).some(p => p.toLowerCase().includes(q));
    return r.ward.toLowerCase().includes(q);
  }, [search, searchBy]);

  // Re-fetches whenever the Unit toolbar filter changes — Hospital Snapshot /
  // Occupancy Board / Transaction Board now scope to the same wards as the
  // ward tables and By Payer cards below (see adminDashboard()'s unitType param).
  useEffect(() => {
    (scoped ? scoped.adminDashboard(earlyActiveUnit) : api.cooAdminDashboard(earlyActiveUnit)).then(setAdminCards).catch(() => { });
  }, [refreshKey, earlyActiveUnit, scoped]);
  // Sparkline history is now captured per-unit too (see snapshotAdminDashboard()),
  // so it moves with the same filter instead of always showing the hospital-wide trend.
  // No per-block/per-station history exists (see the snaps effect above) — scoped cards render flat.
  useEffect(() => {
    if (!hospitalWide) { setAdminHistory([]); return; }
    (scoped ? scoped.adminDashboardHistory(earlyActiveUnit) : api.cooAdminDashboardHistory(earlyActiveUnit))
      .then((r) => setAdminHistory(r.snapshots || [])).catch(() => setAdminHistory([]));
  }, [refreshKey, earlyActiveUnit, scoped, hospitalWide]);

  useEffect(() => {
    if (!hospitalWide) return;
    (scoped ? scoped.consultants() : api.cooConsultants()).then(setConsultantData).catch(() => { });
  }, [refreshKey, scoped, hospitalWide]);

  if (!liveData) return (
    <div className="empty" style={{ paddingTop: 80 }}>
      <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
      <div className="dim" style={{ marginTop: 12 }}>Loading…</div>
    </div>
  );

  // All wards from the backend — already deduplicated and includes bed_type
  const allRows = liveData.wards.map((w) => ({
    id: w.id, ward: w.ward, total: w.total || 0, unit_type: w.unit_type || null,
    vacant: w.vacant, reserved: w.reserved, occupied: w.occupied,
    occupied_reserved: w.occupied_reserved,
    bed_type: w.bed_type || "Census", room_type: w.room_type || null,
    block_name: w.block_name || null, floor_name: w.floor_name || null,
    updatedAt: w.updatedAt || null, reviewedAt: w.reviewedAt || null,
    updated_by_role: w.updated_by_role || null,
    updated_by_name: w.updated_by_name || null,
    payersLive: w.payersLive || {},
    departmentsLive: w.departmentsLive || {},
    admissionTypes: w.admissionTypes || {},
    overstayCount: w.overstayCount || 0,
    loungeCount: w.loungeCount || 0,
    is_discharge_lounge: !!w.is_discharge_lounge,
  }));

  // Unit options are derived from the live data, so new unit types appear
  // automatically — no code change needed. "TOTAL" = all. The Discharge Lounge
  // ward is excluded here regardless of whatever unit_type it's been given —
  // it's a shared virtual holding ward, not a real unit, and its patients are
  // already attributed to their origin ward's unit everywhere on this board.
  const unitOptions = ["TOTAL", ...Array.from(
    new Set(allRows.filter((r) => !r.is_discharge_lounge).map((r) => dashboardUnitKey(r.unit_type)).filter(Boolean))
  ).sort()];
  const activeUnit = unitOptions.includes(viewBy) ? viewBy : "TOTAL";
  // The Discharge Lounge ward has no unit_type of its own (it's shared across
  // units — a patient's unit is determined by where they came FROM, same as
  // the backend's origin-scoped lounge counts in bedService.ts), so it would
  // otherwise vanish from `rows` under dashboardUnitKey(null) !== activeUnit
  // whenever a specific unit is selected. Always keep it in scope here.
  const rows = allRows.filter((r) =>
    activeUnit === "TOTAL" || r.is_discharge_lounge || dashboardUnitKey(r.unit_type) === activeUnit);

  // The Discharge Lounge is a virtual holding ward (set up in Setup → Discharge
  // Lounge, outside the floor hierarchy) — it stays in `rows` so the Bed Explorer
  // can still resolve its "In Discharge Lounge" card (wardIdsInScope below is
  // derived from shownRows, which must include it), but every *visible* ward
  // table below excludes it — it's not real Census/Non-Census capacity and
  // shouldn't inflate those grand totals, matching the Hospital Snapshot cards.
  const censusRows = rows.filter((r) => r.bed_type !== "Non-Census" && !r.is_discharge_lounge);
  const nonCensusRows = rows.filter((r) => r.bed_type === "Non-Census" && !r.is_discharge_lounge);
  const wardTableRows = rows.filter((r) => !r.is_discharge_lounge);
  // Physical capacity of the Discharge Lounge ward (virtual holding beds, not
  // real hospital capacity) — summed from the same live ward data as everything
  // else on this dashboard, no extra fetch.
  const loungeTotalBeds = rows.filter((r) => r.is_discharge_lounge).reduce((s, r) => s + (r.total || 0), 0);

  // KPI cards mirror exactly what the tables show: Unit + Search/Room-type filter.
  // With no search and Unit = TOTAL, that's every operational ward — the whole hospital.
  const shownRows = rows.filter(searchFilter);
  const censusShown = censusRows.filter(searchFilter);
  const nonCensusShown = nonCensusRows.filter(searchFilter);
  const sum = (fn) => shownRows.reduce((a, r) => a + (fn(r) || 0), 0);
  const sumOf = (set, fn) => set.reduce((a, r) => a + (fn(r) || 0), 0);
  const operational = sum((r) => r.total);
  const census = sum((r) => (r.bed_type !== "Non-Census" ? r.total : 0));
  const nonCensus = operational - census;
  const v = sum((r) => r.vacant), rr = sum((r) => r.reserved), o = sum((r) => r.occupied), or_ = sum((r) => r.occupied_reserved);
  const totalOcc = o + or_, totalVac = v + rr;
  const censusOcc = sumOf(censusShown, (r) => r.occupied) + sumOf(censusShown, (r) => r.occupied_reserved);
  const nonCensusOcc = sumOf(nonCensusShown, (r) => r.occupied) + sumOf(nonCensusShown, (r) => r.occupied_reserved);
  // Non-operational beds live outside `rows` (operational-only), so that total
  // only makes sense for the unfiltered, org-wide view.
  const showingAll = !search.trim() && activeUnit === "TOTAL";
  const allBeds = showingAll ? (liveData.allBeds || operational) : operational;
  const nonOp = showingAll ? (liveData.nonOpBeds || 0) : 0;
  const base = operational || 1;
  const pct = (n) => Math.round((n / base) * 100) + "%";

  // Sparkline series from hourly org-wide snapshots — decorative trend per card;
  // these aren't filterable by unit/search since snapshots store only org totals.
  const S = {
    total: (snaps || []).map((s) => s.total || 0),
    vacant: (snaps || []).map((s) => s.vacant || 0),
    reserved: (snaps || []).map((s) => s.reserved || 0),
    occupied: (snaps || []).map((s) => s.occupied || 0),
  };
  // Grouped Beds → Occupied → Vacant so the grid reads top-to-bottom as one
  // story instead of interleaving the three categories. Color families match
  // the group (blue=beds, red/pink=occupied, green=vacant) so a glance at
  // color alone tells you which bucket a card belongs to.
  const KPIS = [
    // Total Beds — the "whole house" reference point, always first
    { label: "Total Beds", val: allBeds, sub: `${nonOp} non-operational`, color: "#2f64ff", icon: icons.bed, series: S.total },

    // All Occupied-type cards together
    { label: "Total Occupied", val: totalOcc, sub: pct(totalOcc), color: "#dc2626", icon: icons.chart, series: S.occupied },
    { label: "Census Occupied", val: censusOcc, sub: pct(censusOcc), color: "#ea580c", icon: icons.users, series: S.occupied },
    { label: "Non-Census Occupied", val: nonCensusOcc, sub: pct(nonCensusOcc), color: "#f97316", icon: icons.user, series: S.occupied },
    { label: "On Bed", val: o, sub: pct(o), color: "#ff3b8a", icon: icons.bed, series: S.occupied },

    // All Vacant-type cards together
    { label: "Total Vacant", val: totalVac, sub: pct(totalVac), color: "#16a34a", icon: icons.bed, series: S.vacant },
    { label: "Vacant", val: v, sub: pct(v), color: "#15803d", icon: icons.check, series: S.vacant },

    // Remaining bed breakdowns — these are inventory counts, not occupancy
    // state, so a "%" here is either a tautology (Operational Beds is always
    // 100% of itself) or just restates a split better read as a plain count.
    { label: "Operational Beds", val: operational, sub: null, color: "#1d4ed8", icon: icons.refresh, series: S.total },
    { label: "Census Beds", val: census, sub: null, color: "#1e3a8a", icon: icons.users, series: S.total },
    { label: "Non-Census Beds", val: nonCensus, sub: null, color: "#0c2a6b", icon: icons.user, series: S.reserved },

    // RES variants last
    { label: "OCC + RES", val: or_, sub: pct(or_), color: "#be123c", icon: icons.plus, series: S.reserved },
    { label: "VAC + RES", val: rr, sub: pct(rr), color: "#0ea5b7", icon: icons.clock, series: S.reserved },
  ];

  // Ward ids currently in scope (Unit + Search) — the Bed Explorer only looks
  // up beds within this set, so its counts always match the dashboard's filter.
  const wardIdsInScope = shownRows.map((r) => r.id);

  // Per-ward metadata for the Bed Explorer's grouping/floor filter and
  // authoritative ward-level counts (so its accordion headers stay correct
  // even on the 2 wards whose bed_details rows don't quite add up — see
  // BedExplorerModal's "incomplete" note).
  const wardMeta = new Map(allRows.map((r) => [r.id, {
    ward: r.ward, floor_name: r.floor_name, block_name: r.block_name,
    unit_type: r.unit_type, room_type: r.room_type, bed_type: r.bed_type,
    total: r.total, vacant: r.vacant, occupied: r.occupied,
    reserved: r.reserved, occupied_reserved: r.occupied_reserved,
  }]));

  // One card per active payer type (dynamic — auto-adjusts if Setup → Payer
  // Types changes). Value = occ.payerType from adminCards (GET /coo/admin-dashboard),
  // scoped server-side to the active Unit filter exactly like Patient Type —
  // Discharge Lounge patients only count toward a unit if that's where they
  // actually came from (origin-scoped), not wherever the Lounge ward itself
  // happens to sit. Previously this summed `shownRows[].payersLive` directly,
  // which always included 100% of the Discharge Lounge ward's payer mix
  // regardless of the active unit (the ward stays in `rows` unconditionally,
  // see the `r.is_discharge_lounge ||` filter above) — inflating "By Payer"
  // above the correctly-scoped "Patient Type" total whenever a unit was
  // selected. Deliberately still includes lounge patients (like Total
  // Patients does) — just origin-scoped now instead of unconditionally.
  const payerOccBase = totalOcc || 1;
  const payerTypeCards = (payerTypes || []).map((pt, i) => {
    const val = (adminCards?.occupancy?.payerType || {})[pt.name] || 0;
    return {
      label: pt.name,
      val,
      sub: null /* `${Math.round((val / payerOccBase) * 100)}% of occupied` */,
      color: PAYER_PALETTE[i % PAYER_PALETTE.length],
      icon: payerIcon(pt.name),
      series: (snaps || []).map((s) => (s.payers || {})[pt.name] || 0),
      explorerKey: pt.name,
      payerFilter: pt.name,
    };
  });
  // Total = sum of the payer cards actually shown below it, not an
  // independently-scoped occupancy figure — guarantees it can never disagree
  // with its own sub-breakdown (some occupied beds have no payer_type set
  // yet, so this can legitimately be less than total occupied).
  const payerCards = payerTypeCards.length === 0 ? [] : [
    { label: "Total", val: payerTypeCards.reduce((a, c) => a + c.val, 0), sub: null, color: "#8b5cf6", icon: icons.chart, series: [], explorerKey: "admin:By Payer Total" },
    ...payerTypeCards,
  ];

  // Apply the shared order onto the live KPI data — defensive against the
  // card set itself changing (renamed/added/removed) since the layout was
  // last saved: unknown saved labels are dropped, new cards are appended at
  // the end, so a stale localStorage entry (or a future edit to KPIS that
  // forgets to update KPI_DEFAULT_ORDER) can never crash this.
  const kpiByLabel = new Map(KPIS.map((k) => [k.label, k]));
  const orderedLabels = [
    ...effectiveOrder.filter((l) => kpiByLabel.has(l)),
    ...KPIS.map((k) => k.label).filter((l) => !effectiveOrder.includes(l)),
  ];
  const orderedKpis = orderedLabels.map((l) => kpiByLabel.get(l));

  // New top-of-dashboard cards — same shape as KPIS above (label/val/sub/color/icon),
  // just fed by adminCards (GET /coo/admin-dashboard) instead of liveData/snaps.
  // Empty until adminCards loads; each grid below simply renders nothing until then.
  const snap = adminCards?.snapshot;
  const occ = adminCards?.occupancy;
  const txn = adminCards?.transaction;

  // Real sparkline history exists only for four org-wide numbers, forever
  // (occupancy_snapshots has only ever stored total/vacant/reserved/occupied —
  // same limitation the old KPI cards had, which is why Census/Non-Census Beds
  // reused S.total/S.reserved as an approximation rather than their own series).
  // Cards below with no S.* equivalent (Discharge Lounge, Daycare, and every
  // Transaction Board metric) have never been tracked over time — those are
  // brand-new counts as of today. Rather than leaving them blank, they draw a
  // flat reference line at today's value (honest — no fake trend implied, but
  // every card still visually has a graph). Real trend lines need hourly
  // tracking added for these fields, same as occupancy_snapshots does today.
  const sparkSeries = (series, val) => (series && series.length >= 2) ? series : [Number(val) || 0, Number(val) || 0];

  // Real hourly history for the fields occupancy_snapshots never tracked —
  // GET /coo/admin-dashboard-history, captured on the same hourly tick.
  const H = {
    loungePatients: (adminHistory || []).map((s) => s.lounge_patients || 0),
    censusDaycare: (adminHistory || []).map((s) => s.census_daycare || 0),
    nonCensusDaycare: (adminHistory || []).map((s) => s.non_census_daycare || 0),
    newAdmissionsToday: (adminHistory || []).map((s) => s.new_admissions_today || 0),
    completedToday: (adminHistory || []).map((s) => s.completed_today || 0),
    plannedTotal: (adminHistory || []).map((s) => s.planned_total || 0),
    initiated: (adminHistory || []).map((s) => s.initiated || 0),
    // No snapshot column for these two yet — flat until history starts being
    // captured; current-value cards still show the live count either way.
    pending: (adminHistory || []).map((s) => s.pending || 0),
    cancelled: (adminHistory || []).map((s) => s.cancelled || 0),
    drugReturnPending: (adminHistory || []).map((s) => s.drug_return_pending || 0),
    pharmacyPending: (adminHistory || []).map((s) => s.pharmacy_pending || 0),
    procedurePending: (adminHistory || []).map((s) => s.procedure_pending || 0),
    billingStarted: (adminHistory || []).map((s) => s.billing_started || 0),
    auditPending: (adminHistory || []).map((s) => s.audit_pending || 0),
    billReady: (adminHistory || []).map((s) => s.bill_ready || 0),
    paymentPending: (adminHistory || []).map((s) => s.payment_pending || 0),
    systemCheckoutPending: (adminHistory || []).map((s) => s.system_checkout_pending || 0),
    physicalCheckoutPending: (adminHistory || []).map((s) => s.physical_checkout_pending || 0),
  };

  // Discharge Lounge tile is Admin(COO)-only. loungeTotalBeds comes from the
  // live ward list (not adminDashboard()), and that list can't be trimmed
  // server-side without also breaking bed entry / lounge-transfer screens
  // that read the same wards — so this one stays a display-only gate here,
  // unlike totalPatientsCard/loungeCards below which the backend omits outright.
  const snapshotCards = !snap ? [] : [
    { label: "Total Beds", val: snap.totalBeds, sub: null, color: "#2f64ff", icon: icons.bed, series: S.total, explorerKey: "admin:Total Beds" },
    { label: "Operational Beds", val: snap.operationalBeds, sub: null, color: "#1d4ed8", icon: icons.refresh, series: S.total, explorerKey: "admin:Operational Beds" },
    { label: "Census Beds", val: snap.censusBeds, sub: null, color: "#1e3a8a", icon: icons.users, series: S.total, explorerKey: "admin:Census Beds" },
    { label: "Non-Census Beds", val: snap.nonCensusBeds, sub: null, color: "#0c2a6b", icon: icons.user, series: S.reserved, explorerKey: "admin:Non-Census Beds" },
    ...(scope === "admin" ? [
      { label: "Discharge Lounge", val: loungeTotalBeds, sub: null /* "Virtual Beds" */, color: "#f59e0b", icon: icons.exchange, series: H.loungePatients, explorerKey: "admin:In Discharge Lounge" },
    ] : []),
  ];

  // Occupancy Board — laid out exactly as the CEO's wireframe: one standalone
  // "Total Patients" card, then five sub-groups (Census Occupancy / Non Census
  // Occupancy / Discharge Lounge / Vacant Beds / Patient Type).
  // occ.totalPatients is Admin(COO)-only — the backend omits the field
  // entirely for every other role (see adminDashboard()'s includeLoungeSummary
  // in bedService.ts), so this naturally resolves to null for them.
  const totalPatientsCard = !occ || occ.totalPatients == null ? null :
    { label: "Total Patients", val: occ.totalPatients, sub: "[On bed + Reserved + Overstay + Discharge lounge]", color: "#dc2626", icon: icons.chart, series: S.occupied, explorerKey: "admin:Total Patients" };
  const totalOccupancyCard = !occ ? null :
    { label: "Total Occupancy", val: occ.totalOccupancy, sub: "[On bed + Overstay + Reserved]", color: "#0d9488", icon: icons.bed, series: S.occupied, explorerKey: "admin:Total Occupancy" };

  const censusOccCards = !occ ? [] : [
    { label: "Total", val: occ.census.totalOcc, sub: null, color: "#ea580c", icon: icons.chart, series: S.occupied, explorerKey: "admin:Total Occ Census" },
    { label: "On Bed", val: occ.census.onBed, sub: null, color: "#db2777", icon: icons.bed, series: [], explorerKey: "admin:Census On Bed" },
    { label: "Reserved", val: occ.census.res, sub: null, color: "#be123c", icon: icons.bookmark, series: [], explorerKey: "admin:Census Res" },
    { label: "Overstay", val: occ.census.overstay, sub: null, color: "#f59e0b", icon: icons.clock, series: [], explorerKey: "admin:Census Overstay" },
  ];
  const nonCensusOccCards = !occ ? [] : [
    { label: "Total", val: occ.nonCensus.totalOcc, sub: null, color: "#f97316", icon: icons.chart, series: S.occupied, explorerKey: "admin:Total Occ Non-Census" },
    { label: "On Bed", val: occ.nonCensus.onBed, sub: null, color: "#db2777", icon: icons.bed, series: [], explorerKey: "admin:Non-Census On Bed" },
    { label: "Reserved", val: occ.nonCensus.res, sub: null, color: "#be123c", icon: icons.bookmark, series: [], explorerKey: "admin:Non-Census Res" },
    { label: "Overstay", val: occ.nonCensus.overstay, sub: null, color: "#f59e0b", icon: icons.clock, series: [], explorerKey: "admin:Non-Census Overstay" },
  ];
  // occ.lounge is Admin(COO)-only — omitted server-side for every other role,
  // same as occ.totalPatients above, so this group naturally disappears for
  // them (the render loop skips any group whose cards array is empty).
  const loungeCards = !occ || !occ.lounge ? [] : [
    { label: "Total", val: occ.lounge.total, sub: null, color: "#f59e0b", icon: icons.exchange, series: H.loungePatients, explorerKey: "admin:In Discharge Lounge" },
    // "Census"/"Non Census" = origin bed type (where the patient came FROM).
    // Lounge beds have no Census/Non-Census identity of their own, so the
    // explorer can't filter by origin — clicking opens the full lounge list.
    { label: "Census", val: occ.lounge.census, sub: null, color: "#0ea5b7", icon: icons.stethoscope, series: [], explorerKey: "admin:In Discharge Lounge" },
    { label: "Non Census", val: occ.lounge.nonCensus, sub: null, color: "#0d9488", icon: icons.stethoscope, series: [], explorerKey: "admin:In Discharge Lounge" },
  ];
  const vacantBedsCards = !occ ? [] : [
    { label: "Total", val: occ.vacant.total, sub: null, color: "#16a34a", icon: icons.bed, series: S.vacant, explorerKey: "admin:Vacant" },
    { label: "Census", val: occ.vacant.census, sub: null, color: "#15803d", icon: icons.bed, series: [], explorerKey: "admin:Vacant Census" },
    { label: "Census [Res]", val: occ.vacant.cRes, sub: null, color: "#0ea5b7", icon: icons.bookmark, series: [], explorerKey: "admin:Vacant Census Res" },
    { label: "Non Census", val: occ.vacant.nonCensus, sub: null, color: "#0d9488", icon: icons.bed, series: [], explorerKey: "admin:Vacant Non-Census" },
    { label: "Non Census [Res]", val: occ.vacant.ncRes, sub: null, color: "#0891b2", icon: icons.bookmark, series: [], explorerKey: "admin:Vacant Non-Census Res" },
  ];
  // Total = sum of its own IPD/Day Care/OPD sub-items, same reasoning as the
  // Discharge Lounge and By Payer totals — never an independently-scoped figure.
  const patientTypeCards = !occ ? [] : [
    { label: "Total", val: occ.patientType.ipd + occ.patientType.dayCare + occ.patientType.opd, sub: null, color: "#1e40af", icon: icons.chart, series: [], explorerKey: "admin:Patient Type Total" },
    { label: "IPD", val: occ.patientType.ipd, sub: null, color: "#2563eb", icon: icons.user, series: H.censusDaycare, explorerKey: "admin:Patient Type IPD" },
    { label: "Day Care", val: occ.patientType.dayCare, sub: null, color: "#0ea5b7", icon: icons.stethoscope, series: H.nonCensusDaycare, explorerKey: "admin:Patient Type Daycare" },
    { label: "OPD", val: occ.patientType.opd, sub: null, color: "#8b5cf6", icon: icons.users, series: [], explorerKey: "admin:Patient Type OPD" },
  ];

  // Occupancy Board sub-groups, already filtered to what actually renders.
  // Discharge Lounge drops out for every non-admin scope (see loungeCards) and
  // By Payer drops out when no payer types are configured — so the grid's
  // column count is driven off this length rather than hardcoded at 6, which
  // used to leave an empty column on the right for non-admin roles.
  // Must stay below every *Cards declaration it reads — they're `const`, so
  // hoisting this above them is a TDZ ReferenceError, not an undefined.
  const occGroups = [
    { title: "Census Occupancy", cards: censusOccCards, accent: "#ea580c" },
    { title: "Non Census Occupancy", cards: nonCensusOccCards, accent: "#f97316" },
    { title: "Discharge Lounge", cards: loungeCards, accent: "#f59e0b" },
    { title: "Vacant Beds", cards: vacantBedsCards, accent: "#16a34a" },
    { title: "Patient Type", cards: patientTypeCards, accent: "#2563eb" },
    { title: "By Payer", cards: payerCards, accent: "#8b5cf6" },
  ].filter((g) => g.cards.length > 0);

  // step = key passed to openDischargeList — cards without one (New Admissions
  const transactionCards = !txn ? [] : [
    { label: "Total Admissions", val: txn.newAdmissionsToday, color: "#16a34a", icon: icons.A, series: H.newAdmissionsToday, step: "ADMITTED_TODAY" },
    { label: "Total Discharged", val: txn.completedToday, color: "#15803d", icon: icons.B, series: H.completedToday, step: "COMPLETED_TODAY" },
    { label: "Current Overstay", val: txn.awaitingPatientLeave, color: "#0891b2", icon: icons.C, series: [], step: "AWAITING_PATIENT_LEAVE" },

    { label: "Current Discharge Lounge", val: txn.inDischargeLounge, color: "#d97706", icon: icons.D, series: [], step: "IN_DISCHARGE_LOUNGE" },

    { label: "Total Discharges Pending", val: txn.initiated + txn.pending + txn.plannedTotal, color: "#6366f1", icon: icons.E, step: "ALL_PENDING" },

    // ── Planned — sub-count shows how many are still pending initiation ─────
    {
      label: "Total Planned Discharges", val: txn.plannedTotal, color: "#3b82f6", icon: icons.F, series: H.plannedTotal,
      step: "PLANNED", subVal: null, subLabel: null
    },
    { label: "Total Unplanned Discharges", val: txn.unplannedToday, color: "#f59e0b", icon: icons.G, series: [], step: "UNPLANNED_TODAY" },

    //{ label: "Total Discharges Initiated", val: txn.pending, color: "#0891b2", icon: icons.refresh, series: H.pending, step: "PENDING_INPROGRESS" },
    // ── Active today — sub-count shows unplanned portion ────────────────────
    {
      label: "Total Discharges Initiated", val: txn.initiatedToday, color: "#2563eb", icon: icons.H, series: H.initiated,
      step: "INITIATED_TODAY", subVal: null, subLabel: null
    },


    // ── Steps ───────────────────────────────────────────────────────────────
    { label: "Total DR Completed", val: txn.drugReturnCompleted, color: "#f97316", icon: icons.I, series: H.drugReturnPending, step: "DRUG_RETURN_DONE" },
    { label: "Total PhC Completed", val: txn.pharmacyCompleted, color: "#f59e0b", icon: icons.J, series: H.pharmacyPending, step: "PHARMACY_DONE" },
    { label: "Total PRC Completed", val: txn.procedureCompleted, color: "#ec4899", icon: icons.K, series: H.procedurePending, step: "PROCEDURE_DONE" },
    { label: "Total Bill Initiated", val: txn.billingStartedCompleted, color: "#8b5cf6", icon: icons.L, series: H.billingStarted, step: "BILLING_DONE" },
    { label: "Total BA Completed", val: txn.auditCompleted, color: "#6366f1", icon: icons.M, series: H.auditPending, step: "AUDIT_DONE" },
    { label: "Total Bills Finalized", val: txn.billReadyCompleted, color: "#14b8a6", icon: icons.N, series: H.billReady, step: "BILL_READY_DONE" },
    { label: "Total Payments Completed", val: txn.paymentCompleted, color: "#dc2626", icon: icons.O, series: H.paymentPending, step: "PAYMENT_DONE" },
    { label: "Total SC Done", val: txn.systemCheckoutCompleted, color: "#0ea5b7", icon: icons.P, series: H.systemCheckoutPending, step: "SC_DONE" },
    { label: "Total PC Done", val: txn.physicalCheckoutCompleted, color: "#be123c", icon: icons.Q, series: H.physicalCheckoutPending, step: "PC_DONE" },
    //{ label: "Patient Left", val: txn.patientLeft, color: "#6b7280", icon: icons.user, series: [], step: "PATIENT_LEFT" },
    // ── Exceptions ──────────────────────────────────────────────────────────
    { label: "Total Cancelled Discharges", val: txn.cancelledToday, color: "#71717a", icon: icons.R, series: H.cancelled, step: "CANCELLED_TODAY" },

    { divider: true, heading: "Ongoing Transactions" },


    // total transactions ongoing


    { label: "Discharges Pending", val: txn.initiated + txn.pending + txn.plannedTotal, color: "#6366f1", icon: icons.A, step: "ALL_PENDING" },

    // ── Planned — sub-count shows how many are still pending initiation ─────
    {
      label: "Pending Planned Discharges", val: txn.scheduledOngoingToday + txn.plannedTotal, color: "#3b82f6", icon: icons.B, series: H.plannedTotal,
      step: "SCHEDULED_TODAY", subVal: null, subLabel: null
    },
    { label: "Pending Unplanned Discharges", val: txn.unplannedPending ?? txn.unplannedToday, color: "#f59e0b", icon: icons.C, series: [], step: "UNPLANNED_TODAY" },

    { label: "Pending Discharge Initiation", val: txn.plannedTotal, color: "#0891b2", icon: icons.D, series: H.plannedTotal, step: "PLANNED" },
    // ── Active today — sub-count shows unplanned portion ────────────────────
    {
      label: "Ongoing Discharges [Initiated]", val: txn.initiated + txn.pending, color: "#2563eb", icon: icons.E, series: H.initiated,
      step: "PENDING_INPROGRESS", subVal: null, subLabel: null
    },


    // ── Steps ───────────────────────────────────────────────────────────────
    { label: "Drug Return Pending", val: txn.drugReturnPending, color: "#f97316", icon: icons.F, series: H.drugReturnPending, step: "DRUG_RETURN" },
    { label: "Pharmacy Clearance Pending", val: txn.pharmacyPending, color: "#f59e0b", icon: icons.G, series: H.pharmacyPending, step: "PHARMACY_CLEARANCE" },
    { label: "OT/Cath Lab Clearance Pending", val: txn.procedurePending, color: "#ec4899", icon: icons.H, series: H.procedurePending, step: "PROCEDURE_RECONCILIATION" },
    { label: "Bill Initiation Pending", val: txn.billingStarted, color: "#8b5cf6", icon: icons.I, series: H.billingStarted, step: "BILLING_STARTED" },
    { label: "Bill Audit Pending", val: txn.auditPending, color: "#6366f1", icon: icons.J, series: H.auditPending, step: "AUDIT" },
    { label: "Bill Finalization Pending", val: txn.billReady, color: "#14b8a6", icon: icons.K, series: H.billReady, step: "BILL_READY" },
    { label: "Bill Payment Pending", val: txn.paymentPending, color: "#dc2626", icon: icons.L, series: H.paymentPending, step: "PAYMENT" },
    { label: "System Checkout Pending", val: txn.systemCheckoutPending, color: "#0ea5b7", icon: icons.M, series: H.systemCheckoutPending, step: "SYSTEM_CHECKOUT" },
    { label: "Physical Checkout Pending", val: txn.physicalCheckoutPending, color: "#be123c", icon: icons.N, series: H.physicalCheckoutPending, step: "PHYSICAL_CHECKOUT" },
    //{ label: "Patient Left", val: txn.patientLeft, color: "#6b7280", icon: icons.user, series: [], step: "PATIENT_LEFT" },
    // ── Exceptions ──────────────────────────────────────────────────────────


  ];

  return (
    <div className="cc-wrap">
      <div className="dash-greet-row" ref={greetCallbackRef}>
        <div className="dash-greet">{greetOf()}, {userName} <span style={{ fontWeight: 400 }}>👋</span></div>
        <div className="dash-greet-sub">Here's your real-time overview of bed status {hospitalWide ? "across all units" : "across your wards"}.</div>
      </div>


      {/* The profile dropdown used to carry Dashboard Layout (lock / save /
          reset) and Snapshot (download / copy / share) sections. Both are gone:
          the layout lock never did anything useful for these users, and the
          menu is now just identity + Logout, which AppShell renders itself.
          layoutLocked therefore stays true for good, so the KPI grid is
          permanently non-draggable — the drag handlers below are inert but
          left in place rather than ripped out with them. */}

      {/* Toolbar — Unit filter + View-by + Search + Group-by + Snapshot. Sits at
          the top so its filter applies to everything below: KPI cards, By Payer
          cards and the ward tables all already derive from this same filter. */}
      {/* Sentinel: sits at the top of the filter card; when it leaves the viewport
          the card goes sticky-fixed above */}
      <div ref={sentinelCallbackRef} style={{ height: 1, marginBottom: -1 }} aria-hidden="true" />
      <div
        id="nav-filters"
        className={`card filter-bar-sticky${heroGone || filterStuck ? " filter-bar--stuck" : ""}`}
        style={{ padding: "8px 10px", marginBottom: 10, scrollMarginTop: 72 }}
      >
        <div className="dash-toolbar">
          {/* Injected when lifted: hamburger on left, theme+avatar on right */}
          {heroGone && (
            <button className="appbar-btn" style={{ flexShrink: 0 }} onClick={sidebarState?.toggle} aria-label="Toggle navigation">
              <Ic d={icons.menu} s={20} />
            </button>
          )}

          {!hideUnitFilter && (
            <>
              <div className="dtg">
                <div className="dtg-head"><span className="dtg-ic"><Ic d={icons.building} s={16} /></span><span className="dtg-label">Unit</span></div>
                {unitOptions.length <= 4 ? (
                  // Same desktop-pill / mobile-select split as "View by" right
                  // below — a row of up to 4 pill buttons doesn't fit a phone
                  // width, so it needs the same fallback that section already has.
                  <>
                    <div className="seg-pill dt-desktop-only">
                      {unitOptions.map((k) => (
                        <button key={k} className={activeUnit === k ? "on" : ""} onClick={() => setViewBy(k)}>{k === "TOTAL" ? "TOTAL" : k}</button>
                      ))}
                    </div>
                    <select className="field dt-mobile-only" value={activeUnit} onChange={(e) => setViewBy(e.target.value)}
                      style={{ fontSize: 12, fontWeight: 600, height: 34, borderRadius: 9, paddingTop: 0, paddingBottom: 0, minWidth: 0, width: "auto" }}>
                      {unitOptions.map((k) => <option key={k} value={k}>{k === "TOTAL" ? "All units" : k}</option>)}
                    </select>
                  </>
                ) : (
                  <select className="field" value={activeUnit} onChange={(e) => setViewBy(e.target.value)}
                    style={{ fontSize: 12, fontWeight: 600, height: 34, borderRadius: 9, paddingTop: 0, paddingBottom: 0, minWidth: 140 }}>
                    {unitOptions.map((k) => <option key={k} value={k}>{k === "TOTAL" ? "All units" : k}</option>)}
                  </select>
                )}
              </div>
              <div className="dt-divider" />
            </>
          )}

          <div className="dtg">
            <div className="dtg-head"><span className="dtg-ic"><Ic d={icons.grid} s={15} /></span><span className="dtg-label">View by</span></div>
            <div className="seg-pill dt-desktop-only">
              {[{ value: "ward", label: "Ward" }, { value: "room_type", label: "Room Type" }].map((opt) => (
                <button key={opt.value} className={searchBy === opt.value ? "on" : ""}
                  onClick={() => { setSearchBy(opt.value); setSearch(""); }}>{opt.label}</button>
              ))}
            </div>
            <select className="field dt-mobile-only" value={searchBy} onChange={(e) => { setSearchBy(e.target.value); setSearch(""); }}
              style={{ fontSize: 12, fontWeight: 600, height: 34, borderRadius: 9, paddingTop: 0, paddingBottom: 0, minWidth: 0, width: "auto" }}>
              <option value="ward">Ward</option>
              <option value="room_type">Room Type</option>
            </select>
          </div>

          <div className="dtg dt-search">
            <span style={{ position: "absolute", left: 11, bottom: 9, color: "var(--ink-3)", pointerEvents: "none", display: "flex" }}>
              <Ic d={icons.search} s={14} />
            </span>
            <input className="field" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={searchBy === "room_type" ? "Search room type…" : searchBy === "payer_type" ? "Search payer type…" : searchBy === "department" ? "Search department…" : "Search ward name…"}
              style={{ paddingLeft: 31, fontSize: 12, height: 34, width: "100%", borderRadius: 9 }} maxLength={60} />
          </div>

          {heroGone && (
            <>
              <div className="dt-desktop-only" style={{ flex: 1 }} />
              <span className="dt-desktop-only"><ThemeToggle /></span>
              <div className="dt-desktop-only filter-lift-avatar">{(userName || "A").charAt(0).toUpperCase()}</div>
            </>
          )}
        </div>
      </div>
      {/* When a filter/search narrows the view, the cards & tables below reflect that subset. */}
      {!showingAll && (
        <div className="row" style={{ gap: 8, margin: "0 0 12px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700,
            background: "var(--primary-bg, #EFF6FF)", color: "var(--primary)",
          }}>
            <Ic d={icons.search} s={12} /> Showing {shownRows.length} of {allRows.length} wards
          </span>
          <span className="dim" style={{ fontSize: 11 }}>Cards &amp; tables below reflect the current filter</span>
        </div>
      )}

      {/* Old gradient KPI grid — replaced at the top by the new Hospital Snapshot /
          Occupancy Board / Transaction Board cards below (same .kc card design).
          Code kept intact and untouched, just not rendered — flip this to true to
          revert instantly. */}
      {SHOW_OLD_KPI_GRID && (
        <div
          ref={kpiGridRef}
          className={"kc-grid kc-grid-kpi" + (!layoutLocked ? " kc-editing" : "")}
          role="list"
          aria-label="Dashboard KPI cards"
        >
          {orderedKpis.map((k, i) => {
            const isDragging = dragKey === k.label;
            const clickable = layoutLocked && CLICKABLE_KPI_LABELS.has(k.label);
            return (
              <div
                key={k.label}
                data-kpi-key={k.label}
                className={"kc" + (!layoutLocked ? " kc-draggable" : "") + (isDragging ? " kc-dragging" : "") + (clickable ? " kc-clickable" : "")}
                role={clickable ? "button" : "listitem"}
                aria-label={clickable
                  ? `${k.label} card — ${k.val}. Press Enter to see these beds.`
                  : `${k.label} card, position ${i + 1} of ${orderedKpis.length}${!layoutLocked ? ". Press and hold, then use arrow keys to reorder." : ""}`}
                tabIndex={!layoutLocked || clickable ? 0 : -1}
                onPointerDown={layoutLocked ? undefined : (e) => { e.preventDefault(); pressStart(k.label, e); }}
                onClick={clickable ? () => openBedExplorer(k.label, k.color) : undefined}
                onKeyDown={(e) => {
                  if (layoutLocked) {
                    if (clickable && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault(); openBedExplorer(k.label, k.color);
                    }
                    return;
                  }
                  if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); moveByKeyboard(k.label, -1); }
                  else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); moveByKeyboard(k.label, 1); }
                }}
              >
                {!layoutLocked && (
                  <span className="kc-handle" aria-hidden="true" title="Hold and drag to reorder">⠿</span>
                )}
                <div className="kc-head">
                  <div className="kc-label" style={{ color: k.color }}>{k.label}</div>
                  <div className="kc-icon" style={{ color: k.color, background: `${k.color}1a` }}>
                    <Ic d={k.icon} s={15} />
                  </div>
                </div>
                <div className="kc-val">{k.val}</div>
                <div className="kc-sub">{k.sub}</div>
                <Sparkline values={k.series} color={k.color} id={k.label.replace(/[^a-z0-9]/gi, "")} />
              </div>
            );
          })}
        </div>
      )}

      {/* ── Canvas Dashboard: Hospital Snapshot / Occupancy / Transaction / Payer ── */}
      <div id="nav-snapshot" className="cv-panel" style={{ marginTop: showingAll ? 0 : 4, scrollMarginTop: 72 }}>
        <div className="cv-panel-head">
          <div className="cv-panel-title">Hospital Snapshot</div>
        </div>
        <div className="cv-snap-grid">
          {snapshotCards.map((k) => (
            <div key={k.label} className="cv-snap-tile" role="button" tabIndex={0}
              aria-label={`${k.label} — ${k.val}. Press Enter to see these beds.`}
              onClick={() => openBedExplorer(k.explorerKey, k.color)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBedExplorer(k.explorerKey, k.color); } }}>
              <div className="cv-snap-head">
                <span className="cv-snap-icon" style={{ color: k.color, background: `${k.color}1a` }}>
                  <Ic d={k.icon} s={14} />
                </span>
                <span className="cv-snap-label">{k.label}</span>
              </div>
              <div className="cv-snap-val">{k.val}</div>
              <Sparkline values={sparkSeries(k.series, k.val)} color={k.color} id={"cvSnap" + k.label.replace(/[^a-z0-9]/gi, "")} h={28} />
            </div>
          ))}
        </div>
      </div>

      <div className="cv-join" />

      <div id="nav-occupancy" className="cv-panel cv-panel-occ" style={{ scrollMarginTop: 72 }}>
        <div className="cv-panel-head">
          <div className="cv-panel-title">Occupancy Board</div>
        </div>
        {(totalPatientsCard || totalOccupancyCard) && (
          <div className="cv-hero-row">
            {totalPatientsCard && (
              <div className="cv-hero" role="button" tabIndex={0}
                aria-label={`Total Patients — ${totalPatientsCard.val}. Press Enter to see these beds.`}
                onClick={() => openBedExplorer(totalPatientsCard.explorerKey, totalPatientsCard.color)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBedExplorer(totalPatientsCard.explorerKey, totalPatientsCard.color); } }}>
                <div className="cv-hero-icon" style={{ color: totalPatientsCard.color, background: `${totalPatientsCard.color}1a` }}>
                  <Ic d={totalPatientsCard.icon} s={18} />
                </div>
                <div>
                  <div className="cv-hero-val">{totalPatientsCard.val}</div>
                  <div className="cv-hero-label">Total Patients · {totalPatientsCard.sub}</div>
                </div>
                <div className="cv-hero-spark cv-hero-spark-rich">
                  <HeroTrendChart values={sparkSeries(totalPatientsCard.series, totalPatientsCard.val)} color={totalPatientsCard.color} id="cvHeroTot" />
                </div>
              </div>
            )}
            {totalOccupancyCard && (
              <div className="cv-hero" role="button" tabIndex={0}
                aria-label={`Total Occupancy — ${totalOccupancyCard.val}. Press Enter to see these beds.`}
                onClick={() => openBedExplorer(totalOccupancyCard.explorerKey, totalOccupancyCard.color)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBedExplorer(totalOccupancyCard.explorerKey, totalOccupancyCard.color); } }}>
                <div className="cv-hero-icon" style={{ color: totalOccupancyCard.color, background: `${totalOccupancyCard.color}1a` }}>
                  <Ic d={totalOccupancyCard.icon} s={18} />
                </div>
                <div>
                  <div className="cv-hero-val">{totalOccupancyCard.val}</div>
                  <div className="cv-hero-label">Current Occupancy</div>
                  <div className="cv-hero-label">{totalOccupancyCard.sub}</div>
                </div>
                <div className="cv-hero-spark cv-hero-spark-rich">
                  <HeroTrendChart values={sparkSeries(totalOccupancyCard.series, totalOccupancyCard.val)} color={totalOccupancyCard.color} id="cvHeroOcc" />
                </div>
              </div>
            )}
          </div>
        )}
        {/* Non-admin scopes render 5 groups (no Discharge Lounge — see loungeCards
            above), which leaves a hole in the last row of the 2-column phone grid.
            cv-groups-swipe turns the board into a horizontal strip there instead.
            Admin renders 6 and fills the grid exactly, so it keeps the grid. */}
        <div className="cv-swipe-wrap">
        <div ref={occStripRef} className={"cv-groups" + (scope === "admin" ? "" : " cv-groups-swipe")}
          style={{ "--cv-group-count": occGroups.length }}>
          {occGroups.map((g) => (
            <div key={g.title} className="cv-group">
              <div className="cv-group-head">
                {g.title}
              </div>
              {g.cards.map((k, i) => (
                <div key={k.label}
                  className={"cv-metric" + (i > 0 ? " cv-metric-sub-item" : "") + (k.explorerKey ? " cv-metric-click" : "")}
                  role={k.explorerKey ? "button" : undefined}
                  tabIndex={k.explorerKey ? 0 : undefined}
                  aria-label={k.explorerKey ? `${k.label} — ${k.val}. Press Enter to see these beds.` : undefined}
                  onClick={k.explorerKey ? () => openBedExplorer(k.explorerKey, k.color, k.payerFilter) : undefined}
                  onKeyDown={k.explorerKey ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBedExplorer(k.explorerKey, k.color, k.payerFilter); } } : undefined}>
                  <span className="cv-metric-dot" style={{ background: k.color }} />
                  <span className="cv-metric-label">{k.label}{k.sub ? <span className="cv-metric-sub"> · {k.sub}</span> : null}</span>
                  <span className="cv-metric-val">{k.val}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        {scope !== "admin" && <SwipeThumb targetRef={occStripRef} deps={occGroups.length} />}
        </div>
      </div>

      <div className="cv-join" />

      {TRANSACTION_BOARD_VISIBLE_TO.includes(currentUsername) && transactionCards.length > 0 && (() => {
        const divIdx = transactionCards.findIndex((k) => k.divider);
        const sets = divIdx === -1
          ? [{ heading: null, cards: transactionCards }]
          : [
            { heading: null, cards: transactionCards.slice(0, divIdx) },
            { heading: transactionCards[divIdx].heading, cards: transactionCards.slice(divIdx + 1) },
          ];
        const renderCard = (k) => (
          <div key={k.label} className="cv-txn-card"
            role={k.step ? "button" : undefined}
            tabIndex={k.step ? 0 : undefined}
            aria-label={k.step ? `${k.label} — ${k.val}. Press Enter to see these admissions.` : undefined}
            onClick={k.step ? () => openDischargeList(k.step, k.label) : undefined}
            onKeyDown={k.step ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDischargeList(k.step, k.label); } } : undefined}>
            <div className="cv-txn-card-head">
              <span className="cv-txn-card-icon" style={{ color: k.color, background: `${k.color}1a` }}>
                <Ic d={k.icon} s={14} />
              </span>
              <span className="cv-txn-card-label">{k.label}</span>
            </div>
            <div className="cv-txn-card-val">
              {k.val}
              {k.subVal != null && (
                <span className="cv-txn-sub-val">{k.subVal} {k.subLabel}</span>
              )}
            </div>
            <Sparkline values={sparkSeries(k.series, k.val)} color={k.color} id={"cvTxn" + k.label.replace(/[^a-z0-9]/gi, "")} h={24} />
          </div>
        );
        return (
          <div id="nav-txn" className="cv-panel" style={{ scrollMarginTop: 72 }}>
            <div className="cv-panel-head">
              <div className="cv-panel-title">Transaction Board</div>
            </div>
            {sets.map((s, si) => (
              <div key={si}>
                {s.heading && <div className="cv-txn-section-head">{s.heading}</div>}
                <div className="cv-txn-cards">{s.cards.map(renderCard)}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Ward tables — this is what gets captured by Snapshot/Copy/Share */}
      <div id="nav-wards" ref={snapshotRef} style={{ scrollMarginTop: 72 }}>
        {groupBy === "none" || compact ? (
          <>
            <WardStatusTable title="Census Beds" accent="var(--st-v)" accentBg="var(--st-v-bg)" rows={censusRows} totalLabel="TOTAL (CENSUS)" searchFilter={searchFilter} compact={compact} groupBy={compact && groupBy !== "none" ? groupBy : null} groupBySelect={
              <select className="field" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}
                style={{ fontSize: 11, fontWeight: 600, height: 28, borderRadius: 7, paddingTop: 0, paddingBottom: 0, paddingLeft: 8, paddingRight: 8, width: "auto", minWidth: 0 }}>
                {GROUP_BY_OPTIONS.map((o2) => <option key={o2.value} value={o2.value}>Group by: {o2.label}</option>)}
              </select>
            } />
            <WardStatusTable title="Non-Census Beds" accent="var(--st-o)" accentBg="var(--st-o-bg)" rows={nonCensusRows} totalLabel="TOTAL (NON-CENSUS)" searchFilter={searchFilter} compact={compact} groupBy={compact && groupBy !== "none" ? groupBy : null} />
          </>
        ) : (
          <UnifiedGroupedTable rows={wardTableRows} searchFilter={searchFilter} groupBy={groupBy} groupBySelect={
            <select className="field" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}
              style={{ fontSize: 11, fontWeight: 600, height: 28, borderRadius: 7, paddingTop: 0, paddingBottom: 0, paddingLeft: 8, paddingRight: 8, width: "auto", minWidth: 0 }}>
              {GROUP_BY_OPTIONS.map((o2) => <option key={o2.value} value={o2.value}>Group by: {o2.label}</option>)}
            </select>
          } />
        )}
      </div>

      {hospitalWide && consultantData && consultantData.consultants.length > 0 && (
        <div id="nav-consultants" style={{ scrollMarginTop: 72 }}>
          <ConsultantsTable data={consultantData} search={search} searchBy={searchBy} />
        </div>
      )}

      {hospitalWide && (
        <div className="row between" style={{ marginTop: 4, flexWrap: "wrap", gap: 8 }}>
          <span className="dim" style={{ fontSize: 11 }}>
            Note: Occupancy % = (On Bed + Occ+Res) / Total Beds × 100 · "–" = not yet reported this round
          </span>
          <span className="dim" style={{ fontSize: 11 }}>
            Last updated {lastSync.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      )}

      {hospitalWide && <SectionNavigator scanKey={`${adminCards ? "a" : ""}${consultantData ? "c" : ""}`} />}

      {snapToast && <div className="toast">{snapToast}</div>}
      {confirmDialog}
      {bedExplorer && (
        <BedExplorerModal
          entry={bedExplorer}
          wardIds={wardIdsInScope}
          wardMeta={wardMeta}
          onClose={() => setBedExplorer(null)}
          fetchBeds={scoped ? scoped.bedDetails : api.cooBedDetails}
        />
      )}
      {dischargeList && (
        <DischargeListModal entry={dischargeList} onClose={() => setDischargeList(null)} />
      )}
    </div>
  );
}


function greetOf() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

// ══════════════════════════════════════════════════════════════════════════════
//  PAYER & TRENDS — Analytics sub-tab. Org-wide Payer Mix (accordion + range
//  toggle + unit/ward drill-down) and the Occupancy Trend chart (avg/high/low).
// ══════════════════════════════════════════════════════════════════════════════
function PayerTrendsPanel({ refreshKey = 0 }) {
  const [liveData, setLiveData] = useState(null);
  const [payerRange, setPayerRange] = useState("live");
  const [expandedPayer, setExpandedPayer] = useState(null);
  const [trendRange, setTrendRange] = useState("7d");
  const [trend, setTrend] = useState(null);

  useEffect(() => { api.cooLiveWards().then(setLiveData).catch(() => { }); }, [refreshKey]);
  useEffect(() => {
    let alive = true; setTrend(null);
    api.cooOccupancyTrend(trendRange).then((t) => alive && setTrend(t))
      .catch(() => alive && setTrend({ points: [], avg: 0, high: { pct: 0, label: "—" }, low: { pct: 0, label: "—" } }));
    return () => { alive = false; };
  }, [trendRange, refreshKey]);

  if (!liveData) return (
    <div className="empty" style={{ paddingTop: 80 }}>
      <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
      <div className="dim" style={{ marginTop: 12 }}>Loading…</div>
    </div>
  );

  const W = liveData.wards || [];
  const payerMetric = (w) => payerRange === "live" ? (w.payersLive || {}) : ((w.payersAdmit || {})[payerRange] || {});
  const agg = {};
  for (const w of W) for (const [p, n] of Object.entries(payerMetric(w))) agg[p] = (agg[p] || 0) + n;
  const payerTotal = Object.values(agg).reduce((a, b) => a + b, 0);
  const payerRows = Object.keys(agg).map((name) => ({ name, val: agg[name], pct: payerTotal > 0 ? (agg[name] / payerTotal) * 100 : 0 })).sort((a, b) => b.val - a.val);
  const PAYER_RANGES = [["live", "Live"], ["today", "Today"], ["d7", "7d"], ["d30", "30d"], ["y1", "1y"]];
  const payerCaption = { live: "occupied now", today: "admitted today", d7: "admitted in 7d", d30: "admitted in 30d", y1: "admitted in 1y" }[payerRange];
  const payerBreakdown = (name) => {
    const byUnit = {}; const wards = [];
    for (const w of W) {
      const n = (payerMetric(w) || {})[name] || 0;
      if (n > 0) { const u = (w.unit_type || "—").trim() || "—"; byUnit[u] = (byUnit[u] || 0) + n; wards.push({ ward: w.ward, n }); }
    }
    return { units: Object.entries(byUnit).map(([unit, n]) => ({ unit, n })).sort((a, b) => b.n - a.n), wards: wards.sort((a, b) => b.n - a.n) };
  };

  const TREND_RANGES = [["today", "Today"], ["7d", "7 Days"], ["30d", "30 Days"], ["1y", "1 Year"]];
  const delta = trend && trend.points.length > 1 ? trend.points[trend.points.length - 1].pct - trend.points[0].pct : 0;
  const deltaLabel = { today: "since midnight", "7d": "vs last 7 days", "30d": "vs last 30 days", "1y": "vs last year" }[trendRange] || "over period";

  return (
    <div className="dash-2col">
      <div className="pm-panel">
        <div className="pm-head">
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <span className="pm-title">Payer Mix</span>
            <span className="pm-pill">{payerTotal} {payerCaption}</span>
          </div>
          <div className="seg-pill seg-pill-sm">
            {PAYER_RANGES.map(([k, l]) => <button key={k} className={payerRange === k ? "on" : ""} onClick={() => setPayerRange(k)}>{l}</button>)}
          </div>
        </div>
        {payerRows.length === 0 ? (
          <div className="dim" style={{ fontSize: 13, padding: "10px 2px" }}>No data for this range.</div>
        ) : (
          <>
            <div className="pm-rows">
              {payerRows.map((p, i) => {
                const open = expandedPayer === p.name;
                const bd = open ? payerBreakdown(p.name) : null;
                const c = PAYER_PALETTE[i % PAYER_PALETTE.length];
                return (
                  <div key={p.name} className="pm-row">
                    <button className="pm-rowhead" onClick={() => setExpandedPayer(open ? null : p.name)}>
                      <span className={"pm-chev" + (open ? " open" : "")}><Ic d={icons.chevron} s={13} /></span>
                      <span className="pm-ic" style={{ color: c, background: `${c}16` }}><Ic d={payerIcon(p.name)} s={16} /></span>
                      <span className="pm-main">
                        <span className="pm-name">{p.name}</span>
                        {open && bd && (
                          <span className="pm-inline">
                            <span><span className="pm-dl">BY UNIT</span>{bd.units.length ? bd.units.map((u) => `${u.unit} ${u.n}`).join("  •  ") : "—"}</span>
                            <span><span className="pm-dl">TOP WARDS</span>{bd.wards.length ? bd.wards.slice(0, 6).map((w) => `${w.ward} (${w.n})`).join(", ") : "—"}{bd.wards.length > 6 ? ` +${bd.wards.length - 6} more` : ""}</span>
                          </span>
                        )}
                      </span>
                      <span className="pm-right">
                        <span className="pm-right-top"><span className="pm-val">{p.val}</span></span>
                        <span className="pm-meter">
                          <span className="pm-bar"><i style={{ width: `${p.pct}%`, background: c }} /></span>
                          <span className="pm-pct" style={{ color: c, background: `${c}14` }}>{p.pct.toFixed(1)}%</span>
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="pm-total">
              <span className="pm-total-name">Total</span>
              <span className="dim" style={{ fontSize: 12 }}>• {payerRows.length} payers</span>
              <span className="pm-total-val">{payerTotal}</span>
              <span className="pm-total-pct">100%</span>
            </div>
          </>
        )}
      </div>

      <div className="tr-panel">
        <div className="tr-head">
          <span className="tr-title">Occupancy Trend</span>
          <div className="seg-pill seg-pill-sm">
            {TREND_RANGES.map(([k, l]) => <button key={k} className={trendRange === k ? "on" : ""} onClick={() => setTrendRange(k)}>{l}</button>)}
          </div>
        </div>
        {trend === null ? (
          <div className="empty" style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center" }}><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={22} /></span></div>
        ) : (
          <>
            <TrendChart points={trend.points} height={300} />
            <div className="tr-foot">
              <div className="tr-stat">
                <div className="tr-stat-l">Average Occupancy</div>
                <div className="tr-stat-v">{trend.avg}%</div>
                {trend.points.length > 1 && (
                  <div className="tr-delta" style={{ color: delta >= 0 ? "var(--st-v)" : "var(--st-or)" }}>{delta >= 0 ? "↗" : "↘"} {Math.abs(delta)}% {deltaLabel}</div>
                )}
              </div>
              <div className="tr-stat"><div className="tr-stat-l" style={{ color: "var(--st-v)" }}>Highest</div><div className="tr-stat-v">{trend.high.pct}%</div><div className="dim" style={{ fontSize: 11 }}>{trend.high.label}</div></div>
              <div className="tr-stat"><div className="tr-stat-l" style={{ color: "var(--st-or)" }}>Lowest</div><div className="tr-stat-v">{trend.low.pct}%</div><div className="dim" style={{ fontSize: 11 }}>{trend.low.label}</div></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const GROUP_BY_OPTIONS = [
  { value: "none", label: "None" },
  { value: "room_type", label: "Room Type" },
  { value: "unit_type", label: "Unit Type" },
  { value: "block_name", label: "Building Block" },
  { value: "floor_name", label: "Floor" },
];

// Defined outside table components so function references are stable across renders
function OccBar({ p }) {
  return (
    <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{Math.round(p)}%</span>
  );
}

// Click to toggle between relative ("5m ago") and absolute (date + time) display.
// `ts` is the last bed-value change (beds.updated_at). `reviewedAt` is the last
// time a PRE round confirmed the ward. When a ward was confirmed more recently
// than it was changed, we surface that so "last updated" doesn't read as stale
// for a ward that was just reviewed-unchanged.
function LastUpdatedCell({ ts, reviewedAt = null }) {
  const [open, setOpen] = useState(false);
  const showReviewed = reviewedAt && (!ts || reviewedAt > ts);
  if (!ts && !showReviewed) return <span className="dim">–</span>;
  return (
    <span
      className="dim"
      style={{ fontSize: 11, cursor: "pointer", userSelect: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, lineHeight: 1.2, textAlign: "center", whiteSpace: "nowrap" }}
      title="Click to toggle date/time"
      onClick={() => setOpen(o => !o)}
    >
      <span>{ts ? (open ? fmtDateTime(ts) : fmtRelative(ts)) : "No change yet"}</span>
      {showReviewed && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--st-v)", fontSize: 9.5, fontWeight: 700 }}
          title="Last time a PRE round confirmed this ward, even with no occupancy change">
          <Ic d={icons.check} s={9} /> Reviewed {open ? fmtDateTime(reviewedAt) : fmtRelative(reviewedAt)}
        </span>
      )}
    </span>
  );
}

const wstSum = (list, fn) => list.reduce((a, r) => a + (fn(r) || 0), 0);
const wstC = { textAlign: "center" };
const wstCW = { textAlign: "center", minWidth: 58, padding: "6px 10px" };

// Compact tables (Consultant dashboard only — see `compact` in LiveBedDashboard)
// render Census Beds and Non-Census Beds as two separate <table>s stacked on
// top of each other. With the default table-layout:auto, each <table> sizes
// its own columns independently from the other, purely from its own content —
// so when one table's WARD column has to fit a longer label than the other's
// (e.g. "GENERAL WARD (F) - NON AC" vs "Dialysis"), its numeric columns land
// at a different x-offset than the table below it, even though visually
// stacked. These fixed widths, combined with table-layout:fixed on both
// <table>s (see WardStatusTable), force every compact table to use the same
// column grid regardless of its own content — restricted to `compact` only,
// so nothing changes for any other role's ward tables.
// Width comes from --wst-ward (see .wst-compact in styles.css) rather than a
// literal, so it can shrink on narrow screens: this is also the sticky pinned
// column, and at a flat 280px it left only ~78px of a phone to swipe the other
// 560px of columns through. Both stacked tables read the same variable, so they
// stay on one shared column grid — the reason these widths are fixed at all.
const wstCompactWard = { width: "var(--wst-ward, 280px)", overflow: "hidden" };
const wstCompactNum = { textAlign: "center", width: 100 };
const wstCompactMeta = { textAlign: "center", width: 130 };

// Normalize a verbose, inconsistently-cased room type into a compact label:
//   "SINGLE ROOM - AC"         → "Single Room · AC"
//   "GENERAL WARD (F) - NON AC"→ "General Ward (F) · NAC"
//   "Critical Care (Peads)"    → "Critical Care (Peads)"
const RT_ACRONYMS = new Set(["AC", "NAC", "OT", "BMT", "ICU", "HDU", "NICU", "MICU", "SICU", "KT", "LT", "CT"]);
function shortRoomType(rt) {
  if (!rt || !rt.trim()) return null;
  const s = rt
    .replace(/non\s*-?\s*ac/ig, "NAC")   // "NON AC" → "NAC"
    .replace(/\s*[-–]\s*/g, " · ");        // hyphen separator → middot
  return s.split(/\s+/).map((w) => {
    if (w === "·") return w;
    if (/^\(.*\)$/.test(w)) {              // parenthetical tag, e.g. (F) / (Peads)
      const inner = w.slice(1, -1);
      return "(" + (RT_ACRONYMS.has(inner.toUpperCase()) || inner.length <= 2
        ? inner.toUpperCase()
        : inner.charAt(0).toUpperCase() + inner.slice(1).toLowerCase()) + ")";
    }
    if (RT_ACRONYMS.has(w.toUpperCase())) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}

function renderWardRow(r, showBadge, compact = false) {
  const reported = r.vacant !== null && r.vacant !== undefined;
  const o = r.occupied || 0;
  const or_ = r.occupied_reserved || 0;
  const v = r.vacant || 0;
  const vr = r.reserved || 0;
  const { totalOccupied: occ, totalVacant: vac, totalBeds: reportedBeds } = calculateWardTotals(r);
  const p = reported && reportedBeds > 0 ? (occ / reportedBeds) * 100 : 0;
  const d = (n) => reported ? n : "–";
  const isCensus = r.bed_type !== "Non-Census";
  const at = r.admissionTypes || {};
  const updatedByName = r.updated_by_name || null;
  return (
    <tr key={r.id}>
      <td style={{ fontWeight: 600, ...(compact ? wstCompactWard : null) }}>
        <span>
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
        </span>
        {r.room_type && (
          <div style={{ fontSize: 10, fontWeight: 500, color: "var(--ink-3)", marginTop: 1, whiteSpace: "nowrap" }}>
            · {shortRoomType(r.room_type)}
          </div>
        )}
      </td>
      <td style={compact ? wstCompactNum : wstC}>{r.total}</td>
      <td style={{ ...(compact ? wstCompactNum : wstC), fontWeight: 700, color: "var(--st-o)" }}>{d(occ)}</td>
      {!compact && <td style={{ ...wstC, fontWeight: 700, color: "var(--st-o)" }}>{d(o)}</td>}
      {!compact && <td style={{ ...wstC, fontWeight: 700, color: "var(--st-or)" }}>{d(or_)}</td>}
      {!compact && <td style={{ ...wstC, fontWeight: 700, color: "#f59e0b" }}>{d(r.overstayCount || 0)}</td>}
      {!compact && <td style={{ ...wstCW, fontWeight: 700, color: "#2563eb" }}>{d(at.IP || 0)}</td>}
      {!compact && <td style={{ ...wstCW, fontWeight: 700, color: "#8b5cf6" }}>{d(at.OPD || 0)}</td>}
      {!compact && <td style={{ ...wstCW, fontWeight: 700, color: "#0ea5b7" }}>{d(at.DAYCARE || 0)}</td>}
      <td style={{ ...(compact ? wstCompactNum : wstC), fontWeight: 700, color: "var(--st-v)" }}>{d(vac)}</td>
      {!compact && <td style={{ ...wstC, fontWeight: 700, color: "var(--st-v)" }}>{d(v)}</td>}
      {!compact && <td style={{ ...wstC, fontWeight: 700, color: "var(--st-vr)" }}>{d(vr)}</td>}
      {!compact && <td style={{ ...wstC, fontWeight: 700, color: "#0d9488" }}>{r.loungeCount || 0}</td>}
      {!compact && <td style={wstC}>{reported ? <OccBar p={p} /> : <span className="dim">–</span>}</td>}
      <td style={compact ? wstCompactMeta : undefined}><LastUpdatedCell ts={r.updatedAt} reviewedAt={r.reviewedAt} /></td>
      <td style={{ ...(compact ? wstCompactMeta : wstC), fontSize: 11, fontWeight: 600 }}>{updatedByName || <span className="dim">–</span>}</td>
    </tr>
  );
}

function groupAggregates(grpRows) {
  const gb = wstSum(grpRows, r => r.total);
  const go = wstSum(grpRows, r => r.occupied || 0);
  const gor = wstSum(grpRows, r => r.occupied_reserved || 0);
  const gv = wstSum(grpRows, r => r.vacant || 0);
  const gvr = wstSum(grpRows, r => r.reserved || 0);
  const { totalOccupied: gocc, totalVacant: gvac, totalBeds: gReportedBeds } = calculateWardTotals(grpRows);
  const gp = gReportedBeds > 0 ? Math.round((gocc / gReportedBeds) * 100) : 0;
  const gUpdatedAt = grpRows.reduce((max, r) => (r.updatedAt && r.updatedAt > (max || 0)) ? r.updatedAt : max, null);
  const gOverstay = wstSum(grpRows, r => r.overstayCount || 0);
  const gIp = wstSum(grpRows, r => (r.admissionTypes || {}).IP || 0);
  const gOp = wstSum(grpRows, r => (r.admissionTypes || {}).OPD || 0);
  const gDaycare = wstSum(grpRows, r => (r.admissionTypes || {}).DAYCARE || 0);
  const gLounge = wstSum(grpRows, r => r.loungeCount || 0);
  return { gb, go, gor, gv, gvr, gocc, gvac, gp, gUpdatedAt, gOverstay, gIp, gOp, gDaycare, gLounge };
}

// Flat table — shown when Group by = None
function WardStatusTable({ title, accent, accentBg, rows, totalLabel, searchFilter, groupBySelect, compact = false, groupBy = null }) {
  const filtered = rows.filter(searchFilter);
  const [expanded, setExpanded] = useState(new Set());
  useEffect(() => { setExpanded(new Set()); }, [groupBy]);
  const toggleSection = (key) =>
    setExpanded(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });

  const totBeds = wstSum(filtered, r => r.total);
  const totV = wstSum(filtered, r => r.vacant);
  const totR = wstSum(filtered, r => r.reserved);
  const totO = wstSum(filtered, r => r.occupied || 0);
  const totOR = wstSum(filtered, r => r.occupied_reserved || 0);
  const { totalOccupied: totOcc, totalVacant: totVac, totalBeds: totReportedBeds } = calculateWardTotals(filtered);
  const totPct = totReportedBeds > 0 ? Math.round((totOcc / totReportedBeds) * 100) : 0;
  const totOverstay = wstSum(filtered, r => r.overstayCount || 0);
  const totIp = wstSum(filtered, r => (r.admissionTypes || {}).IP || 0);
  const totOp = wstSum(filtered, r => (r.admissionTypes || {}).OPD || 0);
  const totDaycare = wstSum(filtered, r => (r.admissionTypes || {}).DAYCARE || 0);
  const totLounge = wstSum(filtered, r => r.loungeCount || 0);
  const totUpdatedAt = filtered.reduce((max, r) => (r.updatedAt && r.updatedAt > (max || 0)) ? r.updatedAt : max, null);

  const groups = groupBy ? (() => {
    const map = new Map();
    for (const r of filtered) {
      const k = r[groupBy] || "—";
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return [...map.entries()]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([k, grpRows]) => ({ key: k, grpRows }));
  })() : null;

  const colSpan = compact ? 6 : 16;

  return (
    <div className="card" style={{ marginBottom: 16, overflow: "hidden" }}>
      <div className="row between" style={{ padding: "13px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: accent }}>{title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {groupBySelect}
          <span className="chip" style={{ color: accent }}>Total: {totBeds} beds</span>
        </div>
      </div>
      <div className="tbl-wrap" style={{ border: "none", borderRadius: 0 }}>
        {/* table-layout:fixed (compact only) + the shared wstCompact* widths below
            are what make this table's columns line up with the other compact
            table stacked below/above it — see the comment on wstCompactWard. */}
        <table className={"tbl tbl-pin1" + (compact ? " wst-compact" : "")} style={compact ? { tableLayout: "fixed" } : undefined}>
          <thead>
            <tr>
              <th style={compact ? wstCompactWard : undefined}>WARD</th>
              <th style={compact ? wstCompactNum : wstC}>TOTAL BEDS</th>
              <th style={{ ...(compact ? wstCompactNum : wstC), color: "var(--st-o)" }}>TOTAL OCC</th>
              {!compact && <th style={{ ...wstC, color: "var(--st-o)" }}>ON BED</th>}
              {!compact && <th style={{ ...wstC, color: "var(--st-or)" }}>OCC[RES]</th>}
              {!compact && <th style={{ ...wstC, color: "#f59e0b" }}>OVERSTAY</th>}
              {!compact && <th style={{ ...wstCW, color: "#2563eb" }}>IP</th>}
              {!compact && <th style={{ ...wstCW, color: "#8b5cf6" }}>OP</th>}
              {!compact && <th style={{ ...wstCW, color: "#0ea5b7" }}>DAY CARE</th>}
              <th style={{ ...(compact ? wstCompactNum : wstC), color: "var(--st-v)" }}>TOTAL VAC</th>
              {!compact && <th style={{ ...wstC, color: "var(--st-v)" }}>VACANT</th>}
              {!compact && <th style={{ ...wstC, color: "var(--st-vr)" }}>VAC[RES]</th>}
              {!compact && <th style={{ ...wstC, color: "#0d9488" }}>DIS. LOUNGE</th>}
              {!compact && <th style={wstC}>OCC %</th>}
              <th style={compact ? wstCompactMeta : wstC}>LAST UPDATED</th>
              <th style={compact ? wstCompactMeta : wstC}>UPDATED BY</th>
            </tr>
          </thead>
          <tbody>
            <tr className="tbl-total-row" style={{ background: accentBg, "--tbl-total-accent": accent }}>
              <td style={{ fontWeight: 800, fontSize: 13, color: accent, background: accentBg, ...(compact ? wstCompactWard : null) }}>{totalLabel}</td>
              <td style={{ ...(compact ? wstCompactNum : wstC), fontWeight: 800 }}>{totBeds}</td>
              <td style={{ ...(compact ? wstCompactNum : wstC), fontWeight: 800, color: "var(--st-o)" }}>{totOcc}</td>
              {!compact && <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)" }}>{totO}</td>}
              {!compact && <td style={{ ...wstC, fontWeight: 800, color: "var(--st-or)" }}>{totOR}</td>}
              {!compact && <td style={{ ...wstC, fontWeight: 800, color: "#f59e0b" }}>{totOverstay}</td>}
              {!compact && <td style={{ ...wstCW, fontWeight: 800, color: "#2563eb" }}>{totIp}</td>}
              {!compact && <td style={{ ...wstCW, fontWeight: 800, color: "#8b5cf6" }}>{totOp}</td>}
              {!compact && <td style={{ ...wstCW, fontWeight: 800, color: "#0ea5b7" }}>{totDaycare}</td>}
              <td style={{ ...(compact ? wstCompactNum : wstC), fontWeight: 800, color: "var(--st-v)" }}>{totVac}</td>
              {!compact && <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)" }}>{totV}</td>}
              {!compact && <td style={{ ...wstC, fontWeight: 800, color: "var(--st-vr)" }}>{totR}</td>}
              {!compact && <td style={{ ...wstC, fontWeight: 800, color: "#0d9488" }}>{totLounge}</td>}
              {!compact && <td style={wstC}><OccBar p={totPct} /></td>}
              <td style={compact ? wstCompactMeta : undefined}><LastUpdatedCell ts={totUpdatedAt} /></td>
              <td style={compact ? wstCompactMeta : undefined}></td>
            </tr>
            {filtered.length === 0 ? (
              <tr><td colSpan={colSpan} style={{ textAlign: "center", color: "var(--ink-3)", padding: "22px 14px" }}>
                No wards match the current filter.
              </td></tr>
            ) : groups ? (
              groups.map(({ key, grpRows }) => {
                const isOpen = expanded.has(key);
                const { gb, gocc, gvac, gUpdatedAt } = groupAggregates(grpRows);
                return (
                  <React.Fragment key={key}>
                    <tr onClick={() => toggleSection(key)}
                      style={{ cursor: "pointer", background: "var(--panel-2)", borderTop: "1px solid var(--line)", userSelect: "none" }}>
                      <td style={{ fontWeight: 800, fontSize: 12, letterSpacing: ".04em", color: accent, padding: "8px 14px", ...(compact ? wstCompactWard : null) }}>
                        <span style={{ marginRight: 8, display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", fontSize: 10 }}>▶</span>
                        {key}
                      </td>
                      <td style={{ ...(compact ? wstCompactNum : wstC), fontWeight: 800 }}>{gb}</td>
                      <td style={{ ...(compact ? wstCompactNum : wstC), fontWeight: 800, color: "var(--st-o)" }}>{gocc}</td>
                      <td style={{ ...(compact ? wstCompactNum : wstC), fontWeight: 800, color: "var(--st-v)" }}>{gvac}</td>
                      <td style={compact ? wstCompactMeta : undefined}><LastUpdatedCell ts={gUpdatedAt} /></td>
                      <td style={compact ? wstCompactMeta : undefined}></td>
                    </tr>
                    {isOpen && grpRows.map(r => renderWardRow(r, false, compact))}
                  </React.Fragment>
                );
              })
            ) : (
              filtered.map(r => renderWardRow(r, false, compact))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Unified grouped table — shown when any Group by is active
function UnifiedGroupedTable({ rows, searchFilter, groupBy, groupBySelect }) {
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => { setExpanded(new Set()); }, [groupBy]);

  const toggleSection = (key) =>
    setExpanded(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });

  const filtered = rows.filter(searchFilter);

  const totBeds = wstSum(filtered, r => r.total);
  const totV = wstSum(filtered, r => r.vacant);
  const totR = wstSum(filtered, r => r.reserved);
  const totO = wstSum(filtered, r => r.occupied || 0);
  const totOR = wstSum(filtered, r => r.occupied_reserved || 0);
  const { totalOccupied: totOcc, totalVacant: totVac, totalBeds: totReportedBedsG } = calculateWardTotals(filtered);
  const totPct = totReportedBedsG > 0 ? Math.round((totOcc / totReportedBedsG) * 100) : 0;
  const totOverstayG = wstSum(filtered, r => r.overstayCount || 0);
  const totIpG = wstSum(filtered, r => (r.admissionTypes || {}).IP || 0);
  const totOpG = wstSum(filtered, r => (r.admissionTypes || {}).OPD || 0);
  const totDaycareG = wstSum(filtered, r => (r.admissionTypes || {}).DAYCARE || 0);
  const totLoungeG = wstSum(filtered, r => r.loungeCount || 0);

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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {groupBySelect}
          <span className="chip">Total: {totBeds} beds</span>
        </div>
      </div>
      <div className="tbl-wrap" style={{ border: "none", borderRadius: 0 }}>
        <table className="tbl tbl-pin1">
          <thead>
            <tr>
              <th>WARD</th>
              <th style={wstC}>TOTAL BEDS</th>
              <th style={{ ...wstC, color: "var(--st-o)" }}>TOTAL OCC</th>
              <th style={{ ...wstC, color: "var(--st-o)" }}>ON BED</th>
              <th style={{ ...wstC, color: "var(--st-or)" }}>OCC[RES]</th>
              <th style={{ ...wstC, color: "#f59e0b" }}>OVERSTAY</th>
              <th style={{ ...wstCW, color: "#2563eb" }}>IP</th>
              <th style={{ ...wstCW, color: "#8b5cf6" }}>OP</th>
              <th style={{ ...wstCW, color: "#0ea5b7" }}>DAY CARE</th>
              <th style={{ ...wstC, color: "var(--st-v)" }}>TOTAL VAC</th>
              <th style={{ ...wstC, color: "var(--st-v)" }}>VACANT</th>
              <th style={{ ...wstC, color: "var(--st-vr)" }}>VAC[RES]</th>
              <th style={{ ...wstC, color: "#0d9488" }}>DIS. LOUNGE</th>
              <th style={wstC}>OCC %</th>
              <th style={wstC}>LAST UPDATED</th>
              <th style={wstC}>UPDATED BY</th>
            </tr>
          </thead>
          <tbody>
            {/* Grand total always shows first — reflects the active filter,
                including the zero-match case (all-zero totals, not vanished).
                Opaque background (matching --primary-bg's fallback everywhere
                else in the app), not the translucent rgba this used to have —
                the first cell here is position:sticky (.tbl-pin1), and a
                translucent sticky cell lets whatever scrolls underneath it
                (other columns, as the table scrolls horizontally) show through
                and visually overlap "GRAND TOTAL"'s own text. */}
            <tr className="tbl-total-row" style={{ background: "var(--primary-bg, #EFF6FF)", "--tbl-total-accent": "var(--primary)" }}>
              <td style={{ fontWeight: 800, fontSize: 13, color: "var(--primary)", background: "var(--primary-bg, #EFF6FF)" }}>GRAND TOTAL</td>
              <td style={{ ...wstC, fontWeight: 800 }}>{totBeds}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)" }}>{totOcc}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)" }}>{totO}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-or)" }}>{totOR}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "#f59e0b" }}>{totOverstayG}</td>
              <td style={{ ...wstCW, fontWeight: 800, color: "#2563eb" }}>{totIpG}</td>
              <td style={{ ...wstCW, fontWeight: 800, color: "#8b5cf6" }}>{totOpG}</td>
              <td style={{ ...wstCW, fontWeight: 800, color: "#0ea5b7" }}>{totDaycareG}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)" }}>{totVac}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)" }}>{totV}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-vr)" }}>{totR}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "#0d9488" }}>{totLoungeG}</td>
              <td style={wstC}><OccBar p={totPct} /></td>
              <td><LastUpdatedCell ts={filtered.reduce((max, r) => (r.updatedAt && r.updatedAt > (max || 0)) ? r.updatedAt : max, null)} /></td>
              <td></td>
            </tr>
            {filtered.length === 0 ? (
              <tr><td colSpan={16} style={{ textAlign: "center", color: "var(--ink-3)", padding: "22px 14px" }}>
                No wards match the current filter.
              </td></tr>
            ) : (
              groups.map(({ key, grpRows }) => {
                const isOpen = expanded.has(key);
                const { gb, go, gor, gv, gvr, gocc, gvac, gp, gUpdatedAt, gOverstay, gIp, gOp, gDaycare, gLounge } = groupAggregates(grpRows);
                return (
                  <React.Fragment key={key}>
                    <tr onClick={() => toggleSection(key)}
                      style={{ cursor: "pointer", background: "var(--panel-2)", borderTop: "1px solid var(--line)", userSelect: "none" }}>
                      <td style={{ fontWeight: 800, fontSize: 12, letterSpacing: ".04em", color: "var(--primary)", padding: "8px 14px" }}>
                        <span style={{ marginRight: 8, display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", fontSize: 10 }}>▶</span>
                        {key}
                      </td>
                      <td style={{ ...wstC, fontWeight: 800 }}>{gb}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)" }}>{gocc}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)" }}>{go}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "var(--st-or)" }}>{gor}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "#f59e0b" }}>{gOverstay}</td>
                      <td style={{ ...wstCW, fontWeight: 800, color: "#2563eb" }}>{gIp}</td>
                      <td style={{ ...wstCW, fontWeight: 800, color: "#8b5cf6" }}>{gOp}</td>
                      <td style={{ ...wstCW, fontWeight: 800, color: "#0ea5b7" }}>{gDaycare}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)" }}>{gvac}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)" }}>{gv}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "var(--st-vr)" }}>{gvr}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "#0d9488" }}>{gLounge}</td>
                      <td style={wstC}><OccBar p={gp} /></td>
                      <td><LastUpdatedCell ts={gUpdatedAt} /></td>
                      <td></td>
                    </tr>
                    {isOpen && grpRows.map(r => renderWardRow(r, true))}
                  </React.Fragment>
                );
              })
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
  const [views, setViews] = useState([]);
  const [viewModal, setViewModal] = useState(null); // null | { mode, view? }
  const [toast, setToast] = useState("");
  const [confirm, confirmDialog] = useConfirm();

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  const loadViews = async () => {
    try { setViews((await api.cooViews()).views || []); } catch { }
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
    ["Shared", views.filter(v => !v.is_system && v.is_shared)],
    ["Mine", views.filter(v => !v.is_system && !v.is_shared)],
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
  const [subTab, setSubTab] = useState("pre");
  const [preData, setPreData] = useState(null);
  const [nurseData, setNurseData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([api.cooPreActivity(), api.cooNurseActivity()]).then(([p, n]) => {
      if (p.status === "fulfilled") setPreData(p.value);
      if (n.status === "fulfilled") setNurseData(n.value);
    }).catch(() => { }).finally(() => setLoading(false));
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
      {subTab === "pre" && <PreActivityTab data={preData} />}
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

  const toggle = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  return (
    <div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 12 }}>
        {blocks.length} PRE block{blocks.length !== 1 ? "s" : ""} · today's rounds &amp; ward entry — tap a block to expand
      </div>
      {blocks.map((b) => {
        const isOpen = !!expanded[b.id];
        const score = b.compliance.score;
        const scoreColor = score >= 80 ? "var(--green)" : score >= 50 ? "var(--amber)" : "var(--red)";
        const noUser = !b.assignedUser;
        const totalW = b.wards.length;
        const doneW = b.wards.filter(w => w.vacant !== null).length;

        return (
          <div key={b.id} className="card" style={{ padding: 0, marginBottom: 8, overflow: "hidden" }}>
            {/* Slim header row (always visible) */}
            <button onClick={() => toggle(b.id)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "11px 14px", background: "transparent", textAlign: "left", cursor: "pointer",
            }}>
              <BlockAvatar code={b.name} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{b.name}</div>
                <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                  {noUser
                    ? <span style={{ color: "var(--amber)" }}>⚠ No PRE assigned</span>
                    : <>{b.assignedUser.name}</>}
                  {" · "}{doneW}/{totalW} wards · {b.roundsToday} round{b.roundsToday !== 1 ? "s" : ""}
                </div>
              </div>
              {b.status !== "active"
                ? <span className="tag b">{b.status}</span>
                : <span className="tag" title="On-time round compliance — rounds submitted vs expected by now (not occupancy)" style={{ background: score >= 80 ? "var(--st-v-bg)" : score >= 50 ? "#FEF3C7" : "var(--st-or-bg)", color: scoreColor, border: `1px solid ${scoreColor}` }}>{score}% on-time</span>}
              <Ic d={icons.chevron} s={14} style={{ color: "var(--ink-3)", transform: isOpen ? "rotate(90deg)" : "none", transition: ".15s", flexShrink: 0 }} />
            </button>

            {isOpen && (
              <div style={{ padding: "0 14px 14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "var(--panel-2)", borderRadius: 10, overflow: "hidden", marginBottom: 10 }}>
                  {[
                    { label: "ROUNDS TODAY", val: b.roundsToday },
                    { label: "EXPECTED", val: b.compliance.expected },
                    { label: "WARDS ENTERED", val: `${doneW}/${totalW}` },
                  ].map(({ label, val }, i) => (
                    <div key={label} style={{ textAlign: "center", padding: "9px 4px", borderLeft: i > 0 ? "1px solid var(--line)" : "none" }}>
                      <div style={{ fontSize: 9, color: "var(--ink-3)", fontWeight: 600, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{val}</div>
                    </div>
                  ))}
                </div>
                {b.lastSubmittedAt && (
                  <div className="dim" style={{ fontSize: 11, marginBottom: 8 }}>Last round submitted {fmtTime(b.lastSubmittedAt)}</div>
                )}
                {b.wards.length > 0 && <WardTableActivity wards={b.wards} />}
              </div>
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

  const [showAttn, setShowAttn] = useState(false);
  const toggle = (k) => setExpanded(p => ({ ...p, [k]: !p[k] }));
  const hasNurseGap = unassignedNurses.length > 0;
  const hasWardGap = unassignedWards.length > 0;
  const attn = hasNurseGap || hasWardGap;

  if (stations.length === 0 && !attn) return (
    <div className="card empty"><Ic d={icons.user} s={28} /><div style={{ marginTop: 10 }}>No nursing stations configured.</div></div>
  );

  return (
    <div>
      {/* ── Attention banner — moved to the TOP, collapsed by default ────────── */}
      {attn && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 12, borderColor: "var(--amber)" }}>
          <button onClick={() => setShowAttn(s => !s)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 10,
            padding: "11px 14px", background: "var(--amber-bg)", textAlign: "left", cursor: "pointer",
          }}>
            <span style={{ color: "var(--amber)", display: "flex" }}><Ic d={icons.bell} s={17} /></span>
            <span style={{ fontWeight: 700, fontSize: 13.5, color: "var(--amber)" }}>Needs attention</span>
            <span className="dim" style={{ fontSize: 11.5, color: "var(--amber)" }}>
              {hasNurseGap && `${unassignedNurses.length} nurse${unassignedNurses.length !== 1 ? "s" : ""} without a station`}
              {hasNurseGap && hasWardGap && " · "}
              {hasWardGap && `${unassignedWards.length} ward${unassignedWards.length !== 1 ? "s" : ""} without a station`}
            </span>
            <Ic d={icons.chevron} s={14} style={{ color: "var(--amber)", marginLeft: "auto", transform: showAttn ? "rotate(90deg)" : "none", transition: ".15s" }} />
          </button>
          {showAttn && (
            <div style={{ padding: "12px 14px" }}>
              {hasNurseGap && (
                <div style={{ marginBottom: hasWardGap ? 12 : 0 }}>
                  <div className="dim" style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".04em" }}>Nurses without a station</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {unassignedNurses.map(n => (
                      <span key={n.id} className="chip" style={{ fontSize: 11 }}><Ic d={icons.user} s={11} /> {n.name} <span className="dim">@{n.username}</span></span>
                    ))}
                  </div>
                </div>
              )}
              {hasWardGap && (
                <div>
                  <div className="dim" style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".04em" }}>Wards without a station</div>
                  <WardTableActivity wards={unassignedWards} showUpdatedBy />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="dim" style={{ fontSize: 12, marginBottom: 12 }}>
        {stations.length} nursing station{stations.length !== 1 ? "s" : ""} — tap a station to expand
      </div>

      {/* ── Slim collapsible station rows ────────────────────────────────────── */}
      {stations.map(s => {
        const key = s.id ?? s.name;
        const isOpen = !!expanded[key];
        return (
          <div key={key} className="card" style={{ padding: 0, marginBottom: 8, overflow: "hidden" }}>
            <button onClick={() => toggle(key)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "11px 14px", background: "transparent", textAlign: "left", cursor: "pointer",
            }}>
              <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 9, background: "var(--panel-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic d={icons.user} s={16} style={{ color: "var(--ink-2)" }} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.name}</div>
                <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                  {s.nurses.length} nurse{s.nurses.length !== 1 ? "s" : ""} · {s.wards.length} ward{s.wards.length !== 1 ? "s" : ""}
                </div>
              </div>
              {s.nurses.length === 0 && <span className="tag o">No nurses</span>}
              <Ic d={icons.chevron} s={14} style={{ color: "var(--ink-3)", transform: isOpen ? "rotate(90deg)" : "none", transition: ".15s", flexShrink: 0 }} />
            </button>
            {isOpen && (
              <div style={{ padding: "0 14px 14px" }}>
                {s.nurses.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    {s.nurses.map(n => (
                      <span key={n.id} className="chip" style={{ fontSize: 11 }}><Ic d={icons.user} s={11} /> {n.name} <span className="dim">@{n.username}</span></span>
                    ))}
                  </div>
                )}
                {s.wards.length > 0
                  ? <WardTableActivity wards={s.wards} showUpdatedBy />
                  : <div className="dim" style={{ fontSize: 12 }}>No wards assigned to this station.</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Shared ward table for activity page — extends WardTable with Last Updated column
function WardTableActivity({ wards, showUpdatedBy = false }) {
  const hdr = { fontSize: 9, fontWeight: 700, padding: "5px 8px", textAlign: "center", letterSpacing: 0.3 };
  const cell = { padding: "6px 8px", textAlign: "center", fontSize: 12 };
  const div = "1px solid var(--line)";

  return (
    <div className="tbl-scroll" style={{ marginTop: 8, borderRadius: 8, border: div }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
        <thead>
          <tr>
            <th style={{ ...hdr, textAlign: "left", background: "var(--panel-2)", borderRight: div }}>WARD</th>
            <th style={{ ...hdr, background: "var(--panel-2)", borderRight: div }}>TOTAL</th>
            <th style={{ ...hdr, color: "var(--st-o)", background: "var(--st-o-bg)", borderRight: div }}>TOTAL OCC</th>
            <th style={{ ...hdr, color: "var(--st-o)", background: "var(--st-o-bg)" }}>ON BED</th>
            <th style={{ ...hdr, color: "var(--st-or)", background: "var(--st-or-bg)", borderRight: div }}>OCC[RES]</th>
            <th style={{ ...hdr, color: "var(--st-v)", background: "var(--st-v-bg)", borderRight: div }}>TOTAL VAC</th>
            <th style={{ ...hdr, color: "var(--st-v)", background: "var(--st-v-bg)" }}>VACANT</th>
            <th style={{ ...hdr, color: "var(--st-vr)", background: "var(--st-vr-bg)", borderRight: div }}>VAC[RES]</th>
            <th style={{ ...hdr, background: "var(--panel-2)", borderRight: showUpdatedBy ? div : "none" }}>LAST UPDATE</th>
            {showUpdatedBy && <th style={{ ...hdr, background: "var(--panel-2)" }}>UPDATED BY</th>}
          </tr>
        </thead>
        <tbody>
          {wards.map((w, j) => {
            const reported = w.vacant !== null && w.vacant !== undefined;
            const o = w.occupied || 0;
            const or_ = w.occupied_reserved || 0;
            const v = w.vacant || 0;
            const r = w.reserved || 0;
            const d = (n) => reported ? n : <span className="dim">–</span>;
            return (
              <tr key={j} style={{ background: j % 2 ? "var(--panel-2)" : "transparent" }}>
                <td style={{ ...cell, textAlign: "left", fontWeight: 600, borderRight: div, whiteSpace: "nowrap" }}>{w.ward}</td>
                <td style={{ ...cell, fontWeight: 700, borderRight: div }}>{w.total || 0}</td>
                <td style={{ ...cell, color: "var(--st-o)", fontWeight: 700, borderRight: div }}>{d(o + or_)}</td>
                <td style={{ ...cell, color: "var(--st-o)" }}>{d(o)}</td>
                <td style={{ ...cell, color: "var(--st-or)", borderRight: div }}>{d(or_)}</td>
                <td style={{ ...cell, color: "var(--st-v)", fontWeight: 700, borderRight: div }}>{d(v + r)}</td>
                <td style={{ ...cell, color: "var(--st-v)" }}>{d(v)}</td>
                <td style={{ ...cell, color: "var(--st-vr)", borderRight: div }}>{d(r)}</td>
                <td style={{ ...cell, borderRight: showUpdatedBy ? div : "none", whiteSpace: "nowrap" }}>
                  <LastUpdatedCell ts={w.updatedAt} />
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
  const [openBlocks, setOpenBlocks] = useState(() => new Set());
  const toggleBlock = (k) => setOpenBlocks((prev) => { const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s; });

  const stale = [];
  for (const f of data.floors) for (const p of f.pres)
    for (const w of p.wards || []) {
      const ts = toMs(w.updatedAt);
      if (w.vacant !== null && ts && now - ts > STALE_MS)
        stale.push({ pre: p.pre, ward: w.ward, updatedAt: ts });
    }
  stale.sort((a, b) => a.updatedAt - b.updatedAt);

  // Group stale wards by PRE block so the list collapses from dozens of rows to
  // one row per block (expandable), sorted by the most overdue block first.
  const staleByBlock = new Map();
  for (const s of stale) { if (!staleByBlock.has(s.pre)) staleByBlock.set(s.pre, []); staleByBlock.get(s.pre).push(s); }
  const staleGroups = [...staleByBlock.entries()]
    .map(([pre, wards]) => ({ pre, wards, count: wards.length, oldest: wards[0].updatedAt }))
    .sort((a, b) => a.oldest - b.oldest);

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
          <div className="row between" style={{ padding: "12px 14px", background: "var(--red-bg)", flexWrap: "wrap", gap: 6 }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ color: "var(--red)" }}><Ic d={icons.bell} s={17} /></span>
              <span style={{ fontWeight: 700, fontSize: 14, color: "var(--red)" }}>
                {stale.length} ward{stale.length > 1 ? "s" : ""} not updated in over 3 hours
              </span>
            </div>
            <span className="dim" style={{ fontSize: 11.5, color: "var(--red)" }}>across {staleGroups.length} PRE block{staleGroups.length > 1 ? "s" : ""}</span>
          </div>
          <div style={{ padding: "0 14px" }}>
            {staleGroups.map((g, i) => {
              const open = openBlocks.has(g.pre);
              return (
                <div key={g.pre} style={{ borderBottom: i < staleGroups.length - 1 ? "1px solid var(--line)" : "none" }}>
                  <button onClick={() => toggleBlock(g.pre)} style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10,
                    padding: "11px 0", background: "transparent", textAlign: "left", cursor: "pointer",
                  }}>
                    <Ic d={icons.chevron} s={14} style={{ color: "var(--ink-3)", transform: open ? "rotate(90deg)" : "none", transition: ".15s", flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{g.pre}</span>
                    <span className="tag or" style={{ marginLeft: 2 }}>{g.count} stale</span>
                    <span className="dim" style={{ fontSize: 11, marginLeft: "auto" }}>oldest {fmtTime(g.oldest)}</span>
                  </button>
                  {open && (
                    <div style={{ paddingLeft: 24 }}>
                      {g.wards.map((s, j) => (
                        <div key={j} className="row between" style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                          <span style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 600 }}>{s.ward}</span>
                          <span className="dim" style={{ fontSize: 11 }}>Last updated {fmtTime(s.updatedAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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
//  ACTIVITY HISTORY — unified, filterable, paginated log of every PRE/Nurse/
//  Manager/Admin move (backed by /coo/activity). Replaces the old flat Audit Log.
// ══════════════════════════════════════════════════════════════════════════════
const ACT_CATS = [
  { key: "bed", label: "Bed updates", color: "var(--st-o)", icon: icons.bed },
  { key: "round", label: "Rounds", color: "var(--blue)", icon: icons.clock },
  { key: "config", label: "Config", color: "var(--amber)", icon: icons.settings },
  { key: "login", label: "Logins", color: "var(--ink-3)", icon: icons.user },
];
const ACT_ROLES = [
  { key: "PRE", label: "PRE", color: "var(--blue)" },
  { key: "NURSE", label: "Nurse", color: "var(--green)" },
  { key: "COO", label: "Admin", color: "var(--primary)" },
];
const ACT_BED = ["bed_status_update", "bed_add", "bed_delete", "bed_rename", "beds_generate", "bed_master_edit", "ward_update"];
const ACT_LOGIN = ["login", "login_failed"];
function actCategory(action) {
  if (ACT_BED.includes(action)) return "bed";
  if (action === "round_submit") return "round";
  if (ACT_LOGIN.includes(action)) return "login";
  return "config";
}
function bedStateText(p, res) {
  if (p === "OCCUPIED") return res === "RESERVED" ? "Occ + Res" : "Occupied";
  if (p === "VACANT") return res === "RESERVED" ? "Vac + Res" : "Vacant";
  return p || "—";
}

// Reusable numbered pagination (Prev · 1 2 … N · Next), shared by Activity + Bed History.
// Friendly (non-raw) detail panel — renders the server-resolved `info` list.
function ActivityDetail({ r }) {
  const info = Array.isArray(r.info) ? r.info : [];
  return (
    <div style={{ padding: "0 14px 12px 60px", borderTop: "1px solid var(--line)" }}>
      <div className="dim" style={{ fontSize: 11, margin: "8px 0 6px" }}>{fmtDateTime(r.ts)} IST · @{r.username || "—"}</div>
      {info.length ? info.map((it, i) => (
        <div key={i} className="row" style={{ gap: 10, fontSize: 12.5, padding: "3px 0", alignItems: "baseline" }}>
          <span className="dim" style={{ minWidth: 96, flexShrink: 0 }}>{it.label}</span>
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>{it.value}</span>
        </div>
      )) : <div className="dim" style={{ fontSize: 12 }}>No additional detail recorded.</div>}
    </div>
  );
}

function ActivityRow({ r, open, onToggle }) {
  const cat = actCategory(r.action);
  const cm = ACT_CATS.find(c => c.key === cat) || ACT_CATS[3];
  const rm = ACT_ROLES.find(x => x.key === r.role);
  const who = r.name || r.username || (r.action === "login_failed" ? "Unknown" : "System");
  const chg = r.change;
  const failed = r.action === "login_failed";
  const showWard = r.wardName && r.wardName !== r.target;

  return (
    <div className="card" style={{ padding: 0, marginBottom: 8, overflow: "hidden", borderColor: failed ? "var(--red)" : undefined }}>
      <button onClick={onToggle} style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%",
        padding: "12px 14px", textAlign: "left", background: "transparent",
      }}>
        {/* category dot */}
        <span style={{
          flexShrink: 0, width: 34, height: 34, borderRadius: 10,
          background: (failed ? "var(--red)" : cm.color) + "1c",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Ic d={cm.icon} s={17} style={{ color: failed ? "var(--red)" : cm.color }} />
        </span>

        {/* main */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{who}</span>
            {rm && <span className="role-badge" style={{
              fontSize: 10, padding: "2px 7px", background: rm.color + "1c", color: rm.color, borderColor: rm.color + "44",
            }}>{rm.label}</span>}
            <span style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 600 }}>{actionLabel(r.action)}</span>
            {r.target && <span className="dim" style={{ fontSize: 12 }}>
              · <strong style={{ color: "var(--ink-2)" }}>{r.target}</strong>{showWard ? ` · ${r.wardName}` : ""}
            </span>}
          </div>

          {chg && (
            <div className="row" style={{ gap: 6, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
              <span className="chip" style={{ fontSize: 10 }}>{bedStateText(chg.from.physical, chg.from.reservation)}</span>
              <Ic d={icons.chevron} s={12} style={{ color: "var(--ink-3)" }} />
              <span className="chip" style={{ fontSize: 10, color: "var(--st-o)", borderColor: "var(--st-o)" }}>{bedStateText(chg.to.physical, chg.to.reservation)}</span>
              {r.note && <span className="dim" style={{ fontSize: 11, fontWeight: 600 }}>· {r.note}</span>}
            </div>
          )}
        </div>

        {/* time */}
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div className="dim" style={{ fontSize: 12 }} title={fmtDateTime(r.ts) + " IST"}>{fmtRelative(r.ts)}</div>
          <Ic d={icons.chevron} s={13} style={{ color: "var(--ink-3)", transform: open ? "rotate(90deg)" : "none", transition: ".15s" }} />
        </div>
      </button>

      {open && <ActivityDetail r={r} />}
    </div>
  );
}

function ActivityHistoryPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [roles, setRoles] = useState(["PRE", "NURSE"]);
  const [cats, setCats] = useState(["bed", "round"]);
  const [userId, setUserId] = useState("");
  const [users, setUsers] = useState([]);
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const PER_PAGE = 25;

  useEffect(() => {
    api.mgrUsers()
      .then(d => setUsers((d.users || []).filter(u => u.role === "PRE" || u.role === "NURSE")))
      .catch(() => { });
  }, []);

  useEffect(() => { const t = setTimeout(() => setDebQ(q), 350); return () => clearTimeout(t); }, [q]);

  const dayMs = (s, end) => {
    if (!s) return undefined;
    const dt = new Date(s + "T00:00:00");
    if (isNaN(dt.getTime())) return undefined;
    return end ? dt.getTime() + 86400000 - 1 : dt.getTime();
  };

  const fetchPage = useCallback((p) => {
    setLoading(true);
    setOpen(new Set());
    api.cooActivity({
      roles, categories: cats,
      userId: userId || undefined,
      q: debouncedQ || undefined,
      from: dayMs(from, false), to: dayMs(to, true),
      page: p, limit: PER_PAGE,
    })
      .then(d => { setRows(d.rows || []); setPage(d.page || 1); setPages(d.pages || 1); setTotal(d.total || 0); })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [roles, cats, userId, debouncedQ, from, to]);

  // Any filter change resets to page 1.
  useEffect(() => { fetchPage(1); }, [fetchPage]);

  const goPage = (p) => { window.scrollTo({ top: 0, behavior: "smooth" }); fetchPage(p); };

  const toggleArr = (arr, set, key) => set(arr.includes(key) ? arr.filter(x => x !== key) : [...arr, key]);
  const toggleOpen = (id) => setOpen(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const resetFilters = () => { setQ(""); setFrom(""); setTo(""); setRoles(["PRE", "NURSE"]); setCats(["bed", "round"]); setUserId(""); };

  const exportCsv = () => {
    const head = ["Time (IST)", "Role", "User", "Action", "Target", "Ward", "Detail"];
    const esc = (c) => `"${String(c ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")];
    for (const r of (rows || []))
      lines.push([
        fmtDateTime(r.ts), r.role || "", r.name || r.username || "", actionLabel(r.action),
        r.target || "", r.wardName || "",
        (r.info || []).map(i => `${i.label}: ${i.value}`).join("; "),
      ].map(esc).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const chipBtn = (active, color, label, icon, onClick) => (
    <button key={label} onClick={onClick} className="chip" style={{
      fontSize: 12, padding: "6px 12px", cursor: "pointer", fontWeight: 700,
      background: active ? color : "var(--panel)",
      borderColor: active ? color : "var(--line)",
      color: active ? "#fff" : "var(--ink-2)",
    }}>
      {active ? <Ic d={icons.check} s={13} /> : (icon && <Ic d={icon} s={13} />)}{label}
    </button>
  );

  return (
    <div>
      <div className="row between" style={{ alignItems: "flex-start", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="h1" style={{ fontSize: 18, marginBottom: 2 }}>Activity History</div>
          <div className="dim" style={{ fontSize: 13 }}>Every move by PRE, Nurse, Manager &amp; Admin — filter, search and review.</div>
        </div>
        <button className="btn ghost" onClick={exportCsv} disabled={!rows || rows.length === 0} style={{ fontSize: 13 }}>
          <Ic d={icons.layers} s={15} /> Export CSV
        </button>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="row" style={{ gap: 8, position: "relative" }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }}><Ic d={icons.search} s={16} /></span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, ward, bed or action…"
            style={{ width: "100%", padding: "10px 12px 10px 36px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 14 }} />
        </div>

        <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div className="dim" style={{ fontSize: 11, fontWeight: 700, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".04em" }}>Role</div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {ACT_ROLES.map(r => chipBtn(roles.includes(r.key), r.color, r.label, null, () => toggleArr(roles, setRoles, r.key)))}
            </div>
          </div>
          <div>
            <div className="dim" style={{ fontSize: 11, fontWeight: 700, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".04em" }}>Type</div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {ACT_CATS.map(c => chipBtn(cats.includes(c.key), c.color, c.label, c.icon, () => toggleArr(cats, setCats, c.key)))}
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ fontSize: 12 }}>
            <div className="dim" style={{ fontSize: 11, fontWeight: 700, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".04em" }}>From</div>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)" }} />
          </label>
          <label style={{ fontSize: 12 }}>
            <div className="dim" style={{ fontSize: 11, fontWeight: 700, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".04em" }}>To</div>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)" }} />
          </label>
          <label style={{ fontSize: 12 }}>
            <div className="dim" style={{ fontSize: 11, fontWeight: 700, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".04em" }}>Person</div>
            <select value={userId} onChange={e => setUserId(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", minWidth: 180 }}>
              <option value="">All people</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
            </select>
          </label>
          <button className="btn ghost" onClick={resetFilters} style={{ fontSize: 13 }}>
            <Ic d={icons.refresh} s={14} /> Reset
          </button>
        </div>
      </div>

      {/* ── Results ────────────────────────────────────────────────────── */}
      {rows === null ? (
        <div className="empty"><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={24} /></span></div>
      ) : rows.length === 0 ? (
        <div className="card empty">
          <Ic d={icons.list} s={28} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>No activity matches these filters</div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>Try widening the date range or clearing filters.</div>
        </div>
      ) : (
        <>
          <div className="row between" style={{ fontSize: 12, marginBottom: 10 }}>
            <span className="dim">
              Page <strong style={{ color: "var(--ink)" }}>{page}</strong> of {pages} · {total} {total === 1 ? "event" : "events"}
            </span>
            {loading && <span className="dim">Loading…</span>}
          </div>
          <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity .15s" }}>
            {rows.map(r => <ActivityRow key={r.id} r={r} open={open.has(r.id)} onToggle={() => toggleOpen(r.id)} />)}
          </div>
          <Pagination page={page} pages={pages} onPage={goPage} />
        </>
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
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>Dashboards update in real time as changes happen (live WebSocket).</div>
          </div>
          <span className="tag v">Active</span>
        </div>
      </div>
    </div>
  );
}

// COO Overview — clean executive summary. Honors the date selector: when a past
// date is chosen, totals are computed from that day's submitted rounds.
function Overview({ data, compliance, selDate, history, onViewBeds, discharge }) {
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
        <div className="stat"><div className="n" style={{ color: "var(--st-v)" }}>{t.v}</div><div className="l">VACANT</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--st-vr)" }}>{t.r}</div><div className="l">VACANT + RESERVED</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--st-o)" }}>{t.o}</div><div className="l">OCCUPIED</div></div>
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

      {isLive && discharge && (
        <>
          <div className="floor-head" style={{ marginTop: 14 }}>Discharge workflow</div>
          <div className="stat-grid">
            <div className="stat"><div className="n">{discharge.plannedToday}</div><div className="l">PLANNED TODAY</div></div>
            <div className="stat"><div className="n">{discharge.plannedTomorrow}</div><div className="l">PLANNED TOMORROW</div></div>
            <div className="stat"><div className="n" style={{ color: "var(--primary)" }}>{discharge.initiated}</div><div className="l">INITIATED</div></div>
            <div className="stat"><div className="n">{discharge.drugReturnPending}</div><div className="l">DRUG RETURN PENDING</div></div>
            <div className="stat"><div className="n">{discharge.pharmacyPending}</div><div className="l">PHARMACY PENDING</div></div>
            <div className="stat"><div className="n">{discharge.procedurePending}</div><div className="l">PROCEDURE PENDING</div></div>
            <div className="stat"><div className="n">{discharge.billingStarted}</div><div className="l">BILLING STARTED</div></div>
            <div className="stat"><div className="n">{discharge.auditPending}</div><div className="l">AUDIT PENDING</div></div>
            <div className="stat"><div className="n">{discharge.billReady}</div><div className="l">BILL READY</div></div>
            <div className="stat"><div className="n">{discharge.paymentPending}</div><div className="l">PAYMENT PENDING</div></div>
            <div className="stat"><div className="n">{discharge.systemCheckoutPending}</div><div className="l">SYSTEM CHECKOUT PENDING</div></div>
            <div className="stat"><div className="n">{discharge.physicalCheckoutPending}</div><div className="l">PHYSICAL CHECKOUT PENDING</div></div>
            <div className="stat"><div className="n" style={{ color: "var(--st-o)" }}>{discharge.awaitingPatientLeave}</div><div className="l">AWAITING PATIENT LEAVE</div></div>
            <div className="stat"><div className="n" style={{ color: "var(--st-v)" }}>{discharge.completedToday}</div><div className="l">COMPLETED TODAY</div></div>
            {discharge.overduePlanned > 0 && (
              <div className="stat"><div className="n" style={{ color: "var(--st-or)" }}>{discharge.overduePlanned}</div><div className="l">OVERDUE PLANNED</div></div>
            )}
          </div>
        </>
      )}

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
                    { label: "Vacant", val: s.v, color: "var(--st-v)" },
                    { label: "V+R", val: s.r, color: "var(--st-vr)" },
                    { label: "Occupied", val: s.o, color: "var(--st-o)" },
                    { label: "Occ+Res", val: s.or || 0, color: "var(--st-or)" },
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
    api.cooLiveWards().then(setLiveWards).catch(() => { });
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
  const [views, setViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(() => {
    const stored = localStorage.getItem(`coo_last_view_${userId}`);
    return stored ? Number(stored) : null;
  });
  const [viewModal, setViewModal] = useState(null); // null | { mode:"new"|"edit", view?:obj }
  const [viewToast, setViewToast] = useState("");
  const [confirm, confirmDialog] = useConfirm();

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
  const myViews = views.filter(v => !v.is_system && !v.is_shared);

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
          v += h.vacant || 0;
          r += h.reserved || 0;
          o += h.occupied || 0;
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
  const grandV = rows.reduce((a, r) => a + r.v, 0);
  const grandR = rows.reduce((a, r) => a + r.r, 0);
  const grandO = rows.reduce((a, r) => a + r.o, 0);
  const grandOR = rows.reduce((a, r) => a + r.or, 0);
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
              <th style={{ ...thStyle("var(--st-o)"), background: "var(--st-o-bg)" }}>Total Occ</th>
              <th style={{ ...thStyle("var(--st-o)"), background: "var(--st-o-bg)" }}>On Bed</th>
              <th style={{ ...thStyle("var(--st-or)"), background: "var(--st-or-bg)" }}>Occ[Res]</th>
              {/* Vacant group */}
              <th style={{ ...thStyle("var(--st-v)"), background: "var(--st-v-bg)" }}>Total Vac</th>
              <th style={{ ...thStyle("var(--st-v)"), background: "var(--st-v-bg)" }}>Vacant</th>
              <th style={{ ...thStyle("var(--st-vr)"), background: "var(--st-vr-bg)" }}>Vac[Res]</th>
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
                    <td style={tdStyle("var(--st-o)", stripe)}>{d(row.o + row.or, "var(--st-o)")}</td>
                    <td style={tdStyle("var(--st-o)", stripe)}>{d(row.o, "var(--st-o)")}</td>
                    <td style={tdStyle("var(--st-or)", stripe)}>{d(row.or, "var(--st-or)")}</td>
                    <td style={tdStyle("var(--st-v)", stripe)}>{d(row.v + row.r, "var(--st-v)")}</td>
                    <td style={tdStyle("var(--st-v)", stripe)}>{d(row.v, "var(--st-v)")}</td>
                    <td style={tdStyle("var(--st-vr)", stripe)}>{d(row.r, "var(--st-vr)")}</td>
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
                  [grandO, "var(--st-o)"],
                  [grandOR, "var(--st-or)"],
                  [grandTotalVac, "var(--st-v)"],
                  [grandV, "var(--st-v)"],
                  [grandR, "var(--st-vr)"],
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

// ══════════════════════════════════════════════════════════════════════════════
//  MIDNIGHT CENSUS MATRIX — same matrix-style table/filter/saved-views UX as
//  Hospital Matrix, but sourced from stored midnight_census snapshots instead
//  of PRE round history. Saved views here use source:"midnight_census" so
//  they never mix with Hospital Matrix's saved views.
// ══════════════════════════════════════════════════════════════════════════════
function MidnightCensusMatrix({ userId }) {
  // ── Date selector — "live" or a captured census date ──────────────────────
  const [censusDates, setCensusDates] = useState([]);
  const [selDate, setSelDate] = useState("live");
  useEffect(() => { api.mgrCensusDates().then((d) => setCensusDates(d.dates || [])).catch(() => { }); }, []);
  const isLive = selDate === "live";

  const fmtDateLabel = (d) => {
    const dt = new Date(d + "T00:00:00");
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };

  // ── Live ward data (same source as Hospital Matrix) ────────────────────────
  const [liveWards, setLiveWards] = useState(null);
  useEffect(() => {
    if (!isLive) { setLiveWards(null); return; }
    api.cooLiveWards().then(setLiveWards).catch(() => { });
  }, [isLive]);

  // ── Historical census snapshot for the selected date ───────────────────────
  const [censusSnapshot, setCensusSnapshot] = useState(null);
  const [loadingCensus, setLoadingCensus] = useState(false);
  useEffect(() => {
    if (isLive) { setCensusSnapshot(null); return; }
    setLoadingCensus(true);
    api.mgrHistory(selDate).then((d) => setCensusSnapshot(d.census || null))
      .catch(() => setCensusSnapshot(null))
      .finally(() => setLoadingCensus(false));
  }, [isLive, selDate]);

  // ── Ward filter ──────────────────────────────────────────────────────────
  const [selectedWards, setSelectedWards] = useState(() => {
    try { return JSON.parse(localStorage.getItem("coo_census_matrix_order") || "[]"); }
    catch { return []; }
  });
  const [filterOpen, setFilterOpen] = useState(false);
  useEffect(() => {
    localStorage.setItem("coo_census_matrix_order", JSON.stringify(selectedWards));
  }, [selectedWards]);
  const toggleWard = (ward) => setSelectedWards((prev) =>
    prev.includes(ward) ? prev.filter((w) => w !== ward) : [...prev, ward]
  );
  const showAllWards = () => setSelectedWards([]);

  // ── Saved Views (source: midnight_census) ──────────────────────────────────
  const [views, setViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(() => {
    const stored = localStorage.getItem(`coo_last_census_view_${userId}`);
    return stored ? Number(stored) : null;
  });
  const [viewModal, setViewModal] = useState(null);
  const [viewToast, setViewToast] = useState("");
  const [confirm, confirmDialog] = useConfirm();
  const showVToast = (m) => { setViewToast(m); setTimeout(() => setViewToast(""), 2200); };

  const loadViews = async () => {
    try { setViews((await api.cooViews("midnight_census")).views || []); }
    catch { /* non-fatal */ }
  };
  useEffect(() => { loadViews(); }, []);

  useEffect(() => {
    if (activeViewId == null) return;
    const v = views.find(x => x.id === activeViewId);
    if (v) setSelectedWards(v.selected_wards || []);
  }, [activeViewId, views]);

  useEffect(() => {
    if (userId == null) return;
    if (activeViewId != null)
      localStorage.setItem(`coo_last_census_view_${userId}`, String(activeViewId));
    else
      localStorage.removeItem(`coo_last_census_view_${userId}`);
  }, [activeViewId, userId]);

  const handleToggleWard = (ward) => { setActiveViewId(null); toggleWard(ward); };
  const handleShowAllWards = () => { setActiveViewId(null); showAllWards(); };

  const activeView = activeViewId != null ? views.find(v => v.id === activeViewId) : null;
  const systemViews = views.filter(v => v.is_system);
  const sharedViews = views.filter(v => !v.is_system && v.is_shared);
  const myViews = views.filter(v => !v.is_system && !v.is_shared);

  // ── Data build ───────────────────────────────────────────────────────────
  const sourceWards = isLive
    ? (liveWards?.wards || [])
    : (Array.isArray(censusSnapshot?.wards) ? censusSnapshot.wards : []);

  const wardTypes = [...new Set(sourceWards.map(w => w.ward))].sort();

  const allRows = wardTypes.map((ward) => {
    const w = sourceWards.find(x => x.ward === ward);
    const hasData = !!w && w.vacant !== null;
    return {
      ward,
      v: hasData ? (w.vacant || 0) : 0,
      r: hasData ? (w.reserved || 0) : 0,
      o: hasData ? (w.occupied || 0) : 0,
      or: hasData ? (w.occupied_reserved || 0) : 0,
      hasData,
    };
  });

  const isFiltered = selectedWards.length > 0;
  const rows = isFiltered
    ? selectedWards.map((ward) => allRows.find((r) => r.ward === ward)).filter(Boolean)
    : allRows;
  const visibleCount = isFiltered ? selectedWards.length : wardTypes.length;
  const grandV = rows.reduce((a, r) => a + r.v, 0);
  const grandR = rows.reduce((a, r) => a + r.r, 0);
  const grandO = rows.reduce((a, r) => a + r.o, 0);
  const grandOR = rows.reduce((a, r) => a + r.or, 0);
  const grandTotalOcc = grandO + grandOR;
  const grandTotalVac = grandV + grandR;

  // ── Styles (identical to Hospital Matrix) ───────────────────────────────────
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

  const snapshotRef = useRef(null);
  const viewLabel = activeView ? activeView.name : (isFiltered ? "Custom selection" : "All wards");
  const noDataYet = !isLive && !loadingCensus && !censusSnapshot;

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>Midnight Census</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 12 }}>
        {isLive
          ? `All bed states by ward · current live counts · updated ${fmtTime(Date.now())}.`
          : `Midnight census captured ${fmtDateLabel(selDate)}.`}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label className="label">Census date</label>
        <select className="field" value={selDate} onChange={(e) => setSelDate(e.target.value)}>
          <option value="live">Current (Live)</option>
          {censusDates.map((d) => <option key={d} value={d}>{fmtDateLabel(d)}</option>)}
        </select>
      </div>

      <SnapshotActions target={snapshotRef} onToast={showVToast} />

      {/* ── Saved Views selector ─────────────────────────────────────────── */}
      <div className="card" style={{ padding: "10px 12px", marginBottom: 10 }}>
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

      {/* ── Ward filter panel ──────────────────────────────────────────────── */}
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
              <th style={{ ...thStyle("var(--st-o)"), background: "var(--st-o-bg)" }}>Total Occ</th>
              <th style={{ ...thStyle("var(--st-o)"), background: "var(--st-o-bg)" }}>On Bed</th>
              <th style={{ ...thStyle("var(--st-or)"), background: "var(--st-or-bg)" }}>Occ[Res]</th>
              <th style={{ ...thStyle("var(--st-v)"), background: "var(--st-v-bg)" }}>Total Vac</th>
              <th style={{ ...thStyle("var(--st-v)"), background: "var(--st-v-bg)" }}>Vacant</th>
              <th style={{ ...thStyle("var(--st-vr)"), background: "var(--st-vr-bg)" }}>Vac[Res]</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "24px 16px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
                  {isLive && !liveWards ? "Loading…" : noDataYet ? "No midnight census captured for this date." : loadingCensus ? "Loading…" : "No data available."}
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
                    <td style={tdStyle("var(--st-o)", stripe)}>{d(row.o + row.or, "var(--st-o)")}</td>
                    <td style={tdStyle("var(--st-o)", stripe)}>{d(row.o, "var(--st-o)")}</td>
                    <td style={tdStyle("var(--st-or)", stripe)}>{d(row.or, "var(--st-or)")}</td>
                    <td style={tdStyle("var(--st-v)", stripe)}>{d(row.v + row.r, "var(--st-v)")}</td>
                    <td style={tdStyle("var(--st-v)", stripe)}>{d(row.v, "var(--st-v)")}</td>
                    <td style={tdStyle("var(--st-vr)", stripe)}>{d(row.r, "var(--st-vr)")}</td>
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
                  [grandO, "var(--st-o)"],
                  [grandOR, "var(--st-or)"],
                  [grandTotalVac, "var(--st-v)"],
                  [grandV, "var(--st-v)"],
                  [grandR, "var(--st-vr)"],
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

      {viewModal && (
        <SaveViewModal
          mode={viewModal.mode}
          existingView={viewModal.view}
          currentWards={selectedWards}
          wardTypes={wardTypes}
          source="midnight_census"
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

function SaveViewModal({ mode, existingView, currentWards, wardTypes, source = "matrix", onClose, onSaved }) {
  useModal(onClose);
  const isNew = mode === "new";
  const [name, setName] = useState(existingView?.name || "");
  const [isShared, setIsShared] = useState(existingView?.is_shared ?? false);
  const [selWards, setSelWards] = useState(
    isNew ? [...currentWards] : [...(existingView?.selected_wards || [])]
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const toggleW = (w) => setSelWards((prev) =>
    prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w]
  );

  const save = async () => {
    if (!name.trim()) { setErr("View name required"); return; }
    setBusy(true);
    try {
      let newId = null;
      if (isNew) {
        const r = await api.cooSaveView({ name: name.trim(), selected_wards: selWards, is_shared: isShared, source });
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
            <button className={isShared ? "on" : ""} onClick={() => setIsShared(true)}>Shared (all Admins)</button>
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
          { label: "On Bed", val: grandO, color: C.orange },
          { label: "Total Vacant", val: grandTotalVac, color: C.green },
          { label: "Vac+Res", val: grandR, color: C.blue },
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
              <th style={th(C.purple, "#f5f3ff")}>Occ[Res]</th>
              <th style={th(C.green, "#f0fdf4")}>Total Vac</th>
              <th style={th(C.green, "#f0fdf4")}>Vacant</th>
              <th style={th(C.blue, "#eff6ff")}>Vac[Res]</th>
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
                    <td style={td(C.orange, stripe)}>{d(row.o, C.orange)}</td>
                    <td style={td(C.purple, stripe)}>{d(row.or, C.purple)}</td>
                    <td style={td(C.green, stripe)}>{d(row.v + row.r, C.green)}</td>
                    <td style={td(C.green, stripe)}>{d(row.v, C.green)}</td>
                    <td style={td(C.blue, stripe)}>{d(row.r, C.blue)}</td>
                  </tr>
                );
              })
            )}
            {rows.length > 0 && (
              <tr style={{ background: C.panel2 }}>
                <td style={{ padding: "11px 14px", fontWeight: 800, color: C.tealDeep, borderTop: `2px solid ${C.line}` }}>Total</td>
                {[
                  [grandTotalOcc, C.orange],
                  [grandO, C.orange],
                  [grandOR, C.purple],
                  [grandTotalVac, C.green],
                  [grandV, C.green],
                  [grandR, C.blue],
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
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");

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
  const counts = { vn: 0, vr: 0, on_: 0 };
  for (const b of allBeds) {
    if (b.physical_status === "VACANT" && b.reservation_status === "NONE") counts.vn++;
    else if (b.physical_status === "VACANT" && b.reservation_status === "RESERVED") counts.vr++;
    else if (b.physical_status === "OCCUPIED") counts.on_++;
  }

  function stateColor(p, r) {
    if (p === "VACANT" && r === "RESERVED") return "var(--st-vr)";
    if (p === "VACANT") return "var(--st-v)";
    if (p === "OCCUPIED") return "var(--st-o)";
    return "var(--ink-3)";
  }
  function stateBg(p, r) {
    if (p === "VACANT" && r === "RESERVED") return "var(--st-vr-bg)";
    if (p === "VACANT") return "var(--st-v-bg)";
    if (p === "OCCUPIED") return "var(--st-o-bg)";
    return "var(--panel-2)";
  }
  function stateShort(p, r) {
    if (p === "VACANT" && r === "RESERVED") return "Vac + Res";
    if (p === "VACANT") return "Vacant";
    if (p === "OCCUPIED") return "Occupied";
    return "?";
  }

  const chips = [
    { key: "ALL", label: `All (${allBeds.length})` },
    { key: "V", label: `Vacant (${counts.vn})` },
    { key: "V+R", label: `Vac+Res (${counts.vr})` },
    { key: "O", label: `Occupied (${counts.on_})` },
    { key: "R", label: `Reserved (${counts.vr})` },
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
                  if (filter === "V") return b.physical_status === "VACANT" && b.reservation_status === "NONE";
                  if (filter === "V+R") return b.physical_status === "VACANT" && b.reservation_status === "RESERVED";
                  if (filter === "O") return b.physical_status === "OCCUPIED" && b.reservation_status === "NONE";
                  if (filter === "R") return b.reservation_status === "RESERVED";
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
                      <span className="tag r">{w.reserved} vac[res]</span>
                      <span className="tag o">{w.occupied} occupied</span>
                      {(w.occupied_reserved || 0) > 0 && <span className="tag or">{w.occupied_reserved} occ[res]</span>}
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

// ══════════════════════════════════════════════════════════════════════════════
//  DISCHARGE TAT LEADERBOARD — Feature 3
// ══════════════════════════════════════════════════════════════════════════════

function fmtTatMins(mins) {
  if (mins == null) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function tatColor(mins) {
  if (mins == null) return "var(--ink-3)";
  if (mins <= 180) return "var(--green)";   // within Cash/General 3h
  if (mins <= 210) return "var(--primary)"; // within Corporate/Arogya Sri 3.5h
  if (mins <= 300) return "#d97706";        // within Insurance 5h
  return "var(--red)";
}

function tatColorVsBenchmark(mins, benchmark) {
  if (mins == null || benchmark == null) return "var(--ink-3)";
  if (mins <= benchmark) return "var(--green)";
  if (mins <= benchmark * 1.2) return "#d97706";
  return "var(--red)";
}

const TAT_MEDALS = ["🥇", "🥈", "🥉"];

function TATLeaderboard() {
  const [range, setRange] = useState("7d");
  const [tat, setTat] = useState(null);
  const [err, setErr] = useState("");
  const [view, setView] = useState("doctor");
  const [payerDrill, setPayerDrill] = useState(null);

  useEffect(() => {
    setTat(null);
    api.cooTat(range)
      .then(d => { setTat(d); setErr(""); })
      .catch(e => setErr(toastErr(e)));
  }, [range]);

  const rows = tat
    ? (view === "doctor" ? tat.byDoctor : view === "ward" ? tat.byWard : tat.byPayer)
    : null;
  const targets = tat?.targets ?? {};

  return (
    <div className="slide-up">
      <div className="tat-toolbar">
        <div className="tat-view-chips">
          {[["doctor", "By Doctor"], ["ward", "By Ward"], ["payer", "By Payer"]].map(([k, l]) => (
            <button key={k} className={"fchip" + (view === k ? " on" : "")} onClick={() => setView(k)}
              style={{ padding: "7px 16px", fontSize: 13 }}>
              {l}
            </button>
          ))}
        </div>
        <select className="field" value={range} onChange={(e) => setRange(e.target.value)}
          style={{ width: "auto", padding: "7px 12px", fontWeight: 600 }}>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      {err && <div style={{ color: "var(--red)", fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {!tat && !err && (
        <div className={view === "payer" ? "card-grid" : "card-grid"}>
          {(view === "payer" ? [0, 1, 2, 3, 4] : [0, 1, 2, 3]).map(i => (
            <div key={i} className="preui-sk preui-sk-card" />
          ))}
        </div>
      )}
      {tat && view !== "payer" && rows && rows.length === 0 && (
        <div className="card empty" style={{ padding: 32 }}>
          <Ic d={icons.chart} s={28} />
          <div style={{ fontWeight: 700, fontSize: 14, marginTop: 10 }}>No completed discharges yet</div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            TAT data appears once discharges are fully completed in the selected period.
          </div>
        </div>
      )}
      {rows && rows.length > 0 && view !== "payer" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, color: "var(--ink-2)", fontSize: 11, width: 40 }}>#</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, color: "var(--ink-2)", fontSize: 11 }}>
                    {view === "doctor" ? "DOCTOR" : "WARD"}
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "var(--ink-2)", fontSize: 11 }}>DISCHARGES</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "var(--ink-2)", fontSize: 11 }}>AVG TAT</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "var(--ink-2)", fontSize: 11 }}>BEST</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "var(--ink-2)", fontSize: 11 }}>WORST</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.name} style={{
                    borderBottom: "1px solid var(--line)",
                    background: i % 2 === 0 ? "transparent" : "var(--panel-2)",
                  }}>
                    <td style={{ padding: "12px 16px", fontWeight: 800, fontSize: 14 }}>
                      {i < 3 ? TAT_MEDALS[i] : <span className="dim">{i + 1}</span>}
                    </td>
                    <td style={{ padding: "12px 16px", fontWeight: 700 }}>{r.name}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700 }}>{r.total}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 800, color: tatColor(r.avg_min) }}>
                      {fmtTatMins(r.avg_min)}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--green)", fontWeight: 700 }}>
                      {fmtTatMins(r.best_min)}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--red)", fontWeight: 700 }}>
                      {fmtTatMins(r.worst_min)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tat-legend">
            TAT = time from discharge initiation to full completion. Lower is better. &nbsp;
            <span style={{ color: "var(--green)" }}>●</span> ≤3h (Cash/General) &nbsp;
            <span style={{ color: "var(--primary)" }}>●</span> ≤3.5h (Corporate/Arogya Sri) &nbsp;
            <span style={{ color: "#d97706" }}>●</span> ≤5h (Insurance) &nbsp;
            <span style={{ color: "var(--red)" }}>●</span> &gt;5h
          </div>
        </div>
      )}
      {tat && view === "payer" && (() => {
        // Fixed display order; fall back to whatever came from targets if new types added
        const PAYER_ORDER = ["Cash", "General", "Insurance", "Corporate", "Arogya Sri"];
        const allTypes = [
          ...PAYER_ORDER.filter(p => p in targets),
          ...Object.keys(targets).filter(p => !PAYER_ORDER.includes(p)),
        ];
        const byPayerMap = new Map((tat.byPayer || []).map(r => [r.payer_type, r]));

        return (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
              {allTypes.map(payerType => {
                const r = byPayerMap.get(payerType);
                const bench = targets[payerType] ?? null;
                const hasData = !!r;
                const ok = hasData && bench != null && r.avg_min <= bench;
                const col = hasData ? tatColorVsBenchmark(r.avg_min, bench) : "var(--line)";
                return (
                  <button key={payerType} onClick={() => setPayerDrill(payerType)}
                    className="card slide-up"
                    style={{
                      padding: 16, textAlign: "left", cursor: "pointer", width: "100%",
                      borderColor: col, display: "flex", flexDirection: "column", gap: 10
                    }}>
                    <div className="row between" style={{ alignItems: "flex-start" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{payerType}</div>
                      {hasData && bench != null && (
                        <span style={{
                          fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 99,
                          background: ok ? "var(--st-v-bg)" : "var(--red-bg)",
                          color: ok ? "var(--st-v)" : "var(--red)"
                        }}>
                          {ok ? "On target" : "Over"}
                        </span>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1, color: hasData ? col : "var(--ink-3)" }}>
                        {hasData ? fmtTatMins(r.avg_min) : "—"}
                      </div>
                      <div className="dim" style={{ fontSize: 11, marginTop: 3 }}>avg TAT</div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{hasData ? r.total : "—"}</div>
                        <div className="dim" style={{ fontSize: 10 }}>cases</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: hasData ? "var(--green)" : "var(--ink-3)" }}>
                          {hasData ? fmtTatMins(r.best_min) : "—"}
                        </div>
                        <div className="dim" style={{ fontSize: 10 }}>best</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: hasData ? "var(--red)" : "var(--ink-3)" }}>
                          {hasData ? fmtTatMins(r.worst_min) : "—"}
                        </div>
                        <div className="dim" style={{ fontSize: 10 }}>worst</div>
                      </div>
                      {bench != null && (
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{fmtTatMins(bench)}</div>
                          <div className="dim" style={{ fontSize: 10 }}>target</div>
                        </div>
                      )}
                    </div>
                    <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                      {hasData ? "Tap to see breakdown →" : "No discharges in this period"}
                    </div>
                  </button>
                );
              })}
            </div>
            {payerDrill && (
              <PayerDrillModal payer={payerDrill} range={range} onClose={() => setPayerDrill(null)} />
            )}
          </>
        );
      })()}
    </div>
  );
}

function PayerDrillModal({ payer, range, onClose }) {
  useModal(onClose);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [drillView, setDrillView] = useState("doctor");

  useEffect(() => {
    setData(null); setErr("");
    api.cooTatByPayer(payer, range)
      .then(d => setData(d))
      .catch(e => setErr(toastErr(e)));
  }, [payer, range]);

  const rows = data ? (drillView === "doctor" ? data.byDoctor : data.byWard) : null;
  const bench = data?.targetMinutes ?? null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
        style={{ maxHeight: "88vh", overflowY: "auto" }}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{payer} — TAT Breakdown</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>
          <div className="dim" style={{ fontSize: 12, marginBottom: 16 }}>
            Completed discharges · {range === "today" ? "Today" : range === "7d" ? "Last 7 days" : range === "30d" ? "Last 30 days" : "Last 90 days"}
          </div>

          {data?.summary && (
            <div className="pdr-summary">
              {[
                { label: "Cases", val: data.summary.total, style: {} },
                { label: "Avg TAT", val: fmtTatMins(data.summary.avg_min), style: { color: tatColorVsBenchmark(data.summary.avg_min, bench) } },
                { label: "Best", val: fmtTatMins(data.summary.best_min), style: { color: "var(--green)" } },
                { label: "Worst", val: fmtTatMins(data.summary.worst_min), style: { color: "var(--red)" } },
              ].map(({ label, val, style }) => (
                <div key={label} className="card" style={{ padding: "12px 14px", textAlign: "center" }}>
                  <div style={{ fontWeight: 800, fontSize: 18, ...style }}>{val}</div>
                  <div className="dim" style={{ fontSize: 11, marginTop: 3 }}>{label}</div>
                </div>
              ))}
            </div>
          )}

          {bench != null && (
            <div className="card" style={{
              padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10,
              background: (data?.summary?.avg_min ?? 999) <= bench ? "var(--st-v-bg)" : "var(--red-bg)",
              borderColor: (data?.summary?.avg_min ?? 999) <= bench ? "var(--st-v)" : "var(--red)"
            }}>
              <Ic d={icons.clock} s={16} style={{ color: (data?.summary?.avg_min ?? 999) <= bench ? "var(--st-v)" : "var(--red)" }} />
              <span style={{ fontSize: 13, fontWeight: 700 }}>
                Benchmark: {fmtTatMins(bench)} &nbsp;
                <span className="dim" style={{ fontWeight: 400 }}>
                  {(data?.summary?.avg_min ?? 999) <= bench ? "— avg is within target" : "— avg exceeds target"}
                </span>
              </span>
            </div>
          )}

          <div className="row" style={{ gap: 6, marginBottom: 14 }}>
            {[["doctor", "By Doctor"], ["ward", "By Ward"]].map(([k, l]) => (
              <button key={k} className={"fchip" + (drillView === k ? " on" : "")} onClick={() => setDrillView(k)}
                style={{ padding: "6px 14px", fontSize: 12 }}>{l}</button>
            ))}
          </div>

          {err && <div style={{ color: "var(--red)", fontSize: 12 }}>{err}</div>}
          {!rows && !err && <div className="dim" style={{ textAlign: "center", padding: 24, fontSize: 13 }}>Loading…</div>}
          {rows && rows.length === 0 && (
            <div className="card empty" style={{ padding: 24 }}>
              <Ic d={icons.chart} s={26} />
              <div style={{ fontWeight: 600, marginTop: 8 }}>No data for this period</div>
            </div>
          )}
          {rows && rows.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--ink-2)", fontSize: 11, width: 32 }}>#</th>
                      <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--ink-2)", fontSize: 11 }}>
                        {drillView === "doctor" ? "DOCTOR" : "WARD"}
                      </th>
                      <th style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "var(--ink-2)", fontSize: 11 }}>CASES</th>
                      <th style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "var(--ink-2)", fontSize: 11 }}>AVG TAT</th>
                      <th style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "var(--ink-2)", fontSize: 11 }}>BEST</th>
                      <th style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "var(--ink-2)", fontSize: 11 }}>WORST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.name} style={{ borderBottom: "1px solid var(--line)", background: i % 2 === 0 ? "transparent" : "var(--panel-2)" }}>
                        <td style={{ padding: "10px 14px", fontWeight: 800, fontSize: 13 }}>
                          {i < 3 ? TAT_MEDALS[i] : <span className="dim">{i + 1}</span>}
                        </td>
                        <td style={{ padding: "10px 14px", fontWeight: 700 }}>{r.name}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700 }}>{r.total}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 800, color: tatColorVsBenchmark(r.avg_min, bench) }}>
                          {fmtTatMins(r.avg_min)}
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right", color: "var(--green)", fontWeight: 700 }}>{fmtTatMins(r.best_min)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", color: "var(--red)", fontWeight: 700 }}>{fmtTatMins(r.worst_min)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div style={{ height: 16 }} />
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  OVERSTAY ALERT PANEL — Feature 4
// ══════════════════════════════════════════════════════════════════════════════

function overstayTier(days) {
  const n = Number(days);
  if (n >= 4) return { bg: "var(--red-bg)", color: "var(--red)", label: `${n}d overdue` };
  if (n >= 2) return { bg: "rgba(245,158,11,.12)", color: "#d97706", label: `${n}d overdue` };
  return { bg: "var(--blue-bg)", color: "var(--blue)", label: `${n}d overdue` };
}

export function OverstayPanel({ loadFn = api.cooOverstay }) {
  const [ov, setOv] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    loadFn()
      .then(d => { setOv(d); setErr(""); })
      .catch(e => setErr(toastErr(e)));
  }, [loadFn]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const socket = createSocket();
    const refresh = () => load();
    socket.on("discharge:update", refresh);
    socket.on("discharge:overstay", refresh);
    socket.on("bed:update", refresh);
    socket.on("connect", refresh);
    return () => socket.disconnect();
  }, [load]);

  const fmtPlanDate = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };

  return (
    <div className="slide-up">
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {!ov && !err && (
        <div className="card-grid">{[0, 1, 2].map(i => <div key={i} className="preui-sk preui-sk-card" />)}</div>
      )}
      {ov && (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="row" style={{ gap: 10 }}>
                <span className="ic" style={{ background: ov.total ? "var(--red-bg)" : "var(--panel-2)", color: ov.total ? "var(--red)" : "var(--ink-3)" }}>
                  <Ic d={icons.alert} s={16} />
                </span>
                <div className="n" style={{ fontSize: 18, color: ov.total ? "var(--red)" : undefined }}>{ov.total}</div>
              </div>
              <div className="l">TOTAL OVERSTAY</div>
            </div>
            <div className="stat">
              <div className="row" style={{ gap: 10 }}>
                <span className="ic" style={{ background: "var(--blue-bg)", color: "var(--blue)" }}>
                  <Ic d={icons.clock} s={16} />
                </span>
                <div className="n" style={{ fontSize: 18 }}>{ov.tier1}</div>
              </div>
              <div className="l">1 DAY OVER</div>
            </div>
            <div className="stat">
              <div className="row" style={{ gap: 10 }}>
                <span className="ic" style={{ background: "rgba(245,158,11,.12)", color: "#d97706" }}>
                  <Ic d={icons.alert} s={16} />
                </span>
                <div className="n" style={{ fontSize: 18 }}>{ov.tier2}</div>
              </div>
              <div className="l">2–3 DAYS OVER</div>
            </div>
            <div className="stat">
              <div className="row" style={{ gap: 10 }}>
                <span className="ic" style={{ background: "var(--red-bg)", color: "var(--red)" }}>
                  <Ic d={icons.alert} s={16} />
                </span>
                <div className="n" style={{ fontSize: 18, color: ov.tier3 ? "var(--red)" : undefined }}>{ov.tier3}</div>
              </div>
              <div className="l">4+ DAYS OVER</div>
            </div>
            <div className="stat" style={{ justifyContent: "center" }}>
              <button className="btn" onClick={load} style={{ gap: 6 }}>
                <Ic d={icons.refresh} s={14} /> Refresh
              </button>
            </div>
          </div>

          {ov.rows.length === 0 ? (
            <div className="card empty" style={{ padding: 32 }}>
              <Ic d={icons.check} s={28} />
              <div style={{ fontWeight: 700, fontSize: 14, marginTop: 10 }}>No overstay patients</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>No one's been waiting on Physical Checkout for over an hour after System Checkout.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ov.rows.map((r) => {
                const tier = overstayTier(r.days_overdue);
                return (
                  <div key={r.admission_id} className="card" style={{ padding: "14px 16px", borderLeft: `4px solid ${tier.color}` }}>
                    <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                        <span style={{ fontWeight: 800, fontSize: 15 }}>{r.bed}</span>
                        <span className="dim" style={{ fontSize: 12, fontWeight: 600 }}>{r.ward}</span>
                      </div>
                      <span className="tag" style={{ background: tier.bg, color: tier.color, fontWeight: 800, fontSize: 11, flexShrink: 0 }}>
                        {tier.label.toUpperCase()}
                      </span>
                    </div>
                    <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>IP ···{r.ip_last6}</div>
                    <div className="row" style={{ gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12 }}>
                        <span className="dim">Doctor: </span><span style={{ fontWeight: 700 }}>{r.doctor}</span>
                      </span>
                      <span style={{ fontSize: 12 }}>
                        <span className="dim">Planned: </span>
                        <span style={{ fontWeight: 700, color: "var(--red)" }}>{fmtPlanDate(r.planned_date)}</span>
                      </span>
                      <span style={{ fontSize: 12 }}>
                        <span className="dim">Status: </span>
                        <span style={{ fontWeight: 700 }}>{r.discharge_status.replace(/_/g, " ")}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  COMMAND CENTER — Feature 1 (CEO TV Mode)
// ══════════════════════════════════════════════════════════════════════════════

const CC_PANELS = ["Occupancy", "Discharge Pipeline", "Ward Status"];

function CommandCenter({ discharge }) {
  const [tvMode, setTvMode] = useState(false);
  const [panel, setPanel] = useState(0);
  const [liveData, setLiveData] = useState(null);

  const fetchLive = useCallback(() => {
    api.cooLiveWards().then(d => setLiveData(d)).catch(() => { });
  }, []);
  useEffect(() => { fetchLive(); }, [fetchLive]);

  // Refresh every 30s
  useEffect(() => {
    const id = setInterval(fetchLive, 30000);
    return () => clearInterval(id);
  }, [fetchLive]);

  // Auto-rotate panels in TV mode every 8s
  useEffect(() => {
    if (!tvMode) return;
    const id = setInterval(() => setPanel(p => (p + 1) % CC_PANELS.length), 8000);
    return () => clearInterval(id);
  }, [tvMode]);

  // Lock/unlock body scroll when TV mode is active
  useEffect(() => {
    document.body.style.overflow = tvMode ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [tvMode]);

  const totals = liveData?.totals;
  const wards = liveData?.wards || [];
  const occ = totals ? (totals.o ?? 0) + (totals.or ?? 0) : null;
  const occPct = totals && totals.total > 0 ? Math.round((occ / totals.total) * 100) : null;

  const KPIs = [
    {
      label: "OCCUPANCY",
      value: occPct != null ? `${occPct}%` : "—",
      sub: occ != null ? `${occ} / ${totals.total} beds` : "",
      color: occPct >= 90 ? "var(--red)" : occPct >= 75 ? "#d97706" : "var(--green)",
    },
    {
      label: "VACANT BEDS",
      value: totals ? (totals.v ?? "—") : "—",
      sub: "available now",
      color: "var(--green)",
    },
    {
      label: "ACTIVE DISCHARGES",
      value: discharge != null ? discharge.initiated + discharge.pending : "—",
      sub: `${discharge?.overduePlanned ?? "—"} overdue planned`,
      color: "var(--primary)",
    },
    {
      label: "COMPLETED TODAY",
      value: discharge?.completedToday ?? "—",
      sub: `${discharge?.plannedToday ?? "—"} planned`,
      color: "var(--green)",
    },
  ];

  const now = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", weekday: "long", year: "numeric",
    month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const inner = (
    <div style={{
      background: "var(--bg)",
      padding: tvMode ? 32 : 0,
      minHeight: tvMode ? "100vh" : undefined,
    }}>
      {/* Header */}
      <div className="row between" style={{ marginBottom: tvMode ? 28 : 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: tvMode ? 26 : 20, letterSpacing: "-.02em" }}>
            KIMS Hospitals — Command Center
          </div>
          <div className="dim" style={{ fontSize: tvMode ? 13 : 11 }}>{now}</div>
        </div>
        <button className="btn btn-primary" onClick={() => setTvMode(t => !t)} style={{ gap: 6, fontWeight: 700 }}>
          <Ic d={icons.layers} s={14} /> {tvMode ? "Exit TV Mode" : "TV Mode"}
        </button>
      </div>

      {/* KPI strip */}
      <div className="stat-grid" style={{ marginBottom: tvMode ? 28 : 18 }}>
        {KPIs.map(k => (
          <div key={k.label} className="stat" style={{ padding: tvMode ? "22px 18px" : undefined }}>
            <div className="n" style={{ fontSize: tvMode ? 48 : 26, color: k.color, fontWeight: 900, lineHeight: 1 }}>{k.value}</div>
            <div className="l" style={{ marginTop: 6, fontSize: tvMode ? 12 : undefined }}>{k.label}</div>
            <div className="dim" style={{ fontSize: tvMode ? 11 : 10, marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Panel tabs */}
      <div className="row" style={{ gap: 8, marginBottom: tvMode ? 20 : 14, flexWrap: "wrap" }}>
        {CC_PANELS.map((p, i) => (
          <button key={p} className={"fchip" + (panel === i ? " on" : "")}
            onClick={() => setPanel(i)} style={{ padding: "7px 14px", fontSize: 13 }}>
            {p}
          </button>
        ))}
        {tvMode && <span className="dim" style={{ fontSize: 11, marginLeft: 8, alignSelf: "center" }}>Auto-rotating every 8s</span>}
      </div>

      {/* Panel 0: Occupancy */}
      {panel === 0 && totals && (
        <div className="card-grid">
          {[
            ["TOTAL BEDS", totals.total, "var(--ink)"],
            ["VACANT", totals.v, "var(--green)"],
            ["VAC + RES", totals.r, "var(--ink-2)"],
            ["OCCUPIED", totals.o, "var(--primary)"],
            ["OCC + RES", totals.or, "var(--ink-2)"],
            ["TOTAL OCCUPIED", occ, "var(--primary)"],
            ["OCC %", occPct != null ? `${occPct}%` : "—", occPct >= 90 ? "var(--red)" : occPct >= 75 ? "#d97706" : "var(--green)"],
          ].map(([l, v, c]) => (
            <div key={l} className="stat" style={{ padding: tvMode ? "20px 16px" : undefined }}>
              <div className="n" style={{ fontSize: tvMode ? 38 : 22, color: c, fontWeight: 900 }}>{v ?? "—"}</div>
              <div className="l">{l}</div>
            </div>
          ))}
        </div>
      )}
      {panel === 0 && !totals && (
        <div className="card-grid">{[0, 1, 2, 3].map(i => <div key={i} className="preui-sk preui-sk-card" />)}</div>
      )}

      {/* Panel 1: Discharge Pipeline */}
      {panel === 1 && (
        <div className="card-grid">
          {[
            ["PLANNED TODAY", discharge?.plannedToday, "var(--primary)"],
            ["INITIATED", discharge?.initiated, "var(--blue)"],
            ["IN PROGRESS", discharge?.pending, "var(--blue)"],
            ["COMPLETED TODAY", discharge?.completedToday, "var(--green)"],
            ["AWAITING PAYMENT", discharge?.paymentPending, "var(--ink)"],
            ["SYS CHECKOUT DONE", discharge?.systemCheckoutCompleted, "var(--ink)"],
            ["PHYS CHECKOUT DONE", discharge?.physicalCheckoutCompleted, "var(--ink)"],
            ["OVERDUE PLANNED", discharge?.overduePlanned, discharge?.overduePlanned ? "var(--red)" : "var(--green)"],
          ].map(([l, v, c]) => (
            <div key={l} className="stat" style={{ padding: tvMode ? "20px 16px" : undefined }}>
              <div className="n" style={{ fontSize: tvMode ? 38 : 22, color: c, fontWeight: 900 }}>{v ?? "—"}</div>
              <div className="l">{l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Panel 2: Ward Status grid */}
      {panel === 2 && (
        <div className="card-grid">
          {wards.length === 0 && [0, 1, 2, 3].map(i => <div key={i} className="preui-sk preui-sk-card" />)}
          {wards.slice(0, 16).map(w => {
            const o2 = (w.occupied ?? 0) + (w.occupied_reserved ?? 0);
            const pct = w.total > 0 ? Math.round((o2 / w.total) * 100) : 0;
            const col = pct >= 90 ? "var(--red)" : pct >= 75 ? "#d97706" : "var(--green)";
            return (
              <div key={w.id} className="stat" style={{ padding: tvMode ? "18px 14px" : undefined }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "var(--ink-2)", marginBottom: 4 }}>
                  {(w.ward || w.name || "").toUpperCase()}
                </div>
                <div className="n" style={{ fontSize: tvMode ? 32 : 20, color: col, fontWeight: 900 }}>{pct}%</div>
                <div className="dim" style={{ fontSize: 10 }}>{o2}/{w.total} occupied</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  if (tvMode) return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, overflowY: "auto" }}>{inner}</div>,
    document.body,
  );
  return inner;
}
