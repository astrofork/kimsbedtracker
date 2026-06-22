import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { api, fmtTime, fmtRelative, fmtDateTime, toastErr, friendlyError, toMs, createSocket } from "./lib.js";
import {
  Ic, icons, StatusBar, useModal, AppError, useConfirm, BlockAvatar,
  THEMES, T_LABEL, T_COLOR, getTheme, applyTheme,
} from "./ui.jsx";
import { AppShell, useProfileMenuSlot, useTopBarSlot } from "./shell.jsx";
import {
  HistoryViewer, actionLabel,
  HierarchyManager, PreBlockManager, PreManager,
  StationManager, NurseManager, PayerTypeManager, DestinationManager,
  DoctorBlockManager, DoctorManager,
} from "./ManagerApp.jsx";
import {
  snapshotDownload, snapshotCopy, snapshotShare, snapshotCanShare,
} from "./snapshot.js";
import { naturalSort, calculateWardTotals } from "./bedUtils.js";

const HOSPITAL_NAME = "KIMS Hospitals";

// Canonical KPI card order — mirrors the labels in LiveBedDashboard's KPIS
// array. Kept static (not derived from live data) so the drag-to-reorder
// hooks can run unconditionally even before the dashboard's data has loaded.
const KPI_DEFAULT_ORDER = [
  "Total Beds", "Operational Beds", "Census Beds", "Non-Census Beds",
  "Total Occupied", "Census Occupied", "On Bed", "OCC + RES",
  "Non-Census Occupied", "Total Vacant", "Vacant", "VAC + RES",
];

function fmtReminderLabel(hhmm) {
  const [h] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM", hh = h % 12 === 0 ? 12 : h % 12;
  return hh + " " + ap;
}

// Backend role stays COO — the UI presents it as the Admin module.
const ADMIN_TITLES = {
  dashboard:  "Live Bed Dashboard",
  analytics:  "Analytics",
  matrix:     "Hospital Matrix",
  activity:   "PRE & Nurse Activity",
  reports:    "Reports",
  savedviews: "Saved Views",
  alerts:     "Alerts",
  pres:       "PRE Users",
  nurses:     "Nurse Users",
  doctors:    "Doctor Users",
  setup:      "Blocks",
  preblocks:  "PRE Blocks",
  doctorblocks: "Doctor Blocks",
  stations:   "Stations",
  payers:     "Payer Types",
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
  const [reportsView, setReportsView] = useState("activity"); // "activity" | "history" | "census"
  const [analyticsView, setAnalyticsView] = useState("overview"); // "overview" | "payer"
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
    socket.on("bed:update",       refresh);
    socket.on("round:submit",     refresh);
    socket.on("ward:operational", refresh);
    socket.on("alarm:active",     refresh); // overdue PRE round → refresh compliance badge
    socket.on("connect",          refresh); // catch missed updates on reconnect
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
    { section: "Dashboard", items: [
      { key: "dashboard",  icon: icons.home,     label: "Dashboard" },
      { key: "analytics",  icon: icons.chart,    label: "Analytics" },
    ] },
    { section: "Operations", items: [
      { key: "matrix",     icon: icons.grid,     label: "Hospital Matrix" },
      { key: "activity",   icon: icons.user,     label: "PRE & Nurse" },
      { key: "reports",    icon: icons.clock,    label: "Reports" },
      { key: "savedviews", icon: icons.layers,   label: "Saved Views" },
      { key: "alerts",     icon: icons.bell,     label: "Alerts", dot: !!(due && !dismissed[due]) },
    ] },
    { section: "Users", items: [
      { key: "pres",       icon: icons.user,        label: "PRE Users" },
      { key: "nurses",     icon: icons.user,        label: "Nurse Users" },
      { key: "doctors",    icon: icons.stethoscope, label: "Doctor Users" },
    ] },
    { section: "Setup", items: [
      { key: "setup",      icon: icons.layers,      label: "Blocks" },
      { key: "preblocks",  icon: icons.grid,        label: "PRE Blocks" },
      { key: "doctorblocks", icon: icons.stethoscope, label: "Doctor Blocks" },
      { key: "stations",   icon: icons.bed,         label: "Stations" },
      { key: "payers",     icon: icons.list,        label: "Payer Types" },
      { key: "destinations", icon: icons.list,      label: "Destinations" },
    ] },
    { section: "System", items: [
      { key: "settings",   icon: icons.settings, label: "Settings" },
    ] },
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

      {tab === "dashboard"  && <LiveBedDashboard refreshKey={liveKey} userName={user?.name || user?.username || "Admin"} />}
      {tab === "activity"   && <ActivityPage />}
      {tab === "matrix"     && <Matrix data={data} selDate={selDate} history={history} userId={user?.id} />}
      {tab === "analytics"  && (
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
          {analyticsView === "overview" && <Overview data={data} compliance={compliance} selDate={selDate} history={history} onViewBeds={setBedsBlock} />}
          {analyticsView === "payer"    && <PayerTrendsPanel refreshKey={liveKey} />}
        </div>
      )}
      {tab === "reports"    && (
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
          {reportsView === "history"  && <HistoryViewer showCensusCard={false} />}
          {reportsView === "census"   && <MidnightCensusMatrix userId={user?.id} />}
        </div>
      )}
      {tab === "savedviews" && <SavedViewsPage data={data} userId={user?.id} onOpenInMatrix={() => setTab("matrix")} />}
      {tab === "alerts"     && <AlertsPage data={data} compliance={compliance} due={due} dismissed={dismissed} setDismissed={setDismissed} />}

      {/* Users */}
      {tab === "pres"       && <PreManager showToast={showToast} />}
      {tab === "nurses"     && <NurseManager showToast={showToast} />}
      {tab === "doctors"    && <DoctorManager showToast={showToast} />}

      {/* Setup */}
      {tab === "setup"        && <HierarchyManager showToast={showToast} />}
      {tab === "preblocks"    && <PreBlockManager showToast={showToast} />}
      {tab === "doctorblocks" && <DoctorBlockManager showToast={showToast} />}
      {tab === "stations"     && <StationManager showToast={showToast} />}
      {tab === "payers"       && <PayerTypeManager showToast={showToast} />}
      {tab === "destinations" && <DestinationManager showToast={showToast} />}

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

function LiveBedDashboard({ refreshKey = 0, userName = "Admin" }) {
  const profileMenuSlot = useProfileMenuSlot();
  const topBarSlot = useTopBarSlot();
  const [liveData,  setLiveData]  = useState(null);
  const [snaps,     setSnaps]     = useState(null);
  const [lastSync,  setLastSync]  = useState(new Date());
  const [viewBy,    setViewBy]    = useState("TOTAL");
  const [search,    setSearch]    = useState("");
  const [searchBy,  setSearchBy]  = useState("ward");
  const [groupBy,   setGroupBy]   = useState("none");
  const [snapBusy,  setSnapBusy]  = useState(null);
  const [snapToast, setSnapToast] = useState("");
  const [payerTypes, setPayerTypes] = useState(null); // active payer types, sorted — drives dynamic payer cards
  const snapshotRef = useRef(null);

  // ── KPI card layout customization — frontend/localStorage only, never touches
  // the backend. Locked by default on every load; an admin can unlock, drag
  // cards into a preferred order, then Save (persists) or Reset (clears it).
  const KPI_LAYOUT_KEY = "dashboard_layout_admin";
  const [layoutLocked, setLayoutLocked] = useState(true);
  const [kpiOrder,     setKpiOrder]     = useState(null); // string[] of labels, or null = default order
  const [dragKey,      setDragKey]      = useState(null);
  const [confirm, confirmDialog]        = useConfirm();
  const kpiGridRef   = useRef(null);
  const prevRectsRef  = useRef(new Map());
  const draggingRef   = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KPI_LAYOUT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setKpiOrder(parsed);
      }
    } catch { /* corrupt/old value — fall back to default order */ }
  }, []);

  const toggleLayoutLock = () => {
    setLayoutLocked((was) => {
      const nowLocked = !was;
      showSnapToast(nowLocked ? "Layout locked" : "Layout editing enabled");
      return nowLocked;
    });
  };

  const saveLayout = (order) => {
    try { localStorage.setItem(KPI_LAYOUT_KEY, JSON.stringify(order)); } catch { /* storage unavailable */ }
    showSnapToast("Layout saved");
  };

  const requestResetLayout = async () => {
    const ok = await confirm({
      title: "Reset dashboard layout to default?",
      message: "This clears your saved card order on this device and restores the original layout.",
      confirmLabel: "Reset",
      danger: true,
    });
    if (!ok) return;
    try { localStorage.removeItem(KPI_LAYOUT_KEY); } catch { /* ignore */ }
    setKpiOrder(null);
    showSnapToast("Layout reset to default");
  };

  const reorder = (fromKey, toKey, baseOrder) => {
    const arr = [...baseOrder];
    const fromIdx = arr.indexOf(fromKey);
    const toIdx   = arr.indexOf(toKey);
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
  const HOLD_MS     = 220;                       // press-and-hold before a drag arms
  const HOLD_SLOP   = 10;                        // px of movement that cancels the hold
  const SWAP_THRESH = 0.65;                      // must cross ≥65% into a neighbour before it swaps
  const EASE        = "cubic-bezier(.4,0,.2,1)"; // ease-in-out everywhere — calm, predictable
  const LIFT_MS     = 300;                       // grab lift-off
  const FLOW_MS     = 320;                       // neighbour reflow
  const SETTLE_MS   = 300;                       // ghost drop-into-place
  const DAMP_MS     = 90;                        // ghost follows cursor with slight inertia/damping

  // The lifted card is a detached "ghost": an outer positioner that follows the
  // cursor via transform-translate (compositor-only, no layout → 60fps) wrapping
  // an inner visual clone that owns the scale/shadow "lift". The card's real
  // slot stays in the grid as a dashed drop-zone placeholder that glides (via
  // the FLIP effect below) to wherever the card will land.
  const ghostRef       = useRef(null);  // positioner
  const ghostInnerRef  = useRef(null);  // visual clone
  const grabOffsetRef  = useRef({ x: 0, y: 0 });
  const pressTimerRef  = useRef(null);
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
    try { setLiveData(await api.cooLiveWards()); setLastSync(new Date()); } catch { /* keep stale */ }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { api.cooSnapshots().then((r) => setSnaps(r.snapshots || [])).catch(() => setSnaps([])); }, [refreshKey]);
  useEffect(() => {
    api.mgrPayerTypes().then((r) => setPayerTypes((r.payerTypes || []).filter((p) => p.active)))
      .catch(() => setPayerTypes([]));
  }, [refreshKey]);

  const showSnapToast = useCallback((m) => { setSnapToast(m); setTimeout(() => setSnapToast(""), 2400); }, []);
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

  // Must be before any early return — hooks cannot be called conditionally
  const searchFilter = useCallback((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    if (searchBy === "room_type") return (r.room_type || "").toLowerCase().includes(q);
    return r.ward.toLowerCase().includes(q);
  }, [search, searchBy]);

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
    payersLive: w.payersLive || {},
  }));

  // Unit options are derived from the live data, so new unit types appear
  // automatically — no code change needed. "TOTAL" = all.
  const unitOptions = ["TOTAL", ...Array.from(
    new Set(allRows.map((r) => (r.unit_type || "").trim()).filter(Boolean))
  ).sort()];
  const activeUnit = unitOptions.includes(viewBy) ? viewBy : "TOTAL";
  const rows = allRows.filter((r) => activeUnit === "TOTAL" || (r.unit_type || "").trim() === activeUnit);

  const censusRows    = rows.filter((r) => r.bed_type !== "Non-Census");
  const nonCensusRows = rows.filter((r) => r.bed_type === "Non-Census");

  // KPI cards mirror exactly what the tables show: Unit + Search/Room-type filter.
  // With no search and Unit = TOTAL, that's every operational ward — the whole hospital.
  const shownRows = rows.filter(searchFilter);
  const censusShown    = censusRows.filter(searchFilter);
  const nonCensusShown = nonCensusRows.filter(searchFilter);
  const sum = (fn) => shownRows.reduce((a, r) => a + (fn(r) || 0), 0);
  const sumOf = (set, fn) => set.reduce((a, r) => a + (fn(r) || 0), 0);
  const operational = sum((r) => r.total);
  const census      = sum((r) => (r.bed_type !== "Non-Census" ? r.total : 0));
  const nonCensus    = operational - census;
  const v = sum((r) => r.vacant), rr = sum((r) => r.reserved), o = sum((r) => r.occupied), or_ = sum((r) => r.occupied_reserved);
  const totalOcc = o + or_, totalVac = v + rr;
  const censusOcc    = sumOf(censusShown,    (r) => r.occupied) + sumOf(censusShown,    (r) => r.occupied_reserved);
  const nonCensusOcc = sumOf(nonCensusShown, (r) => r.occupied) + sumOf(nonCensusShown, (r) => r.occupied_reserved);
  // Non-operational beds live outside `rows` (operational-only), so that total
  // only makes sense for the unfiltered, org-wide view.
  const showingAll = !search.trim() && activeUnit === "TOTAL";
  const allBeds = showingAll ? (liveData.allBeds || operational) : operational;
  const nonOp   = showingAll ? (liveData.nonOpBeds || 0) : 0;
  const base = operational || 1;
  const pct = (n) => Math.round((n / base) * 100) + "%";

  // Sparkline series from hourly org-wide snapshots — decorative trend per card;
  // these aren't filterable by unit/search since snapshots store only org totals.
  const S = {
    total:    (snaps || []).map((s) => s.total || 0),
    vacant:   (snaps || []).map((s) => s.vacant || 0),
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
    { label: "Total Occupied",      val: totalOcc,    sub: pct(totalOcc),    color: "#dc2626", icon: icons.chart, series: S.occupied },
    { label: "Census Occupied",     val: censusOcc,    sub: pct(censusOcc),    color: "#ea580c", icon: icons.users, series: S.occupied },
    { label: "Non-Census Occupied", val: nonCensusOcc, sub: pct(nonCensusOcc), color: "#f97316", icon: icons.user,  series: S.occupied },
    { label: "On Bed",              val: o,           sub: pct(o),           color: "#ff3b8a", icon: icons.bed,   series: S.occupied },

    // All Vacant-type cards together
    { label: "Total Vacant", val: totalVac, sub: pct(totalVac), color: "#16a34a", icon: icons.bed,   series: S.vacant },
    { label: "Vacant",       val: v,        sub: pct(v),        color: "#15803d", icon: icons.check, series: S.vacant },

    // Remaining bed breakdowns — these are inventory counts, not occupancy
    // state, so a "%" here is either a tautology (Operational Beds is always
    // 100% of itself) or just restates a split better read as a plain count.
    { label: "Operational Beds", val: operational, sub: null, color: "#1d4ed8", icon: icons.refresh, series: S.total },
    { label: "Census Beds",      val: census,      sub: null, color: "#1e3a8a", icon: icons.users,   series: S.total },
    { label: "Non-Census Beds",  val: nonCensus,   sub: null, color: "#0c2a6b", icon: icons.user,    series: S.reserved },

    // RES variants last
    { label: "OCC + RES", val: or_, sub: pct(or_), color: "#be123c", icon: icons.plus,  series: S.reserved },
    { label: "VAC + RES", val: rr,  sub: pct(rr),  color: "#0ea5b7", icon: icons.clock, series: S.reserved },
  ];

  // One card per active payer type (dynamic — auto-adjusts if Setup → Payer
  // Types changes). Value = live occupied count for that payer over the
  // current Unit + Search filter; sparkline = that payer's real hourly trend
  // from occupancy_snapshots.payer_snapshot (sparse until enough points accrue).
  const payerOccBase = totalOcc || 1;
  const payerCards = (payerTypes || []).map((pt, i) => {
    const val = shownRows.reduce((a, r) => a + ((r.payersLive || {})[pt.name] || 0), 0);
    return {
      label: pt.name,
      val,
      sub: `${Math.round((val / payerOccBase) * 100)}% of occupied`,
      color: PAYER_PALETTE[i % PAYER_PALETTE.length],
      icon: payerIcon(pt.name),
      series: (snaps || []).map((s) => (s.payers || {})[pt.name] || 0),
    };
  });

  const canShare = snapshotCanShare();

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

  return (
    <div className="cc-wrap">
      <div className="dash-greet-row">
        <div className="dash-greet">{greetOf()}, {userName} <span style={{ fontWeight: 400 }}>👋</span></div>
        <div className="dash-greet-sub">Here's your real-time overview of bed status across all units.</div>
      </div>

      {/* "Live · HH:MM" now lives in the top nav bar next to the profile chip —
          portaled into the slot AppShell always exposes while this tab is open. */}
      {topBarSlot && createPortal(
        <span className="cc-live"><i /> Live · {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>,
        topBarSlot
      )}

      {/* Layout controls + Snapshot actions live in the profile dropdown (top
          right), not inline here — portaled into the slot AppShell exposes
          while it's open. */}
      {profileMenuSlot && createPortal(
        <>
          <div className="profile-menu-section">
            <div className="profile-menu-label">Dashboard Layout</div>
            <button className="profile-menu-item" onClick={toggleLayoutLock}>
              <span>{layoutLocked ? "🔒 Layout Locked" : "🔓 Editing Layout"}</span>
            </button>
            {!layoutLocked && (
              <>
                <button className="profile-menu-item" onClick={() => saveLayout(effectiveOrder)}>
                  <span>💾 Save Layout</span>
                </button>
                <button className="profile-menu-item" onClick={requestResetLayout}>
                  <span>↺ Reset Layout</span>
                </button>
                <div className="profile-menu-note">Editing enabled — drag cards on the dashboard to reorder.</div>
              </>
            )}
          </div>
          <div className="profile-menu-section" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="profile-menu-label">Snapshot</div>
            <button className="profile-menu-item" disabled={snapBusy !== null}
              onClick={() => runSnap("download", snapshotDownload, "Snapshot downloaded")}>
              <span>📷 {snapBusy === "download" ? "Downloading…" : "Download Snapshot"}</span>
            </button>
            <button className="profile-menu-item" disabled={snapBusy !== null}
              onClick={() => runSnap("copy", snapshotCopy, "Snapshot copied to clipboard")}>
              <span>📋 {snapBusy === "copy" ? "Copying…" : "Copy to Clipboard"}</span>
            </button>
            {canShare && (
              <button className="profile-menu-item" disabled={snapBusy !== null}
                onClick={() => runSnap("share", snapshotShare, "Shared successfully")}>
                <span>📤 {snapBusy === "share" ? "Sharing…" : "Share"}</span>
              </button>
            )}
          </div>
        </>,
        profileMenuSlot
      )}

      {/* Toolbar — Unit filter + View-by + Search + Group-by + Snapshot. Sits at
          the top so its filter applies to everything below: KPI cards, By Payer
          cards and the ward tables all already derive from this same filter. */}
      <div className="card" style={{ padding: "8px 10px", marginBottom: 10 }}>
        <div className="dash-toolbar">
          <div className="dtg">
            <div className="dtg-head"><span className="dtg-ic"><Ic d={icons.building} s={16} /></span><span className="dtg-label">Unit</span></div>
            {unitOptions.length <= 4 ? (
              <div className="seg-pill">
                {unitOptions.map((k) => (
                  <button key={k} className={activeUnit === k ? "on" : ""} onClick={() => setViewBy(k)}>{k === "TOTAL" ? "TOTAL" : k}</button>
                ))}
              </div>
            ) : (
              <select className="field" value={activeUnit} onChange={(e) => setViewBy(e.target.value)}
                style={{ fontSize: 12, fontWeight: 600, height: 34, borderRadius: 9, paddingTop: 0, paddingBottom: 0, minWidth: 140 }}>
                {unitOptions.map((k) => <option key={k} value={k}>{k === "TOTAL" ? "All units" : k}</option>)}
              </select>
            )}
          </div>

          <div className="dt-divider" />

          <div className="dtg">
            <div className="dtg-head"><span className="dtg-ic"><Ic d={icons.grid} s={15} /></span><span className="dtg-label">View by</span></div>
            <div className="seg-pill">
              {[{ value: "ward", label: "Ward" }, { value: "room_type", label: "Room Type" }].map((opt) => (
                <button key={opt.value} className={searchBy === opt.value ? "on" : ""}
                  onClick={() => { setSearchBy(opt.value); setSearch(""); }}>{opt.label}</button>
              ))}
            </div>
          </div>

          <div className="dtg dt-search">
            <span style={{ position: "absolute", left: 11, bottom: 9, color: "var(--ink-3)", pointerEvents: "none", display: "flex" }}>
              <Ic d={icons.search} s={14} />
            </span>
            <input className="field" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={searchBy === "room_type" ? "Search room type…" : "Search ward name…"}
              style={{ paddingLeft: 31, fontSize: 12, height: 34, width: "100%", borderRadius: 9 }} maxLength={60} />
          </div>

          <div className="dtg">
            <div className="dtg-head"><span className="dtg-ic"><Ic d={icons.users} s={15} /></span><span className="dtg-label">Group by</span></div>
            <select className="field" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}
              style={{ fontSize: 12, fontWeight: 600, height: 34, borderRadius: 9, paddingTop: 0, paddingBottom: 0, minWidth: 140 }}>
              {GROUP_BY_OPTIONS.map((o2) => <option key={o2.value} value={o2.value}>{o2.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* When a filter/search narrows the view, the cards & tables below reflect that subset. */}
      {!showingAll && (
        <div className="row" style={{ gap: 8, margin: "0 0 12px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700,
            background: "var(--primary-bg, rgba(37,99,235,.12))", color: "var(--primary)",
          }}>
            <Ic d={icons.search} s={12} /> Showing {shownRows.length} of {allRows.length} wards
          </span>
          <span className="dim" style={{ fontSize: 11 }}>Cards &amp; tables below reflect the current filter</span>
        </div>
      )}

      {/* Gradient KPI cards with sparklines — draggable into any order when unlocked */}
      <div
        ref={kpiGridRef}
        className={"kc-grid kc-grid-kpi" + (!layoutLocked ? " kc-editing" : "")}
        role="list"
        aria-label="Dashboard KPI cards"
      >
        {orderedKpis.map((k, i) => {
          const isDragging = dragKey === k.label;
          return (
            <div
              key={k.label}
              data-kpi-key={k.label}
              className={"kc" + (!layoutLocked ? " kc-draggable" : "") + (isDragging ? " kc-dragging" : "")}
              role="listitem"
              aria-label={`${k.label} card, position ${i + 1} of ${orderedKpis.length}${!layoutLocked ? ". Press and hold, then use arrow keys to reorder." : ""}`}
              tabIndex={!layoutLocked ? 0 : -1}
              onPointerDown={layoutLocked ? undefined : (e) => { e.preventDefault(); pressStart(k.label, e); }}
              onKeyDown={(e) => {
                if (layoutLocked) return;
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

      {/* By Payer — one dynamic card per active payer type */}
      {payerCards.length > 0 && (
        <>
          <div className="floor-head" style={{ marginTop: 4 }}>By Payer</div>
          <div className="kc-grid">
            {payerCards.map((k) => (
              <div key={k.label} className="kc">
                <div className="kc-head">
                  <div className="kc-label" style={{ color: k.color }}>{k.label}</div>
                  <div className="kc-icon" style={{ color: k.color, background: `${k.color}1a` }}>
                    <Ic d={k.icon} s={15} />
                  </div>
                </div>
                <div className="kc-val">{k.val}</div>
                <div className="kc-sub">{k.sub}</div>
                <Sparkline values={k.series} color={k.color} id={"pc" + k.label.replace(/[^a-z0-9]/gi, "")} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* Ward tables — this is what gets captured by Snapshot/Copy/Share */}
      <div ref={snapshotRef}>
        {groupBy === "none" ? (
          <>
            <WardStatusTable title="Census Beds" accent="var(--st-v)" accentBg="var(--st-v-bg)" rows={censusRows} totalLabel="TOTAL (CENSUS)" searchFilter={searchFilter} />
            <WardStatusTable title="Non-Census Beds" accent="var(--st-o)" accentBg="var(--st-o-bg)" rows={nonCensusRows} totalLabel="TOTAL (NON-CENSUS)" searchFilter={searchFilter} />
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
      {confirmDialog}
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
  const [liveData,     setLiveData]     = useState(null);
  const [payerRange,   setPayerRange]   = useState("live");
  const [expandedPayer, setExpandedPayer] = useState(null);
  const [trendRange,   setTrendRange]   = useState("7d");
  const [trend,        setTrend]        = useState(null);

  useEffect(() => { api.cooLiveWards().then(setLiveData).catch(() => {}); }, [refreshKey]);
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
  { value: "none",       label: "None"           },
  { value: "room_type",  label: "Room Type"      },
  { value: "unit_type",  label: "Unit Type"      },
  { value: "block_name", label: "Building Block" },
  { value: "floor_name", label: "Floor"          },
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
const wstC   = { textAlign: "center" };

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

function renderWardRow(r, showBadge) {
  const reported = r.vacant !== null && r.vacant !== undefined;
  const o   = r.occupied          || 0;
  const or_ = r.occupied_reserved || 0;
  const v   = r.vacant            || 0;
  const vr  = r.reserved          || 0;
  const { totalOccupied: occ, totalVacant: vac } = calculateWardTotals(r);
  const p   = reported && r.total > 0 ? (occ / r.total) * 100 : 0;
  const d   = (n) => reported ? n : "–";
  const isCensus = r.bed_type !== "Non-Census";
  return (
    <tr key={r.id}>
      <td style={{ fontWeight: 600 }}>
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
      <td style={wstC}>{r.total}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-o)"  }}>{d(occ)}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-o)"  }}>{d(o)}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-or)" }}>{d(or_)}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-v)"  }}>{d(vac)}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-v)"  }}>{d(v)}</td>
      <td style={{ ...wstC, fontWeight: 700, color: "var(--st-vr)" }}>{d(vr)}</td>
      <td style={wstC}>{reported ? <OccBar p={p} /> : <span className="dim">–</span>}</td>
      <td><LastUpdatedCell ts={r.updatedAt} reviewedAt={r.reviewedAt} /></td>
    </tr>
  );
}

function groupAggregates(grpRows) {
  const gb   = wstSum(grpRows, r => r.total);
  const go   = wstSum(grpRows, r => r.occupied || 0);
  const gor  = wstSum(grpRows, r => r.occupied_reserved || 0);
  const gv   = wstSum(grpRows, r => r.vacant || 0);
  const gvr  = wstSum(grpRows, r => r.reserved || 0);
  const { totalOccupied: gocc, totalVacant: gvac } = calculateWardTotals(grpRows);
  const gp   = gb > 0 ? Math.round((gocc / gb) * 100) : 0;
  const gUpdatedAt = grpRows.reduce((max, r) => (r.updatedAt && r.updatedAt > (max || 0)) ? r.updatedAt : max, null);
  return { gb, go, gor, gv, gvr, gocc, gvac, gp, gUpdatedAt };
}

// Flat table — shown when Group by = None
function WardStatusTable({ title, accent, accentBg, rows, totalLabel, searchFilter }) {
  const filtered = rows.filter(searchFilter);

  const totBeds = wstSum(filtered, r => r.total);
  const totV    = wstSum(filtered, r => r.vacant);
  const totR    = wstSum(filtered, r => r.reserved);
  const totO    = wstSum(filtered, r => r.occupied || 0);
  const totOR   = wstSum(filtered, r => r.occupied_reserved || 0);
  const { totalOccupied: totOcc, totalVacant: totVac } = calculateWardTotals(filtered);
  const totPct  = totBeds > 0 ? Math.round((totOcc / totBeds) * 100) : 0;

  return (
    <div className="card" style={{ marginBottom: 16, overflow: "hidden" }}>
      <div className="row between" style={{ padding: "13px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: accent }}>{title}</div>
        <span className="chip" style={{ color: accent }}>Total: {totBeds} beds</span>
      </div>
      <div className="tbl-wrap" style={{ border: "none", borderRadius: 0 }}>
        <table className="tbl tbl-pin1">
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
              <th style={wstC}>OCC %</th>
              <th style={wstC}>LAST UPDATED</th>
            </tr>
          </thead>
          <tbody>
            {/* Total row always shows — reflects the active filter, including the
                zero-match case (all-zero totals rather than vanishing entirely). */}
            <tr className="tbl-total-row" style={{ background: accentBg, "--tbl-total-accent": accent }}>
              <td style={{ fontWeight: 800, fontSize: 13, color: accent, background: accentBg }}>{totalLabel}</td>
              <td style={{ ...wstC, fontWeight: 800 }}>{totBeds}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)"  }}>{totOcc}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)"  }}>{totO}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-or)" }}>{totOR}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)"  }}>{totVac}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)"  }}>{totV}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-vr)" }}>{totR}</td>
              <td style={wstC}><OccBar p={totPct} /></td>
              <td><LastUpdatedCell ts={filtered.reduce((max, r) => (r.updatedAt && r.updatedAt > (max || 0)) ? r.updatedAt : max, null)} /></td>
            </tr>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--ink-3)", padding: "22px 14px" }}>
                No wards match the current filter.
              </td></tr>
            ) : (
              filtered.map(r => renderWardRow(r, false))
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
  const { totalOccupied: totOcc, totalVacant: totVac } = calculateWardTotals(filtered);
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
        <span className="chip">Total: {totBeds} beds</span>
      </div>
      <div className="tbl-wrap" style={{ border: "none", borderRadius: 0 }}>
        <table className="tbl tbl-pin1">
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
              <th style={wstC}>OCC %</th>
              <th style={wstC}>LAST UPDATED</th>
            </tr>
          </thead>
          <tbody>
            {/* Grand total always shows first — reflects the active filter,
                including the zero-match case (all-zero totals, not vanished). */}
            <tr className="tbl-total-row" style={{ background: "var(--primary-bg, rgba(37,99,235,.12))", "--tbl-total-accent": "var(--primary)" }}>
              <td style={{ fontWeight: 800, fontSize: 13, color: "var(--primary)", background: "var(--primary-bg, rgba(37,99,235,.12))" }}>GRAND TOTAL</td>
              <td style={{ ...wstC, fontWeight: 800 }}>{totBeds}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)"  }}>{totOcc}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)"  }}>{totO}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-or)" }}>{totOR}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)"  }}>{totVac}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)"  }}>{totV}</td>
              <td style={{ ...wstC, fontWeight: 800, color: "var(--st-vr)" }}>{totR}</td>
              <td style={wstC}><OccBar p={totPct} /></td>
              <td><LastUpdatedCell ts={filtered.reduce((max, r) => (r.updatedAt && r.updatedAt > (max || 0)) ? r.updatedAt : max, null)} /></td>
            </tr>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--ink-3)", padding: "22px 14px" }}>
                No wards match the current filter.
              </td></tr>
            ) : (
              groups.map(({ key, grpRows }) => {
                const isOpen = expanded.has(key);
                const { gb, go, gor, gv, gvr, gocc, gvac, gp, gUpdatedAt } = groupAggregates(grpRows);
                return (
                  <React.Fragment key={key}>
                    <tr onClick={() => toggleSection(key)}
                      style={{ cursor: "pointer", background: "var(--panel-2)", borderTop: "1px solid var(--line)", userSelect: "none" }}>
                      <td style={{ fontWeight: 800, fontSize: 12, letterSpacing: ".04em", color: "var(--primary)", padding: "8px 14px" }}>
                        <span style={{ marginRight: 8, display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", fontSize: 10 }}>▶</span>
                        {key}
                        <span style={{ marginLeft: 10, fontWeight: 600, color: "var(--ink-3)", fontSize: 11 }}>
                          {grpRows.length} ward{grpRows.length !== 1 ? "s" : ""} · totals shown
                        </span>
                      </td>
                      <td style={{ ...wstC, fontWeight: 800 }}>{gb}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)"  }}>{gocc}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "var(--st-o)"  }}>{go}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "var(--st-or)" }}>{gor}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)"  }}>{gvac}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "var(--st-v)"  }}>{gv}</td>
                      <td style={{ ...wstC, fontWeight: 800, color: "var(--st-vr)" }}>{gvr}</td>
                      <td style={wstC}><OccBar p={gp} /></td>
                      <td><LastUpdatedCell ts={gUpdatedAt} /></td>
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

  const toggle = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  return (
    <div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 12 }}>
        {blocks.length} PRE block{blocks.length !== 1 ? "s" : ""} · today's rounds &amp; ward entry — tap a block to expand
      </div>
      {blocks.map((b) => {
        const isOpen  = !!expanded[b.id];
        const score   = b.compliance.score;
        const scoreColor = score >= 80 ? "var(--green)" : score >= 50 ? "var(--amber)" : "var(--red)";
        const noUser  = !b.assignedUser;
        const totalW  = b.wards.length;
        const doneW   = b.wards.filter(w => w.vacant !== null).length;

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
                    : <>{b.assignedUser.name} · {b.assignedUser.shift}</>}
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
  const hasWardGap  = unassignedWards.length > 0;
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
  { key: "bed",    label: "Bed updates", color: "var(--st-o)",   icon: icons.bed },
  { key: "round",  label: "Rounds",      color: "var(--blue)",   icon: icons.clock },
  { key: "config", label: "Config",      color: "var(--amber)",  icon: icons.settings },
  { key: "login",  label: "Logins",      color: "var(--ink-3)",  icon: icons.user },
];
const ACT_ROLES = [
  { key: "PRE",     label: "PRE",     color: "var(--blue)" },
  { key: "NURSE",   label: "Nurse",   color: "var(--green)" },
  { key: "COO",     label: "Admin",   color: "var(--primary)" },
];
const ACT_BED = ["bed_status_update", "bed_add", "bed_delete", "bed_rename", "beds_generate", "bed_master_edit", "ward_update"];
const ACT_LOGIN = ["login", "login_failed"];
function actCategory(action) {
  if (ACT_BED.includes(action))   return "bed";
  if (action === "round_submit")  return "round";
  if (ACT_LOGIN.includes(action)) return "login";
  return "config";
}
function bedStateText(p, res) {
  if (p === "OCCUPIED") return res === "RESERVED" ? "Occ + Res" : "Occupied";
  if (p === "VACANT")   return res === "RESERVED" ? "Vac + Res" : "Vacant";
  return p || "—";
}

// Reusable numbered pagination (Prev · 1 2 … N · Next), shared by Activity + Bed History.
function Pagination({ page, pages, onPage }) {
  if (!pages || pages <= 1) return null;
  const nums = [];
  const win = 2;
  const start = Math.max(1, page - win), end = Math.min(pages, page + win);
  if (start > 1) { nums.push(1); if (start > 2) nums.push("…l"); }
  for (let i = start; i <= end; i++) nums.push(i);
  if (end < pages) { if (end < pages - 1) nums.push("…r"); nums.push(pages); }
  const btn = (label, target, { disabled, active, key } = {}) => (
    <button key={key || label} disabled={disabled}
      onClick={() => !disabled && target != null && onPage(target)}
      className="chip" style={{
        minWidth: 36, justifyContent: "center", padding: "7px 11px", fontSize: 13,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1,
        background: active ? "var(--primary)" : "var(--panel)",
        color: active ? "#fff" : "var(--ink-2)",
        borderColor: active ? "var(--primary)" : "var(--line)",
      }}>{label}</button>
  );
  return (
    <div className="row" style={{ gap: 6, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
      {btn("‹ Prev", page - 1, { disabled: page <= 1, key: "prev" })}
      {nums.map((n, i) => typeof n === "string"
        ? <span key={n + i} className="dim" style={{ padding: "0 4px", alignSelf: "center" }}>…</span>
        : btn(String(n), n, { active: n === page, key: "p" + n }))}
      {btn("Next ›", page + 1, { disabled: page >= pages, key: "next" })}
    </div>
  );
}

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
  const cat  = actCategory(r.action);
  const cm   = ACT_CATS.find(c => c.key === cat) || ACT_CATS[3];
  const rm   = ACT_ROLES.find(x => x.key === r.role);
  const who  = r.name || r.username || (r.action === "login_failed" ? "Unknown" : "System");
  const chg  = r.change;
  const failed  = r.action === "login_failed";
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
  const [q, setQ]               = useState("");
  const [debouncedQ, setDebQ]   = useState("");
  const [from, setFrom]         = useState("");
  const [to, setTo]             = useState("");
  const [roles, setRoles]       = useState(["PRE", "NURSE"]);
  const [cats, setCats]         = useState(["bed", "round"]);
  const [userId, setUserId]     = useState("");
  const [users, setUsers]       = useState([]);
  const [rows, setRows]         = useState(null);
  const [page, setPage]         = useState(1);
  const [pages, setPages]       = useState(1);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [open, setOpen]         = useState(() => new Set());
  const PER_PAGE = 25;

  useEffect(() => {
    api.mgrUsers()
      .then(d => setUsers((d.users || []).filter(u => u.role === "PRE" || u.role === "NURSE")))
      .catch(() => {});
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
    const esc  = (c) => `"${String(c ?? "").replace(/"/g, '""')}"`;
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

// ══════════════════════════════════════════════════════════════════════════════
//  MIDNIGHT CENSUS MATRIX — same matrix-style table/filter/saved-views UX as
//  Hospital Matrix, but sourced from stored midnight_census snapshots instead
//  of PRE round history. Saved views here use source:"midnight_census" so
//  they never mix with Hospital Matrix's saved views.
// ══════════════════════════════════════════════════════════════════════════════
function MidnightCensusMatrix({ userId }) {
  // ── Date selector — "live" or a captured census date ──────────────────────
  const [censusDates, setCensusDates] = useState([]);
  const [selDate,     setSelDate]     = useState("live");
  useEffect(() => { api.mgrCensusDates().then((d) => setCensusDates(d.dates || [])).catch(() => {}); }, []);
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
    api.cooLiveWards().then(setLiveWards).catch(() => {});
  }, [isLive]);

  // ── Historical census snapshot for the selected date ───────────────────────
  const [censusSnapshot, setCensusSnapshot] = useState(null);
  const [loadingCensus,  setLoadingCensus]  = useState(false);
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
  const [views,        setViews]        = useState([]);
  const [activeViewId, setActiveViewId] = useState(() => {
    const stored = localStorage.getItem(`coo_last_census_view_${userId}`);
    return stored ? Number(stored) : null;
  });
  const [viewModal, setViewModal] = useState(null);
  const [viewToast, setViewToast] = useState("");
  const [confirm, confirmDialog]  = useConfirm();
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
  const myViews     = views.filter(v => !v.is_system && !v.is_shared);

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
      v:  hasData ? (w.vacant            || 0) : 0,
      r:  hasData ? (w.reserved          || 0) : 0,
      o:  hasData ? (w.occupied          || 0) : 0,
      or: hasData ? (w.occupied_reserved || 0) : 0,
      hasData,
    };
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
              <th style={{ ...thStyle("var(--st-o)"),  background: "var(--st-o-bg)"  }}>Total Occ</th>
              <th style={{ ...thStyle("var(--st-o)"),  background: "var(--st-o-bg)"  }}>On Bed</th>
              <th style={{ ...thStyle("var(--st-or)"), background: "var(--st-or-bg)" }}>Occ+Res</th>
              <th style={{ ...thStyle("var(--st-v)"),  background: "var(--st-v-bg)"  }}>Total Vac</th>
              <th style={{ ...thStyle("var(--st-v)"),  background: "var(--st-v-bg)"  }}>Vacant</th>
              <th style={{ ...thStyle("var(--st-vr)"), background: "var(--st-vr-bg)" }}>Vac+Res</th>
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
