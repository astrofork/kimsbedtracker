import React, { useState, useEffect, useRef } from "react";
import { api, fmtTime, toastErr, friendlyError } from "./lib.js";
import { Ic, icons, StatusBar, ThemeToggle, useModal, AppError, useConfirm, BlockAvatar } from "./ui.jsx";
import {
  snapshotDownload, snapshotCopy, snapshotShare, snapshotCanShare,
} from "./snapshot.js";

const HOSPITAL_NAME = "KIMS Hospitals";

function fmtReminderLabel(hhmm) {
  const [h] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM", hh = h % 12 === 0 ? 12 : h % 12;
  return hh + " " + ap;
}

export default function COOApp({ user, meta, onLogout }) {
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [dismissed, setDismissed] = useState({});
  const [sheet,     setSheet]     = useState(null);
  const [bedsBlock, setBedsBlock] = useState(null); // { pre, label, wards }
  // date selection: 'live' or a YYYY-MM-DD historical day
  const [dates, setDates] = useState([]);
  const [selDate, setSelDate] = useState("live");
  const [history, setHistory] = useState(null);
  const pollRef = useRef(null);

  const load = async () => {
    try { setData(await api.cooOverview()); } catch (e) { }
    try { setCompliance((await api.cooCompliance()).compliance); } catch (e) { }
  };
  useEffect(() => { load(); pollRef.current = setInterval(load, 15000); return () => clearInterval(pollRef.current); }, []);
  useEffect(() => { api.mgrHistoryDates().then((d) => setDates(d.dates || [])).catch(() => { }); }, []);

  // when a historical date is picked, load that day's rounds
  useEffect(() => {
    if (selDate === "live") { setHistory(null); return; }
    api.mgrHistory(selDate).then((d) => setHistory(d.rounds || [])).catch(() => setHistory([]));
  }, [selDate]);

  if (!data) return <div className="app"><div className="empty" style={{ paddingTop: 120 }}><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span><div style={{ marginTop: 12 }}>Loading…</div></div></div>;

  const due = data.dueReminder;

  return (
    <div className="app">
      <div className="topbar">
        <div className="row">
          <div className="logo" style={{ width: 30, height: 30, fontSize: 14 }}>B</div>
          <div><div className="h2">COO Console</div><div className="dim" style={{ fontSize: 11 }}>All floors · live</div></div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="pre-pill" style={{ fontSize: 11, flexDirection: "column", gap: 1, lineHeight: 1.2, padding: "5px 9px" }}>
            <span><Ic d={icons.clock} s={11} /> {fmtTime(Date.now())}</span>
            <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{new Date().toLocaleDateString("en-GB")}</span>
          </span>
          <ThemeToggle />
          <button className="btn btn-ghost" style={{ padding: 8 }} onClick={onLogout}><Ic d={icons.logout} s={17} /></button>
        </div>
      </div>

      <div className="pad" style={{ paddingBottom: 90 }}>
        {due && !dismissed[due] && (
          <div className="card slide-up" style={{ padding: 15, marginBottom: 14, borderColor: "var(--blue)", background: "var(--blue-bg)" }}>
            <div className="row between">
              <div className="row"><span style={{ color: "var(--blue)" }}><Ic d={icons.bell} s={20} /></span>
                <div><div style={{ fontWeight: 700, color: "var(--blue)" }}>3-hour review reminder</div>
                  <div style={{ fontSize: 12, color: "var(--blue)" }}>Your {fmtReminderLabel(due)} bed-status check</div></div></div>
              <button className="chip" onClick={() => setDismissed((d) => ({ ...d, [due]: 1 }))}>Dismiss</button>
            </div>
          </div>
        )}

        {/* date selector — affects all COO views */}
        <DatePicker dates={dates} selDate={selDate} setSelDate={setSelDate} />

        {tab === "overview" && <Overview data={data} compliance={compliance} selDate={selDate} history={history} onViewBeds={setBedsBlock} />}
        {tab === "matrix" && <Matrix data={data} selDate={selDate} history={history} userId={user?.id} />}
      </div>

      <div className="navbar">
        <NavBtn on={tab === "overview"} ic={icons.home} label="Overview" onClick={() => setTab("overview")} />
        <NavBtn on={tab === "matrix"} ic={icons.grid} label="Matrix" onClick={() => setTab("matrix")} />
      </div>

      {sheet     && <WardSheet    pre={sheet}      onClose={() => setSheet(null)} />}
      {bedsBlock && <BlockBedsSheet pre={bedsBlock.pre} label={bedsBlock.label} wards={bedsBlock.wards} onClose={() => setBedsBlock(null)} />}
    </div>
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

function NavBtn({ on, ic, label, onClick }) {
  return <button className={on ? "on" : ""} onClick={onClick}><span style={{ lineHeight: 1 }}><Ic d={ic} s={20} /></span>{label}</button>;
}

// COO Overview — clean executive summary. Honors the date selector: when a past
// date is chosen, totals are computed from that day's submitted rounds.
function Overview({ data, compliance, selDate, history, onViewBeds }) {
  const isLive = selDate === "live";

  // compute totals from history snapshot when viewing a past day
  let t = data.totals;
  if (!isLive && history) {
    let v = 0, o = 0, r = 0, or_ = 0, total = 0;
    for (const round of history) for (const w of round.wards || []) {
      v += w.vacant || 0; o += w.occupied || 0; r += w.reserved || 0;
      or_ += w.occupied_reserved || 0; total += w.total || 0;
    }
    t = { v, o, r, or: or_, total, presReporting: new Set((history || []).map((h) => h.pre)).size, presTotal: data.totals.presTotal };
  }

  const live = t.v + t.o + t.r + (t.or || 0);
  const occRate = live > 0 ? Math.round(((t.o + (t.or || 0)) / live) * 100) : 0;
  const reporting = t.presTotal > 0 ? Math.round((t.presReporting / t.presTotal) * 100) : 0;

  const scored = (compliance || []).filter((c) => c.expected > 0);
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
        <div className="stat"><div className="n" style={{ color: "var(--green)" }}>{t.v}</div><div className="l">VACANT</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--amber)" }}>{t.r}</div><div className="l">VAC+RES</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--red)" }}>{t.o}</div><div className="l">OCCUPIED</div></div>
        <div className="stat"><div className="n" style={{ color: "#8B5CF6" }}>{t.or || 0}</div><div className="l">OCC+RES</div></div>
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
          <div className="n" style={{ color: "var(--teal)", fontSize: 22 }}>{reporting}%</div>
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

            const hasData = s.v + s.o + s.r + (s.or || 0) > 0;

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
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 1, marginTop: 12,
                  background: "var(--panel-2)", borderRadius: 10, overflow: "hidden",
                }}>
                  {[
                    { label: "Vacant",   val: s.v,        color: "var(--green)" },
                    { label: "V+R",      val: s.r,        color: "var(--amber)" },
                    { label: "Occupied", val: s.o,        color: "var(--red)"   },
                    { label: "O+R",      val: s.or || 0,  color: "#8B5CF6"      },
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
  const histMap = {};
  if (!isLive && history) {
    for (const round of history) {
      histMap[round.pre] = histMap[round.pre] || {};
      for (const w of round.wards || []) histMap[round.pre][w.ward] = w;
    }
  }

  const wardSet = new Set();
  const allPres = [];
  for (const f of data.floors) for (const p of f.pres) {
    if (p.summary.wards > 0) {
      allPres.push(p);
      for (const w of p.wards) wardSet.add(w.ward);
    }
  }
  const wardTypes = [...wardSet].sort();

  const allRows = wardTypes.map((ward) => {
    let totalV = 0, totalR = 0, hasData = false;
    for (const p of allPres) {
      if (!isLive) {
        const h = histMap[p.pre]?.[ward];
        if (h) { totalV += h.vacant || 0; totalR += h.reserved || 0; hasData = true; }
      } else {
        const w = p.wards.find((x) => x.ward === ward);
        if (w && w.vacant !== null) { totalV += w.vacant || 0; totalR += w.reserved || 0; hasData = true; }
      }
    }
    return { ward, v: totalV, r: totalR, hasData };
  });

  const isFiltered = selectedWards.length > 0;
  const rows = isFiltered
    ? selectedWards.map((ward) => allRows.find((r) => r.ward === ward)).filter(Boolean)
    : allRows;
  const visibleCount = isFiltered ? selectedWards.length : wardTypes.length;
  const grandV = rows.reduce((a, r) => a + r.v, 0);
  const grandR = rows.reduce((a, r) => a + r.r, 0);

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
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>Bed Vacant</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 12 }}>
        {isLive ? `Vacant & reserved by ward. Updated ${fmtTime(Date.now())}.` : `Final data for ${selDate}.`}
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
                        ? "This view is shared with all COO users. Deleting it removes it for everyone.\n\nThis cannot be undone."
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

      {/* ── Matrix table — unchanged ─────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "11px 16px", fontWeight: 700, fontSize: 13, color: "var(--ink-2)", background: "var(--panel-2)", minWidth: 140 }}>Ward</th>
              <th style={thStyle("var(--green)")}>Vacant</th>
              <th style={thStyle("var(--amber)")}>Reserved</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: "24px 16px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
                  No data available.
                </td>
              </tr>
            ) : (
              rows.map((row, ri) => (
                <tr key={row.ward}>
                  <td style={{ padding: "10px 16px", fontWeight: 600, borderTop: "1px solid var(--line)", background: ri % 2 ? "var(--panel)" : "var(--panel-2)" }}>{row.ward}</td>
                  <td style={tdStyle(row.hasData && row.v > 0 ? "var(--green)" : "var(--ink-3)", ri % 2)}>
                    {row.hasData ? row.v : <span className="dim">–</span>}
                  </td>
                  <td style={tdStyle(row.hasData && row.r > 0 ? "var(--amber)" : "var(--ink-3)", ri % 2)}>
                    {row.hasData ? row.r : <span className="dim">–</span>}
                  </td>
                </tr>
              ))
            )}
            {rows.length > 0 && (
              <tr>
                <td style={{ padding: "12px 16px", fontWeight: 800, color: "var(--teal)", borderTop: "2px solid var(--line)", background: "var(--panel-2)" }}>
                  Total{isFiltered ? <span style={{ fontWeight: 400, fontSize: 11, color: "var(--ink-3)", marginLeft: 6 }}>(filtered)</span> : null}
                </td>
                <td style={{ textAlign: "center", padding: "12px 16px", borderTop: "2px solid var(--line)", borderLeft: "1px solid var(--line)", fontWeight: 800, fontSize: 16, color: "var(--green)", background: "var(--panel-2)" }} className="mono">{grandV}</td>
                <td style={{ textAlign: "center", padding: "12px 16px", borderTop: "2px solid var(--line)", borderLeft: "1px solid var(--line)", fontWeight: 800, fontSize: 16, color: "var(--amber)", background: "var(--panel-2)" }} className="mono">{grandR}</td>
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

      {/* Off-screen snapshot target — rendered with fixed light styling so the
          export looks the same regardless of active theme, then html2canvas
          captures it. Positioned far off-screen so it never affects layout. */}
      <div
        ref={snapshotRef}
        id="snapshot-report"
        aria-hidden="true"
        style={{
          position: "fixed",
          left: -10000,
          top: 0,
          width: 720,
          pointerEvents: "none",
        }}
      >
        <SnapshotReport
          viewLabel={viewLabel}
          isLive={isLive}
          selDate={selDate}
          rows={rows}
          grandV={grandV}
          grandR={grandR}
          isFiltered={isFiltered}
        />
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
            <button className={isShared  ? "on" : ""} onClick={() => setIsShared(true)}>Shared (all COO)</button>
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

function SnapshotReport({ viewLabel, isLive, selDate, rows, grandV, grandR, isFiltered }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });

  // Hard-coded light palette so the export looks the same in any theme
  const C = {
    ink: "#0b1220", ink2: "#3b4350", ink3: "#7a8493",
    line: "#e3e8ef", panel: "#ffffff", panel2: "#f6f8fb",
    teal: "#0EA5A1", tealDeep: "#0F766E",
    green: "#16a34a", amber: "#d97706", red: "#dc2626",
  };

  return (
    <div style={{
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      background: C.panel, color: C.ink,
      padding: 32, width: "100%", boxSizing: "border-box",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: `linear-gradient(135deg, ${C.teal}, ${C.tealDeep})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 800, fontSize: 22, letterSpacing: ".5px",
          }}>B</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, lineHeight: 1.2 }}>{HOSPITAL_NAME}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.teal, marginTop: 2 }}>BedFlow · Live Vacant Report</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: C.ink3, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>Generated</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginTop: 2 }}>{dateStr}</div>
          <div style={{ fontSize: 12, color: C.ink2 }}>{timeStr}</div>
        </div>
      </div>

      {/* View name banner */}
      <div style={{
        background: C.panel2, borderRadius: 10, padding: "12px 16px",
        marginBottom: 18, borderLeft: `4px solid ${C.teal}`,
      }}>
        <div style={{ fontSize: 11, color: C.ink3, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>View</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, marginTop: 2 }}>
          {viewLabel}
          {isFiltered && <span style={{ fontSize: 11, color: C.ink3, fontWeight: 500, marginLeft: 8 }}>(filtered)</span>}
        </div>
        <div style={{ fontSize: 12, color: C.ink2, marginTop: 4 }}>
          {isLive ? "Live data — current round" : `Final data for ${selDate}`}
        </div>
      </div>

      {/* Summary stat strip */}
      <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
        <div style={{ flex: 1, background: C.panel2, borderRadius: 10, padding: "14px 16px", borderTop: `3px solid ${C.green}` }}>
          <div style={{ fontSize: 11, color: C.ink3, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>Total Vacant</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: C.green, lineHeight: 1.1, marginTop: 4 }}>{grandV}</div>
        </div>
        <div style={{ flex: 1, background: C.panel2, borderRadius: 10, padding: "14px 16px", borderTop: `3px solid ${C.amber}` }}>
          <div style={{ fontSize: 11, color: C.ink3, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>Total Reserved</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: C.amber, lineHeight: 1.1, marginTop: 4 }}>{grandR}</div>
        </div>
        <div style={{ flex: 1, background: C.panel2, borderRadius: 10, padding: "14px 16px", borderTop: `3px solid ${C.teal}` }}>
          <div style={{ fontSize: 11, color: C.ink3, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>Wards</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: C.ink, lineHeight: 1.1, marginTop: 4 }}>{rows.length}</div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: C.line, marginBottom: 18 }} />

      {/* Matrix table */}
      <div style={{
        border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden",
      }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
          <thead>
            <tr style={{ background: C.panel2 }}>
              <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 700, fontSize: 12, color: C.ink2, textTransform: "uppercase", letterSpacing: ".04em" }}>Ward</th>
              <th style={{ textAlign: "center", padding: "12px 16px", fontWeight: 700, fontSize: 12, color: C.green, textTransform: "uppercase", letterSpacing: ".04em", borderLeft: `1px solid ${C.line}` }}>Vacant</th>
              <th style={{ textAlign: "center", padding: "12px 16px", fontWeight: 700, fontSize: 12, color: C.amber, textTransform: "uppercase", letterSpacing: ".04em", borderLeft: `1px solid ${C.line}` }}>Reserved</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: "28px 16px", textAlign: "center", color: C.ink3, fontSize: 13 }}>
                  No data available.
                </td>
              </tr>
            ) : (
              rows.map((row, ri) => (
                <tr key={row.ward} style={{ background: ri % 2 ? C.panel : C.panel2 }}>
                  <td style={{ padding: "11px 16px", fontWeight: 600, color: C.ink, borderTop: `1px solid ${C.line}` }}>{row.ward}</td>
                  <td style={{ textAlign: "center", padding: "11px 16px", fontWeight: 700, fontSize: 15, color: row.hasData && row.v > 0 ? C.green : C.ink3, borderTop: `1px solid ${C.line}`, borderLeft: `1px solid ${C.line}` }}>
                    {row.hasData ? row.v : "–"}
                  </td>
                  <td style={{ textAlign: "center", padding: "11px 16px", fontWeight: 700, fontSize: 15, color: row.hasData && row.r > 0 ? C.amber : C.ink3, borderTop: `1px solid ${C.line}`, borderLeft: `1px solid ${C.line}` }}>
                    {row.hasData ? row.r : "–"}
                  </td>
                </tr>
              ))
            )}
            {rows.length > 0 && (
              <tr style={{ background: C.panel2 }}>
                <td style={{ padding: "13px 16px", fontWeight: 800, color: C.tealDeep, borderTop: `2px solid ${C.line}` }}>Total</td>
                <td style={{ textAlign: "center", padding: "13px 16px", fontWeight: 800, fontSize: 16, color: C.green, borderTop: `2px solid ${C.line}`, borderLeft: `1px solid ${C.line}` }}>{grandV}</td>
                <td style={{ textAlign: "center", padding: "13px 16px", fontWeight: 800, fontSize: 16, color: C.amber, borderTop: `2px solid ${C.line}`, borderLeft: `1px solid ${C.line}` }}>{grandR}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 22, paddingTop: 14, borderTop: `1px solid ${C.line}`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 11, color: C.ink3,
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
  const counts  = { vn: 0, vr: 0, on_: 0, or_: 0 };
  for (const b of allBeds) {
    if (b.physical_status === "VACANT"   && b.reservation_status === "NONE")     counts.vn++;
    if (b.physical_status === "VACANT"   && b.reservation_status === "RESERVED") counts.vr++;
    if (b.physical_status === "OCCUPIED" && b.reservation_status === "NONE")     counts.on_++;
    if (b.physical_status === "OCCUPIED" && b.reservation_status === "RESERVED") counts.or_++;
  }

  function stateColor(p, r) {
    if (p === "VACANT"   && r === "NONE")     return "var(--green)";
    if (p === "VACANT"   && r === "RESERVED") return "var(--amber)";
    if (p === "OCCUPIED" && r === "NONE")     return "var(--red)";
    if (p === "OCCUPIED" && r === "RESERVED") return "#8B5CF6";
    return "var(--ink-3)";
  }
  function stateCode(p, r) {
    if (p === "VACANT"   && r === "NONE")     return "V";
    if (p === "VACANT"   && r === "RESERVED") return "V+R";
    if (p === "OCCUPIED" && r === "NONE")     return "O";
    if (p === "OCCUPIED" && r === "RESERVED") return "O+R";
    return "?";
  }

  const chips = [
    { key: "ALL",  label: `All (${allBeds.length})`,               color: "var(--ink)"   },
    { key: "V",    label: `Vac (${counts.vn})`,                    color: "var(--green)" },
    { key: "V+R",  label: `V+R (${counts.vr})`,                    color: "var(--amber)" },
    { key: "O",    label: `Occ (${counts.on_})`,                   color: "var(--red)"   },
    { key: "O+R",  label: `O+R (${counts.or_})`,                   color: "#8B5CF6"      },
    { key: "R",    label: `Res (${counts.vr + counts.or_})`,       color: "var(--amber)" },
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
              {chips.map(({ key, label, color }) => (
                <button key={key} onClick={() => setFilter(key)} style={{
                  padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                  border: `1.5px solid ${color}`,
                  background: filter === key ? color : "transparent",
                  color: filter === key ? "#fff" : color,
                  cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
                }}>{label}</button>
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
                  if (filter === "O+R") return b.physical_status === "OCCUPIED" && b.reservation_status === "RESERVED";
                  if (filter === "R")   return b.reservation_status === "RESERVED";
                  return true;
                })
                .sort((a, b) => {
                  const na = parseInt(a.bed_number, 10), nb = parseInt(b.bed_number, 10);
                  return !isNaN(na) && !isNaN(nb) ? na - nb : a.bed_number.localeCompare(b.bed_number);
                });
              if (wardBeds.length === 0) return null;
              return (
                <div key={w.ward} style={{ marginBottom: 18 }}>
                  <div className="row between" style={{ marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{w.ward}</span>
                    <span className="dim" style={{ fontSize: 12 }}>{(bedsByWard[w.ward] || []).length} beds</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 6 }}>
                    {wardBeds.map((bed) => {
                      const color = stateColor(bed.physical_status, bed.reservation_status);
                      const code  = stateCode(bed.physical_status, bed.reservation_status);
                      return (
                        <div key={bed.id} style={{
                          padding: "7px 4px 8px", borderRadius: 10, textAlign: "center",
                          background: "var(--panel-2)", border: `2px solid ${color}`,
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)", marginBottom: 3, lineHeight: 1.2 }}>
                            {bed.bed_number}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 900, color, lineHeight: 1 }}>{code}</div>
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
                    <StatusBar v={w.vacant} r={w.reserved} o={w.occupied} or={w.occupied_reserved} total={w.total} />
                    <div className="row" style={{ gap: 8, marginTop: 10 }}>
                      <span className="tag v">{w.vacant} vacant</span>
                      <span className="tag r">{w.reserved} vac+res</span>
                      <span className="tag o">{w.occupied} occupied</span>
                      {(w.occupied_reserved || 0) > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#8B5CF6", background: "#8B5CF620", borderRadius: 8, padding: "2px 6px" }}>{w.occupied_reserved} occ+res</span>}
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
