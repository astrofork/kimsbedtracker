import React, { useState, useEffect, useRef } from "react";
import { api, fmtTime } from "./lib.js";
import { Ic, icons, StatusBar, ThemeToggle } from "./ui.jsx";

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
  const [sheet, setSheet] = useState(null);
  // date selection: 'live' or a YYYY-MM-DD historical day
  const [dates, setDates] = useState([]);
  const [selDate, setSelDate] = useState("live");
  const [history, setHistory] = useState(null);
  const pollRef = useRef(null);

  const load = async () => {
    try { setData(await api.cooOverview()); } catch (e) {}
    try { setCompliance((await api.cooCompliance()).compliance); } catch (e) {}
  };
  useEffect(() => { load(); pollRef.current = setInterval(load, 15000); return () => clearInterval(pollRef.current); }, []);
  useEffect(() => { api.mgrHistoryDates().then((d) => setDates(d.dates || [])).catch(() => {}); }, []);

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
        <div className="row" style={{ gap: 8 }}>
          <span className="pre-pill"><Ic d={icons.clock} s={13} /> {fmtTime(Date.now())}</span>
          <ThemeToggle />
          <button className="btn btn-ghost" style={{ padding: 9 }} onClick={onLogout}><Ic d={icons.logout} s={17} /></button>
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

        {tab === "overview" && <Overview data={data} compliance={compliance} selDate={selDate} history={history} />}
        {tab === "matrix" && <Matrix data={data} selDate={selDate} history={history} />}
      </div>

      <div className="navbar">
        <NavBtn on={tab === "overview"} ic={icons.home} label="Overview" onClick={() => setTab("overview")} />
        <NavBtn on={tab === "matrix"} ic={icons.grid} label="Matrix" onClick={() => setTab("matrix")} />
      </div>

      {sheet && <WardSheet pre={sheet} onClose={() => setSheet(null)} />}
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
function Overview({ data, compliance, selDate, history }) {
  const isLive = selDate === "live";

  // compute totals from history snapshot when viewing a past day
  let t = data.totals;
  if (!isLive && history) {
    let v = 0, o = 0, r = 0, total = 0;
    for (const round of history) for (const w of round.wards || []) {
      v += w.vacant || 0; o += w.occupied || 0; r += w.reserved || 0; total += w.total || 0;
    }
    t = { v, o, r, total, presReporting: new Set((history || []).map((h) => h.pre)).size, presTotal: data.totals.presTotal };
  }

  const live = t.v + t.o + t.r;
  const occRate = live > 0 ? Math.round((t.o / live) * 100) : 0;
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
        <div className="stat"><div className="n" style={{ color: "var(--red)" }}>{t.o}</div><div className="l">OCCUPIED</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--amber)" }}>{t.r}</div><div className="l">RESERVED</div></div>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 14 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="h2">Occupancy rate</span><span className="chip mono">{occRate}%</span>
        </div>
        <StatusBar v={t.v} o={t.o} r={t.r} total={t.total} />
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
        <div className="card" style={{ padding: 16, marginTop: 14 }}>
          <div className="h2" style={{ marginBottom: 10 }}>Floor occupancy</div>
          {data.floors.map((f) => {
            let v = 0, o = 0, r = 0, total = 0;
            for (const p of f.pres) { v += p.summary.v; o += p.summary.o; r += p.summary.r; total += p.summary.total; }
            if (total === 0) return null;
            return (
              <div key={f.name} style={{ marginBottom: 12 }}>
                <div className="row between" style={{ marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{f.name}</span>
                  <span className="dim mono" style={{ fontSize: 11 }}>{o}/{total} occ</span>
                </div>
                <StatusBar v={v} o={o} r={r} total={total} />
              </div>
            );
          })}
          <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>Team reporting &amp; compliance detail is managed on the Manager dashboard.</div>
        </div>
      )}
    </div>
  );
}

function Matrix({ data, selDate, history }) {
  const isLive = selDate === "live";

  // ── Ward filter — ordered array, persisted in localStorage ──────────────
  // selectedWards is an array of ward names in the order the COO ticked them.
  // Empty array = no manual selection → show all wards alphabetically.
  const [selectedWards, setSelectedWards] = useState(() => {
    try { return JSON.parse(localStorage.getItem("coo_matrix_order") || "[]"); }
    catch { return []; }
  });
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("coo_matrix_order", JSON.stringify(selectedWards));
  }, [selectedWards]);

  const toggleWard = (ward) => setSelectedWards((prev) => {
    if (prev.includes(ward)) return prev.filter((w) => w !== ward); // untick → remove
    return [...prev, ward];                                          // tick   → append
  });
  const showAllWards = () => setSelectedWards([]);                   // clear → back to alphabetical

  // ── Data build ────────────────────────────────────────────────────────────
  // For historical view, build a pre→ward→counts map from the day's rounds.
  const histMap = {};
  if (!isLive && history) {
    for (const round of history) {
      histMap[round.pre] = histMap[round.pre] || {};
      for (const w of round.wards || []) histMap[round.pre][w.ward] = w;
    }
  }

  // Collect all unique ward types across all PREs.
  const wardSet = new Set();
  const allPres = [];
  for (const f of data.floors) for (const p of f.pres) {
    if (p.summary.wards > 0) {
      allPres.push(p);
      for (const w of p.wards) wardSet.add(w.ward);
    }
  }
  const wardTypes = [...wardSet].sort();

  // All rows (unfiltered).
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

  // Apply the ward filter.
  // If selectedWards is empty → show all alphabetically.
  // Otherwise → show only the selected wards in the order they were ticked.
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>Bed matrix</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 12 }}>
        {isLive ? `Vacant & reserved by ward. Updated ${fmtTime(Date.now())}.` : `Final data for ${selDate}.`}
      </div>

      {/* ── Ward filter panel ──────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 12 }}>
        {/* Filter header / toggle */}
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
            {/* chevron rotates based on open state */}
            <span style={{
              display: "inline-flex", color: "var(--ink-3)",
              transform: filterOpen ? "rotate(270deg)" : "rotate(90deg)",
              transition: "transform .2s",
            }}>
              <Ic d={icons.chevron} s={15} />
            </span>
          </span>
        </button>

        {/* Checkbox list (collapsible) */}
        {filterOpen && (
          <div style={{ padding: "12px 14px", borderTop: "1px solid var(--line)" }}>
            {/* Show All shortcut */}
            {isFiltered && (
              <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                <button className="chip" style={{ fontSize: 12 }} onClick={showAllWards}>
                  ✕ Clear selection — show all
                </button>
              </div>
            )}

            {/* Ward toggle chips — always alphabetical for easy browsing */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {wardTypes.map((ward) => {
                const idx = selectedWards.indexOf(ward); // -1 if not selected
                const ticked = idx !== -1;
                return (
                  <button
                    key={ward}
                    onClick={() => toggleWard(ward)}
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

      {/* ── Matrix table ──────────────────────────────────────────────────── */}
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
            {/* Totals row — only counts visible wards */}
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
    </div>
  );
}


function WardSheet({ pre, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
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
                    <StatusBar v={w.vacant} o={w.occupied} r={w.reserved} total={w.total} />
                    <div className="row" style={{ gap: 8, marginTop: 10 }}>
                      <span className="tag v">{w.vacant} vacant</span>
                      <span className="tag o">{w.occupied} occupied</span>
                      <span className="tag r">{w.reserved} reserved</span>
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
