import React, { useState, useEffect, useRef } from "react";
import { api, fmtTime } from "./lib.js";
import { Ic, icons, StatusBar } from "./ui.jsx";

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
          <button className="btn btn-ghost" style={{ padding: 9 }} onClick={onLogout}><Ic d={icons.logout} s={17} /></button>
        </div>
      </div>

      <div className="pad" style={{ paddingBottom: 90 }}>
        {due && !dismissed[due] && (
          <div className="card slide-up" style={{ padding: 15, marginBottom: 14, borderColor: "var(--blue)", background: "var(--blue-bg)" }}>
            <div className="row between">
              <div className="row"><span style={{ color: "var(--blue)" }}><Ic d={icons.bell} s={20} /></span>
                <div><div style={{ fontWeight: 700, color: "var(--blue)" }}>3-hour review reminder</div>
                  <div style={{ fontSize: 12, color: "#a9cdf5" }}>Your {fmtReminderLabel(due)} bed-status check</div></div></div>
              <button className="chip" onClick={() => setDismissed((d) => ({ ...d, [due]: 1 }))}>Dismiss</button>
            </div>
          </div>
        )}

        {/* date selector — affects all COO views */}
        <DatePicker dates={dates} selDate={selDate} setSelDate={setSelDate} />

        {tab === "overview" && <Overview data={data} compliance={compliance} selDate={selDate} history={history} />}
        {tab === "matrix" && <Matrix data={data} selDate={selDate} history={history} onOpen={setSheet} />}
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

function Matrix({ data, selDate, history, onOpen }) {
  const isLive = selDate === "live";

  // For historical view, build a pre→ward→counts map from the day's rounds.
  const histMap = {};
  if (!isLive && history) {
    for (const round of history) {
      histMap[round.pre] = histMap[round.pre] || {};
      for (const w of round.wards || []) histMap[round.pre][w.ward] = w;
    }
  }

  // Build ward-type × PRE matrix. Rows = unique ward types, cols = PREs with beds.
  const pres = [];
  const wardSet = new Set();
  for (const f of data.floors) for (const p of f.pres) {
    if (p.summary.wards > 0) {
      pres.push(p);
      for (const w of p.wards) wardSet.add(w.ward);
    }
  }
  const wardTypes = [...wardSet].sort();

  // cell lookup honoring date selection
  const cell = (p, ward) => {
    if (!isLive) {
      const h = histMap[p.pre]?.[ward];
      if (!h) return p.wards.find((x) => x.ward === ward) ? { ...p.wards.find((x) => x.ward === ward), entered: false } : null;
      return { ...h, entered: true };
    }
    const w = p.wards.find((x) => x.ward === ward);
    if (!w) return null;
    return { ...w, entered: w.vacant !== null };
  };

  const colW = 74;

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>Occupancy matrix</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        {isLive ? `Occupied / vacant by ward × PRE. Updated ${fmtTime(Date.now())}.` : `Final data for ${selDate}.`}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0, background: "var(--panel-2)", textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "var(--ink-2)", minWidth: 120, zIndex: 2 }}>Ward</th>
                {pres.map((p) => (
                  <th key={p.pre} style={{ padding: "10px 6px", fontWeight: 700, color: "var(--ink-2)", minWidth: colW, borderLeft: "1px solid var(--line)", cursor: "pointer" }}
                    onClick={() => onOpen && onOpen(p)}>
                    {p.pre.replace("PRE-", "P")}
                  </th>
                ))}
                <th style={{ padding: "10px 8px", fontWeight: 700, color: "var(--teal)", borderLeft: "1px solid var(--line)", background: "var(--panel-2)" }}>Tot</th>
              </tr>
              <tr>
                <th style={{ position: "sticky", left: 0, background: "var(--panel-2)", textAlign: "left", padding: "2px 12px 7px", fontWeight: 500, color: "var(--ink-3)", fontSize: 10, zIndex: 2 }}>occ · vac</th>
                {pres.map((p) => <th key={p.pre} style={{ borderLeft: "1px solid var(--line)" }} />)}
                <th style={{ borderLeft: "1px solid var(--line)", background: "var(--panel-2)" }} />
              </tr>
            </thead>
            <tbody>
              {wardTypes.map((ward, ri) => {
                let rowOcc = 0, rowVac = 0, rowTot = 0;
                const cells = pres.map((p) => {
                  const c = cell(p, ward);
                  if (c && c.entered) { rowOcc += c.occupied || 0; rowVac += c.vacant || 0; }
                  if (c) rowTot += c.total;
                  return c;
                });
                return (
                  <tr key={ward} style={{ background: ri % 2 ? "transparent" : "rgba(255,255,255,.015)" }}>
                    <td style={{ position: "sticky", left: 0, background: ri % 2 ? "var(--panel)" : "#141c24", padding: "9px 12px", fontWeight: 600, borderTop: "1px solid var(--line)", zIndex: 1 }}>{ward}</td>
                    {cells.map((c, i) => (
                      <td key={i} style={{ textAlign: "center", padding: "9px 6px", borderTop: "1px solid var(--line)", borderLeft: "1px solid var(--line)" }}>
                        {!c ? <span className="dim">·</span>
                          : !c.entered ? <span style={{ color: "var(--ink-3)" }}>–</span>
                            : <span className="mono" style={{ fontWeight: 700, fontSize: 12 }}>
                                <span style={{ color: c.occupied === c.total ? "var(--red)" : "var(--ink)" }}>{c.occupied}</span>
                                <span className="dim" style={{ fontWeight: 400 }}> · </span>
                                <span style={{ color: c.vacant > 0 ? "var(--green)" : "var(--ink-3)" }}>{c.vacant}</span>
                              </span>}
                      </td>
                    ))}
                    <td style={{ textAlign: "center", padding: "9px 8px", borderTop: "1px solid var(--line)", borderLeft: "1px solid var(--line)", background: "var(--panel-2)", fontWeight: 700 }} className="mono">
                      <span style={{ color: "var(--red)" }}>{rowOcc}</span><span className="dim">·</span><span style={{ color: "var(--green)" }}>{rowVac}</span>
                    </td>
                  </tr>
                );
              })}
              {/* totals row */}
              <tr>
                <td style={{ position: "sticky", left: 0, background: "var(--panel-2)", padding: "11px 12px", fontWeight: 800, color: "var(--teal)", borderTop: "2px solid var(--line)", zIndex: 1 }}>Total</td>
                {pres.map((p) => {
                  const wards = !isLive ? Object.values(histMap[p.pre] || {}) : p.wards.filter((w) => w.vacant !== null);
                  const o = wards.reduce((a, w) => a + (w.occupied || 0), 0);
                  const v = wards.reduce((a, w) => a + (w.vacant || 0), 0);
                  const any = wards.length > 0;
                  return (
                    <td key={p.pre} style={{ textAlign: "center", padding: "11px 6px", borderTop: "2px solid var(--line)", borderLeft: "1px solid var(--line)", fontWeight: 800, background: "var(--panel-2)" }} className="mono">
                      {any ? <><span style={{ color: "var(--red)" }}>{o}</span><span className="dim">·</span><span style={{ color: "var(--green)" }}>{v}</span></> : "–"}
                    </td>
                  );
                })}
                <td style={{ textAlign: "center", padding: "11px 8px", borderTop: "2px solid var(--line)", borderLeft: "1px solid var(--line)", background: "var(--teal)", color: "#04201c", fontWeight: 800 }} className="mono">
                  {data.totals.o}·{data.totals.v}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="row" style={{ gap: 14, marginTop: 12, flexWrap: "wrap" }}>
        <span className="dim" style={{ fontSize: 11 }}>each cell: <span style={{ color: "var(--red)" }}>occupied</span> · <span style={{ color: "var(--green)" }}>vacant</span></span>
        <span className="dim" style={{ fontSize: 11 }}>– = not entered · · = no ward</span>
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
