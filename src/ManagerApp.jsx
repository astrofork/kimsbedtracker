import React, { useState, useEffect } from "react";
import { api, fmtTime, fmtClock, toastErr, toMs } from "./lib.js";
import { Ic, icons, StatusBar, ThemeToggle, useModal, BlockAvatar, useConfirm } from "./ui.jsx";

export default function ManagerApp({ user, onLogout }) {
  const [tab, setTab] = useState("setup");

  const [toast, setToast] = useState("");
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 2400); };

  return (
    <div className="app">
      <div className="topbar">
        <div className="row">
          <div className="logo" style={{ width: 30, height: 30, fontSize: 14 }}>B</div>
          <div><div className="h2">Manager</div><div className="dim" style={{ fontSize: 11 }}>Setup &amp; control</div></div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="pre-pill" style={{ flexDirection: "column", gap: 1, lineHeight: 1.2, padding: "5px 9px" }}>
            <span style={{ fontSize: 11 }}><Ic d={icons.clock} s={11} /> {fmtTime(Date.now())}</span>
            <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{new Date().toLocaleDateString("en-GB")}</span>
          </span>
          <ThemeToggle />
          <button className="btn btn-ghost" style={{ padding: 9 }} onClick={onLogout}><Ic d={icons.logout} s={17} /></button>
        </div>
      </div>

      <div className="pad" style={{ paddingBottom: 90 }}>
        {tab === "report"     && <Reporting />}
        {tab === "setup"      && <HierarchyManager showToast={showToast} />}
        {tab === "preblocks"  && <PreBlockManager showToast={showToast} />}
        {tab === "pres"       && <PreManager showToast={showToast} />}
        {tab === "stations"   && <StationManager showToast={showToast} />}
        {tab === "nurses"     && <NurseManager showToast={showToast} />}
        {tab === "history"    && <HistoryViewer />}
      </div>

      <div className="navbar">
        <NavBtn on={tab === "report"}    ic={icons.map}   label="Report"    onClick={() => setTab("report")} />
        <NavBtn on={tab === "setup"}     ic={icons.bed}   label="Setup"     onClick={() => setTab("setup")} />
        <NavBtn on={tab === "preblocks"} ic={icons.user}  label="PRE Blks"  onClick={() => setTab("preblocks")} />
        <NavBtn on={tab === "pres"}      ic={icons.user}  label="PRE"       onClick={() => setTab("pres")} />
        <NavBtn on={tab === "stations"}  ic={icons.bed}   label="Stations"  onClick={() => setTab("stations")} />
        <NavBtn on={tab === "nurses"}    ic={icons.user}  label="Nurses"    onClick={() => setTab("nurses")} />
        <NavBtn on={tab === "history"}   ic={icons.clock} label="History"   onClick={() => setTab("history")} />
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function NavBtn({ on, ic, label, onClick }) {
  return <button className={on ? "on" : ""} onClick={onClick}><span style={{ lineHeight: 1 }}><Ic d={ic} s={20} /></span>{label}</button>;
}

// ══════════════════════════════════════════════════════════════════════════════
//  REPORTING
// ══════════════════════════════════════════════════════════════════════════════
const STALE_MS = 3 * 60 * 60 * 1000;

function elapsed(ts) {
  const t = toMs(ts);
  if (t == null) return "never";
  const ms = Date.now() - t;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 1) return `${h}h ${m}m ago`;
  return `${m}m ago`;
}

function MiniStats({ v, r, o, or: or_, notUpdated, lastUpdatedAt }) {
  const stats = [
    { label: "Vacant",   val: v,          color: "var(--green)" },
    { label: "V+R",      val: r,          color: "var(--amber)" },
    { label: "Occupied", val: o,          color: "var(--red)"   },
    { label: "O+R",      val: or_ || 0,   color: "#8B5CF6"      },
    { label: "No data",  val: notUpdated, color: "var(--ink-3)" },
  ];
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", background: "var(--panel-2)", borderRadius: 10, overflow: "hidden" }}>
        {stats.map(({ label, val, color }, i) => (
          <div key={label} style={{
            flex: 1, textAlign: "center", padding: "9px 2px",
            borderLeft: i > 0 ? "1px solid var(--line)" : "none",
          }}>
            <div style={{ fontSize: 9, color: "var(--ink-3)", fontWeight: 600, marginBottom: 4, letterSpacing: 0.2 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{val}</div>
          </div>
        ))}
      </div>
      {lastUpdatedAt && (
        <div className="dim" style={{ fontSize: 10, marginTop: 5, textAlign: "right" }}>
          Last update {fmtTime(lastUpdatedAt)}
        </div>
      )}
    </div>
  );
}

function Reporting() {
  const [data,       setData]       = useState(null);
  const [compliance, setCompliance] = useState([]);
  const [audit,      setAudit]      = useState([]);
  const [kpis,       setKpis]       = useState(null);
  const [bedsBlock,  setBedsBlock]  = useState(null); // { pre, wards } | null

  const load = async () => {
    try { setData(await api.cooOverview()); } catch {}
    try { setCompliance((await api.cooCompliance()).compliance || []); } catch {}
    try { setAudit((await api.cooAudit()).logs || []); } catch {}
    try { setKpis(await api.mgrKpis()); } catch {}
  };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  if (!data) return (
    <div className="empty">
      <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={24} /></span>
      <div style={{ marginTop: 10 }}>Loading…</div>
    </div>
  );

  // Only score blocks that actually have a PRE assigned — unstaffed blocks
  // cannot submit rounds, so counting them buries the real signal.
  const assignedFloors = new Set();
  for (const f of data.floors) for (const p of f.pres)
    if (p.assignedUser) assignedFloors.add(p.pre);

  const compByPre = {};
  for (const c of compliance) compByPre[c.floor || c.block] = c;
  const scored  = compliance.filter((c) => c.expected > 0 && assignedFloors.has(c.floor || c.block));
  const avg     = scored.length ? Math.round(scored.reduce((a, c) => a + c.score, 0) / scored.length) : 100;
  const lagging = scored.filter((c) => c.score < 100).length;
  const unstaffed = data.floors.reduce((n, f) => n + f.pres.filter((p) => !p.assignedUser).length, 0);
  const compByFloor = compByPre; // alias

  const now = Date.now();
  const stale = [];
  for (const f of data.floors) for (const p of f.pres)
    for (const w of p.wards) {
      const ts = toMs(w.updatedAt);
      if (w.vacant !== null && ts && now - ts > STALE_MS)
        stale.push({ pre: p.pre, ward: w.ward, updatedAt: ts, age: now - ts });
    }
  stale.sort((a, b) => b.age - a.age);

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 2 }}>Team Report</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>Live compliance, bed status and activity.</div>

      {/* ── Bed master KPIs ── */}
      {kpis && (
        <div className="card glass" style={{ padding: 16, marginBottom: 12 }}>
          <div className="row between" style={{ marginBottom: 12 }}>
            <span className="h2">Hospital bed master</span>
            <span className="chip mono">{kpis.occupancy_pct}% occupied</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {[
              { label: "Total",      val: kpis.total,             color: "var(--ink)"   },
              { label: "Census",     val: kpis.census,            color: "var(--teal)"  },
              { label: "Non-Census", val: kpis.non_census,        color: "var(--ink-2)" },
              { label: "Non-Op",     val: kpis.non_operational,   color: "var(--red)"   },
              { label: "Vacant",     val: kpis.vacant,            color: "var(--green)" },
              { label: "Vac+Res",    val: kpis.vacant_reserved,   color: "var(--amber)" },
              { label: "Occupied",   val: kpis.occupied,          color: "var(--red)"   },
              { label: "Occ+Res",    val: kpis.occupied_reserved, color: "#8B5CF6"      },
            ].map(({ label, val, color }) => (
              <div key={label} style={{
                textAlign: "center", padding: "10px 4px",
                background: "var(--panel-2)", borderRadius: 10,
              }}>
                <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 9.5, color: "var(--ink-3)", fontWeight: 600, marginTop: 5, letterSpacing: 0.2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Compliance summary ── */}
      <div className="card" style={{
        padding: 16, marginBottom: 12,
        borderColor: avg >= 80 ? "var(--teal-deep)" : avg >= 50 ? "var(--amber)" : "var(--red)",
      }}>
        <div className="row between">
          <div>
            <div className="h2">Today's round compliance</div>
            <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>
              {lagging === 0
                ? "All staffed floors are submitting on time"
                : `${lagging} staffed floor${lagging > 1 ? "s" : ""} behind schedule`}
              {unstaffed > 0 && ` · ${unstaffed} unstaffed`}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mono" style={{
              fontSize: 32, fontWeight: 800, lineHeight: 1,
              color: avg >= 80 ? "var(--green)" : avg >= 50 ? "var(--amber)" : "var(--red)",
            }}>{avg}%</div>
            <div className="dim" style={{ fontSize: 10, marginTop: 2 }}>on-time rounds</div>
          </div>
        </div>
      </div>

      {/* ── Stale ward warnings ── */}
      {stale.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 12, borderColor: "var(--red)" }}>
          <div style={{ padding: "12px 14px", background: "var(--red-bg)" }}>
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <span style={{ color: "var(--red)" }}><Ic d={icons.bell} s={17} /></span>
              <span style={{ fontWeight: 700, fontSize: 14, color: "var(--red)" }}>
                {stale.length} ward{stale.length > 1 ? "s" : ""} with outdated data
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--red)", opacity: 0.85, paddingLeft: 25 }}>
              These wards haven't been updated in over 3 hours. The PRE team may need a prompt.
            </div>
          </div>
          <div style={{ padding: "0 14px" }}>
            {stale.map((s, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 0",
                borderBottom: i < stale.length - 1 ? "1px solid var(--line)" : "none",
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {s.pre} · <span style={{ color: "var(--ink-2)" }}>{s.ward}</span>
                  </div>
                  <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                    Last updated at {fmtTime(s.updatedAt)}
                  </div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20,
                  background: "var(--red-bg)", color: "var(--red)", border: "1px solid var(--red)",
                  whiteSpace: "nowrap",
                }}>
                  {elapsed(s.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Block cards, grouped by block label (A / B / …) ── */}
      {(() => {
        const groups = {};
        for (const f of data.floors) for (const p of f.pres) {
          const g = p.label && p.label !== p.pre ? p.label : "Other";
          (groups[g] ||= []).push(p);
        }
        return Object.entries(groups).map(([g, pres]) => ({ name: g, pres }));
      })().map((f) => (
        <div key={f.name}>
          <div className="floor-head">{f.name}</div>
          {f.pres.map((p) => {
            const s = p.summary;
            const c = compByPre[p.pre];
            const statusTag = s.wards === 0
              ? <span className="tag b">No wards</span>
              : p.alarm?.alarmActive
                ? <span className="tag o pulse">Overdue</span>
                : s.complete
                  ? <span className="tag v"><Ic d={icons.check} s={12} /> Done</span>
                  : s.wardsDone > 0
                    ? <span className="tag r">{Math.round((s.wardsDone / s.wards) * 100)}% done</span>
                    : <span className="tag o">No data yet</span>;

            return (
              <div className="card" key={p.pre} style={{ padding: 14, marginBottom: 10 }}>
                {/* Header */}
                <div className="row between">
                  <div className="row" style={{ gap: 10 }}>
                    <BlockAvatar code={p.pre} size={38} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.pre}</div>
                      <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                        {p.assignedUser ? p.assignedUser.name : "No PRE assigned"}
                        {s.wards > 0 && ` · ${s.wards} ward${s.wards !== 1 ? "s" : ""} · ${s.total} beds`}
                      </div>
                    </div>
                  </div>
                  {statusTag}
                </div>

                {s.wards > 0 && (
                  <>
                    {/* Occupancy bar — show a dim placeholder when no data entered yet */}
                    <div style={{ marginTop: 14 }}>
                      {s.v + s.o + s.r + (s.or || 0) > 0
                        ? <StatusBar v={s.v} r={s.r} o={s.o} or={s.or || 0} total={s.total} />
                        : <div className="bar"><span style={{ flex: 1, background: "var(--line)" }} /></div>
                      }
                    </div>

                    {/* Mini stats block */}
                    <MiniStats
                      v={s.v} r={s.r} o={s.o} or={s.or || 0}
                      notUpdated={s.wards - s.wardsDone}
                      lastUpdatedAt={(() => {
                        const ts = p.wards.map(w => w.updatedAt).filter(Boolean);
                        return ts.length ? Math.max(...ts) : null;
                      })()}
                    />

                    {/* Footer row: rounds + view beds */}
                    <div className="row between" style={{ marginTop: 12 }}>
                      <div>
                        {c && c.expected > 0 ? (
                          <div className="row" style={{ gap: 8 }}>
                            <span className="dim" style={{ fontSize: 11 }}>
                              Rounds {c.submitted}/{c.expected}
                            </span>
                            <span className="mono" style={{
                              fontSize: 12, fontWeight: 700,
                              color: c.score >= 80 ? "var(--green)" : c.score >= 50 ? "var(--amber)" : "var(--red)",
                            }}>{c.score}%</span>
                            {p.lastSubmittedAt && (
                              <span className="dim" style={{ fontSize: 11 }}>· last {fmtTime(p.lastSubmittedAt)}</span>
                            )}
                          </div>
                        ) : (
                          <span className="dim" style={{ fontSize: 11 }}>No rounds yet today</span>
                        )}
                      </div>
                      <button
                        className="chip"
                        style={{ fontSize: 11, color: "var(--teal)" }}
                        onClick={() => setBedsBlock({ pre: p.pre, label: p.label, wards: p.wards })}
                      >
                        <Ic d={icons.grid} s={12} /> View beds
                      </button>
                    </div>
                  </>
                )}

                {/* No PRE warning */}
                {!p.assignedUser && (
                  <div style={{
                    marginTop: 10, padding: "8px 10px", borderRadius: 8,
                    background: "var(--amber-bg)", fontSize: 12,
                    color: "var(--amber)", fontWeight: 600,
                  }}>
                    ⚠️ No PRE user assigned — this block has no one reporting
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* ── Recent activity ── */}
      <div className="floor-head">Recent activity</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {audit.slice(0, 12).map((a, i) => (
          <div key={i} className="row between" style={{
            padding: "10px 14px",
            borderBottom: i < Math.min(audit.length, 12) - 1 ? "1px solid var(--line)" : "none",
            background: i % 2 ? "var(--panel-2)" : "transparent",
          }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="dim" style={{ fontSize: 11, minWidth: 48 }}>{fmtTime(a.ts)}</span>
              <span style={{ fontSize: 12, fontWeight: 500 }}>
                {actionLabel(a.action)}
                {a.entity ? <span className="dim"> · {a.entity}</span> : ""}
              </span>
            </div>
            <span className="dim" style={{ fontSize: 11 }}>{a.username || "—"}</span>
          </div>
        ))}
        {audit.length === 0 && (
          <div className="dim" style={{ padding: "16px 14px", fontSize: 12 }}>No activity yet.</div>
        )}
      </div>

      {/* ── View beds sheet ── */}
      {bedsBlock && (
        <BlockBedsSheet
          pre={bedsBlock.pre}
          label={bedsBlock.label}
          wards={bedsBlock.wards}
          onClose={() => setBedsBlock(null)}
        />
      )}
    </div>
  );
}

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
          try {
            const { beds } = await api.wardBeds(w.id);
            if (!cancelled) result[w.ward] = beds || [];
          } catch { result[w.ward] = []; }
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

  function bedColor(physical, reservation) {
    if (physical === "VACANT"   && reservation === "NONE")     return "var(--green)";
    if (physical === "VACANT"   && reservation === "RESERVED") return "var(--amber)";
    if (physical === "OCCUPIED" && reservation === "NONE")     return "var(--red)";
    if (physical === "OCCUPIED" && reservation === "RESERVED") return "#8B5CF6";
    return "var(--ink-3)";
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 6 }}>
            <div>
              <div className="h1" style={{ fontSize: 18 }}>Block {pre}</div>
              <div className="dim" style={{ fontSize: 12 }}>{label || `Block ${pre}`} · bed status</div>
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          {/* Filter chips — counts embedded, no separate summary bar */}
          {!loading && allBeds.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {[
                { key: "ALL",  label: `All (${allBeds.length})`,               color: "var(--ink)" },
                { key: "V",    label: `Vac (${counts.vn})`,                    color: "var(--green)" },
                { key: "V+R",  label: `V+R (${counts.vr})`,                    color: "var(--amber)" },
                { key: "O",    label: `Occ (${counts.on_})`,                   color: "var(--red)" },
                { key: "O+R",  label: `O+R (${counts.or_})`,                   color: "#8B5CF6" },
                { key: "R",    label: `Res (${counts.vr + counts.or_})`,       color: "var(--amber)" },
              ].map(({ key, label, color }) => (
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
              <div style={{ marginTop: 10, fontWeight: 600 }}>No individual beds configured</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Generate beds from the Blocks tab to enable bed-level tracking.</div>
            </div>
          ) : (
            wards.map((w) => {
              const wardBeds = bedsByWard[w.ward] || [];
              const wardCounts = { vn: 0, vr: 0, on_: 0, or_: 0 };
              for (const b of wardBeds) {
                if (b.physical_status === "VACANT"   && b.reservation_status === "NONE")     wardCounts.vn++;
                if (b.physical_status === "VACANT"   && b.reservation_status === "RESERVED") wardCounts.vr++;
                if (b.physical_status === "OCCUPIED" && b.reservation_status === "NONE")     wardCounts.on_++;
                if (b.physical_status === "OCCUPIED" && b.reservation_status === "RESERVED") wardCounts.or_++;
              }
              const beds = wardBeds
                .filter(b => {
                  if (filter === "V")   return b.physical_status === "VACANT"   && b.reservation_status === "NONE";
                  if (filter === "V+R") return b.physical_status === "VACANT"   && b.reservation_status === "RESERVED";
                  if (filter === "O")   return b.physical_status === "OCCUPIED" && b.reservation_status === "NONE";
                  if (filter === "O+R") return b.physical_status === "OCCUPIED" && b.reservation_status === "RESERVED";
                  if (filter === "R")   return b.reservation_status === "RESERVED"; // V+R + O+R
                  return true; // ALL
                })
                .sort((a, b) => naturalSort(a.bed_name, b.bed_name));
              if (beds.length === 0) return null;
              return (
                <div key={w.ward} style={{ marginBottom: 18 }}>
                  <div className="row between" style={{ marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{w.ward}</span>
                    <span className="dim" style={{ fontSize: 12 }}>{wardBeds.length} beds</span>
                  </div>
                  {/* Compact bed grid — matches PRE manage grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 6 }}>
                    {beds.map((bed) => {
                      const p = bed.physical_status, r = bed.reservation_status;
                      const color = bedColor(p, r);
                      const code  = p === "VACANT" && r === "NONE"     ? "V"
                                  : p === "VACANT" && r === "RESERVED" ? "V+R"
                                  : p === "OCCUPIED" && r === "NONE"   ? "O"
                                  : "O+R";
                      return (
                        <div key={bed.id} style={{
                          padding: "7px 4px 8px", borderRadius: 10, textAlign: "center",
                          background: "var(--panel-2)", border: `2px solid ${color}`,
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)", marginBottom: 3, lineHeight: 1.2 }}>
                            {bed.bed_name}
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

function naturalSort(a, b) {
  const re = /(\d+)/g;
  const ap = a.split(re), bp = b.split(re);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const ai = ap[i] ?? "", bi = bp[i] ?? "";
    const an = parseInt(ai, 10), bn = parseInt(bi, 10);
    if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
    if (ai !== bi) return ai.localeCompare(bi);
  }
  return 0;
}

function actionLabel(a) {
  const map = {
    login: "Signed in", ward_update: "Updated beds", round_submit: "Submitted round",
    pre_create: "Created PRE", pre_edit: "Edited PRE", pre_shift: "Changed shift",
    pre_delete: "Deleted PRE", block_create: "Created block", block_edit: "Edited block",
    block_delete: "Deleted block", ward_create: "Created ward", ward_edit: "Edited ward",
    ward_delete: "Deleted ward", bed_add: "Added bed", bed_delete: "Removed bed",
    bed_rename: "Renamed bed", beds_generate: "Generated beds", bed_status_update: "Updated bed status",
    bed_master_edit: "Updated bed details",
    nurse_create: "Created nurse", nurse_edit: "Edited nurse", nurse_delete: "Deleted nurse",
  };
  return map[a] || a;
}

// ══════════════════════════════════════════════════════════════════════════════
//  HIERARCHY MANAGER — drill-down: Blocks → Floors → Wards
// ══════════════════════════════════════════════════════════════════════════════
function HierarchyManager({ showToast }) {
  // drill-down state
  const [selBlock,  setSelBlock]  = useState(null);
  const [selFloor,  setSelFloor]  = useState(null);

  // data
  const [bblocks,  setBblocks]  = useState([]);
  const [floors,   setFloors]   = useState([]);
  const [wards,    setWards]    = useState([]);
  const [stations, setStations] = useState([]);

  // sheets
  const [editingBlock, setEditingBlock] = useState(null);
  const [editingFloor, setEditingFloor] = useState(null);
  const [addingWard,   setAddingWard]   = useState(null);
  const [editingWard,  setEditingWard]  = useState(null);
  const [managingBeds, setManagingBeds] = useState(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = async () => {
    try {
      const [bb, fl, w, s] = await Promise.all([
        api.mgrBuildingBlocks(), api.mgrFloors(), api.mgrWards(), api.mgrNursingStations(),
      ]);
      setBblocks(bb.blocks || []);
      setFloors(fl.floors  || []);
      setWards(w.wards     || []);
      setStations(s.stations || []);
    } catch (e) { showToast(toastErr(e)); }
  };
  useEffect(() => { load(); }, []);

  // refresh selected objects from fresh data
  useEffect(() => {
    if (selBlock) setSelBlock(b => bblocks.find(x => x.id === b?.id) || b);
  }, [bblocks]);
  useEffect(() => {
    if (selFloor) setSelFloor(f => floors.find(x => x.id === f?.id) || f);
  }, [floors]);

  const blockFloors  = selBlock ? floors.filter(f => f.building_block_id === selBlock.id) : [];
  const floorWards   = selFloor ? wards.filter(w  => w.floor_id === selFloor.id) : [];

  // ── Level 0: Building blocks ──────────────────────────────────────────────

  if (!selBlock) return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="h1" style={{ fontSize: 18 }}>Building Blocks</div>
        <button className="btn btn-primary" style={{ padding: "8px 12px", fontSize: 13 }}
          onClick={() => setEditingBlock("new")}>
          + New block
        </button>
      </div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        Tap a block to manage its floors and wards.
      </div>

      {bblocks.map(bb => {
        const bbFloors   = floors.filter(f => f.building_block_id === bb.id);
        const totalWards = bbFloors.reduce((n, f) => n + (wards.filter(w => w.floor_id === f.id).length), 0);
        return (
          <div key={bb.id} className="card" style={{ padding: 0, marginBottom: 10, overflow: "hidden" }}>
            <button
              style={{ width: "100%", padding: "14px 16px", background: "transparent", border: "none",
                cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 14 }}
              onClick={() => setSelBlock(bb)}>
              <BlockAvatar code={bb.name} size={44} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Block {bb.name}</div>
                <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
                  {bb.label && bb.label !== `Block ${bb.name}` ? bb.label + " · " : ""}
                  {bbFloors.length} floor{bbFloors.length !== 1 ? "s" : ""} · {totalWards} ward{totalWards !== 1 ? "s" : ""}
                </div>
              </div>
              <span style={{ color: "var(--ink-3)", fontSize: 18 }}>›</span>
            </button>
            <div style={{ borderTop: "1px solid var(--line)", padding: "8px 16px", display: "flex", gap: 8 }}>
              <button className="chip" style={{ fontSize: 12 }} onClick={() => setEditingBlock(bb)}>Edit</button>
              <button className="chip" style={{ fontSize: 12, color: "var(--red)" }}
                onClick={async () => {
                  if (bbFloors.length > 0) { showToast(`Block "${bb.name}" still has floors — remove them first`); return; }
                  const ok = await confirm({
                    title: `Delete block "${bb.name}"?`,
                    message: "This cannot be undone.",
                    confirmLabel: "Delete block", danger: true,
                  });
                  if (!ok) return;
                  try { await api.mgrDeleteBuildingBlock(bb.id); load(); showToast(`Block "${bb.name}" deleted`); }
                  catch (e) { showToast(toastErr(e)); }
                }}>Delete</button>
            </div>
          </div>
        );
      })}

      {bblocks.length === 0 && (
        <div className="card empty" style={{ marginTop: 14 }}>
          <Ic d={icons.bed} s={28} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>No building blocks yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Create Block A and Block B to get started.</div>
        </div>
      )}

      {editingBlock !== null && (
        <BuildingBlockEditor
          block={editingBlock === "new" ? null : editingBlock}
          onClose={() => setEditingBlock(null)}
          onSaved={() => { setEditingBlock(null); load(); showToast("Saved ✓"); }}
          showToast={showToast}
        />
      )}
      {confirmDialog}
    </div>
  );

  // ── Level 1: Floors of selected block ────────────────────────────────────

  if (!selFloor) return (
    <div>
      <div className="row" style={{ gap: 10, marginBottom: 14, alignItems: "center" }}>
        <button className="chip" style={{ fontSize: 13 }} onClick={() => setSelBlock(null)}>
          ← Blocks
        </button>
        <div style={{ flex: 1 }}>
          <div className="h1" style={{ fontSize: 18 }}>Block {selBlock.name}</div>
          <div className="dim" style={{ fontSize: 12 }}>{selBlock.label || `Block ${selBlock.name}`}</div>
        </div>
        <button className="btn btn-primary" style={{ padding: "8px 12px", fontSize: 13 }}
          onClick={() => setEditingFloor("new")}>
          + Floor
        </button>
      </div>

      {blockFloors.map(floor => {
        const fWards = wards.filter(w => w.floor_id === floor.id);
        return (
          <div key={floor.id} className="card" style={{ padding: 0, marginBottom: 10, overflow: "hidden" }}>
            <button
              style={{ width: "100%", padding: "14px 16px", background: "transparent", border: "none",
                cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 12 }}
              onClick={() => setSelFloor(floor)}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, background: "var(--teal)",
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 11, flexShrink: 0, textAlign: "center", lineHeight: 1.2,
              }}>{floor.name.substring(0, 4)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{floor.name}</div>
                <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
                  {fWards.length} ward{fWards.length !== 1 ? "s" : ""}
                  {floor.pre_user_name
                    ? <> · <span style={{ color: "var(--teal)" }}>PRE: {floor.pre_user_name}</span></>
                    : <span style={{ color: "var(--red)" }}> · no PRE assigned</span>}
                </div>
              </div>
              <span style={{ color: "var(--ink-3)", fontSize: 18 }}>›</span>
            </button>
            <div style={{ borderTop: "1px solid var(--line)", padding: "8px 16px", display: "flex", gap: 8 }}>
              <button className="chip" style={{ fontSize: 12 }} onClick={() => setEditingFloor(floor)}>Edit</button>
              <button className="chip" style={{ fontSize: 12, color: "var(--red)" }}
                onClick={async () => {
                  if (fWards.length > 0) { showToast(`"${floor.name}" still has wards — remove them first`); return; }
                  const ok = await confirm({
                    title: `Delete "${floor.name}"?`,
                    message: "Any PRE assigned here will be unassigned. This cannot be undone.",
                    confirmLabel: "Delete floor", danger: true,
                  });
                  if (!ok) return;
                  try { await api.mgrDeleteFloor(floor.id); load(); showToast(`"${floor.name}" deleted`); }
                  catch (e) { showToast(toastErr(e)); }
                }}>Delete</button>
            </div>
          </div>
        );
      })}

      {blockFloors.length === 0 && (
        <div className="card empty" style={{ marginTop: 14 }}>
          <div style={{ marginTop: 10, fontWeight: 600 }}>No floors yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Add floors like "Ground Floor", "1st Floor".</div>
        </div>
      )}

      {editingFloor !== null && (
        <FloorEditor
          floor={editingFloor === "new" ? null : editingFloor}
          buildingBlockId={selBlock.id}
          onClose={() => setEditingFloor(null)}
          onSaved={() => { setEditingFloor(null); load(); showToast("Saved ✓"); }}
          showToast={showToast}
        />
      )}
      {confirmDialog}
    </div>
  );

  // ── Level 2: Wards of selected floor ─────────────────────────────────────

  return (
    <div>
      <div className="row" style={{ gap: 10, marginBottom: 14, alignItems: "center" }}>
        <button className="chip" style={{ fontSize: 13 }} onClick={() => setSelFloor(null)}>
          ← {selBlock.name}
        </button>
        <div style={{ flex: 1 }}>
          <div className="h1" style={{ fontSize: 18 }}>{selFloor.name}</div>
          <div className="dim" style={{ fontSize: 12 }}>Block {selBlock.name} · {floorWards.length} ward{floorWards.length !== 1 ? "s" : ""}</div>
        </div>
        <button className="btn btn-primary" style={{ padding: "8px 12px", fontSize: 13 }}
          onClick={() => setAddingWard(true)}>
          + Ward
        </button>
      </div>

      {floorWards.map(w => (
        <div key={w.id} className="card" style={{ padding: 14, marginBottom: 10 }}>
          <div className="row between">
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{w.name}</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>
                {w.bed_count ?? w.total_beds ?? 0} beds
                {w.station_name && <> · <span style={{ color: "var(--teal)" }}>{w.station_name}</span></>}
                {w.unit_type    && <> · {w.unit_type}</>}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <span style={{
                  padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: w.bed_type === "Non-Census" ? "var(--panel-3, #f3f0e8)" : "var(--teal-bg, #e6f7f5)",
                  color: w.bed_type === "Non-Census" ? "#8a7000" : "var(--teal)",
                  border: `1px solid ${w.bed_type === "Non-Census" ? "#d4c060" : "var(--teal)"}`,
                }}>{w.bed_type || "Census"}</span>
                <span style={{
                  padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: w.operational === false ? "#fdecea" : "var(--teal-bg, #e6f7f5)",
                  color: w.operational === false ? "var(--red)" : "var(--teal)",
                  border: `1px solid ${w.operational === false ? "var(--red)" : "var(--teal)"}`,
                }}>{w.operational === false ? "Non-Op" : "Operational"}</span>
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="chip" style={{ fontSize: 12 }} onClick={() => setEditingWard(w)}>Edit</button>
              <button className="chip" style={{ fontSize: 12, color: "var(--teal)" }} onClick={() => setManagingBeds(w)}>
                <Ic d={icons.bed} s={13} /> Beds
              </button>
              <button className="chip" style={{ fontSize: 12, color: "var(--red)" }}
                onClick={async () => {
                  const bc = w.bed_count ?? w.total_beds ?? 0;
                  const ok = await confirm({
                    title: `Delete ward "${w.name}"?`,
                    message: bc > 0
                      ? `Removes all ${bc} bed${bc === 1 ? "" : "s"} and their history. This cannot be undone.`
                      : "This cannot be undone.",
                    confirmLabel: "Delete ward", danger: true,
                  });
                  if (!ok) return;
                  try { await api.mgrDeleteWard(w.id); load(); showToast(`Ward "${w.name}" deleted`); }
                  catch (e) { showToast(toastErr(e)); }
                }}>Delete</button>
            </div>
          </div>
        </div>
      ))}

      {floorWards.length === 0 && (
        <div className="card empty" style={{ marginTop: 14 }}>
          <Ic d={icons.bed} s={26} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>No wards yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Add wards to this floor.</div>
        </div>
      )}

      {addingWard && (
        <WardCreator
          floorId={selFloor.id}
          floorName={`${selBlock.name} — ${selFloor.name}`}
          onClose={() => setAddingWard(null)}
          onSaved={() => { setAddingWard(null); load(); showToast("Ward created ✓"); }}
          showToast={showToast}
        />
      )}
      {editingWard !== null && (
        <WardEditor
          ward={editingWard}
          stations={stations}
          onClose={() => setEditingWard(null)}
          onSaved={() => { setEditingWard(null); load(); showToast("Ward updated ✓"); }}
          showToast={showToast}
        />
      )}
      {managingBeds !== null && (
        <BedManagerModal
          ward={managingBeds}
          onClose={() => { setManagingBeds(null); load(); }}
          showToast={showToast}
        />
      )}
      {confirmDialog}
    </div>
  );
}

function BuildingBlockEditor({ block, onClose, onSaved, showToast }) {
  useModal(onClose);
  const isNew = !block;
  const [name,  setName]  = useState(block?.name  || "");
  const [label, setLabel] = useState(block?.label || "");
  const [busy,  setBusy]  = useState(false);

  const save = async () => {
    if (!name.trim()) { showToast("Block name required"); return; }
    setBusy(true);
    try {
      if (isNew) {
        await api.mgrCreateBuildingBlock({ name: name.trim().toUpperCase(), label: label.trim() || undefined });
      } else {
        await api.mgrEditBuildingBlock(block.id, { name: name.trim().toUpperCase(), label: label.trim() || null });
      }
      onSaved();
    } catch (e) { showToast(toastErr(e)); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="h1" style={{ fontSize: 18 }}>{isNew ? "New building block" : `Edit Block ${block.name}`}</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          <label className="label">Block name <span className="dim" style={{ fontSize: 11 }}>(single letter, e.g. A, B)</span></label>
          <input className="field" value={name} autoCapitalize="characters"
            onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="A" maxLength={5} />
          <div style={{ height: 12 }} />

          <label className="label">Full name <span className="dim" style={{ fontSize: 11 }}>(optional)</span></label>
          <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main Building" />
          <div style={{ height: 18 }} />

          <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
            {busy ? "Saving…" : isNew ? "Create block" : "Save changes"}
          </button>
          <div style={{ height: 14 }} />
        </div>
      </div>
    </div>
  );
}

function FloorEditor({ floor, buildingBlockId, onClose, onSaved, showToast }) {
  useModal(onClose);
  const isNew = !floor;
  const [name, setName] = useState(floor?.name || "");
  const [busy, setBusy] = useState(false);

  const PRESETS = ["Ground Floor", "1st Floor", "2nd Floor", "3rd Floor", "4th Floor", "Basement Floor"];

  const save = async () => {
    if (!name.trim()) { showToast("Floor name required"); return; }
    setBusy(true);
    try {
      if (isNew) {
        await api.mgrCreateFloor({ name: name.trim(), buildingBlockId });
      } else {
        await api.mgrEditFloor(floor.id, { name: name.trim() });
      }
      onSaved();
    } catch (e) { showToast(toastErr(e)); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="h1" style={{ fontSize: 18 }}>{isNew ? "New floor" : `Edit "${floor.name}"`}</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          <label className="label">Floor name</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {PRESETS.map(p => (
              <button key={p} onClick={() => setName(p)} style={{
                padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: `1.5px solid ${name === p ? "var(--teal)" : "var(--line)"}`,
                background: name === p ? "var(--teal)" : "var(--panel-2)",
                color: name === p ? "#fff" : "var(--ink)",
              }}>{p}</button>
            ))}
          </div>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ground Floor, ICU Block" autoFocus />
          <div style={{ height: 18 }} />

          <button className="btn btn-primary btn-block" disabled={busy || !name.trim()} onClick={save}>
            {busy ? "Saving…" : isNew ? "Create floor" : "Save changes"}
          </button>
          <div style={{ height: 14 }} />
        </div>
      </div>
    </div>
  );
}

const UNIT_TYPES = ["KIMS", "KIMS - Renova"];

function TogglePair({ label, value, options, onChange }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label className="label">{label}</label>
      <div style={{ display: "flex", gap: 8 }}>
        {options.map(opt => (
          <button key={opt.value} onClick={() => onChange(opt.value)} style={{
            flex: 1, padding: "9px 0", borderRadius: 10, fontWeight: 700, fontSize: 13,
            cursor: "pointer", transition: "background 0.15s",
            border: `2px solid ${value === opt.value ? opt.color : "var(--line)"}`,
            background: value === opt.value ? opt.color : "var(--panel-2)",
            color: value === opt.value ? "#fff" : "var(--ink)",
          }}>{opt.label}</button>
        ))}
      </div>
    </div>
  );
}

function WardCreator({ floorId, floorName, onClose, onSaved, showToast }) {
  useModal(onClose);
  const [name,        setName]        = useState("");
  const [unitType,    setUnitType]    = useState("");
  const [roomType,    setRoomType]    = useState("");
  const [bedType,     setBedType]     = useState("Census");
  const [operational, setOperational] = useState(true);
  const [beds,        setBeds]        = useState(0);
  const [busy,        setBusy]        = useState(false);

  const save = async () => {
    if (!name.trim()) { showToast("Ward name required"); return; }
    setBusy(true);
    try {
      await api.mgrCreateWard({
        name: name.trim(), floorId, totalBeds: beds,
        unitType:  unitType.trim() || undefined,
        roomType:  roomType.trim() || undefined,
        bedType, operational,
      });
      onSaved();
    } catch (e) { showToast(toastErr(e)); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="h1" style={{ fontSize: 18 }}>New ward — {floorName}</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          <label className="label">Ward / room name</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="MICU I" autoFocus />
          <div style={{ height: 12 }} />

          <TogglePair label="Bed type" value={bedType} onChange={setBedType} options={[
            { value: "Census",     label: "Census",      color: "var(--teal)" },
            { value: "Non-Census", label: "Non-Census",  color: "var(--amber, #e6a817)" },
          ]} />

          <TogglePair label="Operational" value={operational} onChange={setOperational} options={[
            { value: true,  label: "Yes",  color: "var(--teal)" },
            { value: false, label: "No",   color: "var(--red)" },
          ]} />

          <label className="label">Unit type</label>
          <select className="field" value={unitType} onChange={(e) => setUnitType(e.target.value)}>
            <option value="">— Select —</option>
            {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div style={{ height: 12 }} />

          <label className="label">Room type <span className="dim" style={{ fontSize: 11 }}>(optional)</span></label>
          <input className="field" value={roomType} onChange={(e) => setRoomType(e.target.value)} placeholder="ICU" />
          <div style={{ height: 12 }} />

          <label className="label">Initial bed count <span className="dim" style={{ fontSize: 11 }}>(can add/generate beds later)</span></label>
          <div className="stepper" style={{ width: "fit-content" }}>
            <button onClick={() => setBeds((b) => Math.max(0, b - 1))}>–</button>
            <span className="val mono">{beds}</span>
            <button onClick={() => setBeds((b) => b + 1)}>+</button>
          </div>

          <button className="btn btn-primary btn-block" style={{ marginTop: 18 }}
            disabled={busy} onClick={save}>
            {busy ? "Creating…" : "Create ward"}
          </button>
          <div style={{ height: 14 }} />
        </div>
      </div>
    </div>
  );
}

function WardEditor({ ward, stations, onClose, onSaved, showToast }) {
  useModal(onClose);
  const [name,        setName]        = useState(ward.name       || "");
  const [stationId,   setStationId]   = useState(String(ward.station_id || ""));
  const [unitType,    setUnitType]    = useState(ward.unit_type  || "");
  const [roomType,    setRoomType]    = useState(ward.room_type  || "");
  const [bedType,     setBedType]     = useState(ward.bed_type   || "Census");
  const [operational, setOperational] = useState(ward.operational ?? true);
  const [busy,        setBusy]        = useState(false);

  const save = async () => {
    if (!name.trim()) { showToast("Ward name required"); return; }
    setBusy(true);
    try {
      await api.mgrEditWard(ward.id, {
        name:      name.trim(),
        stationId: stationId ? Number(stationId) : null,
        unitType:  unitType.trim() || null,
        roomType:  roomType.trim() || null,
        bedType, operational,
      });
      onSaved();
    } catch (e) { showToast(toastErr(e)); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="h1" style={{ fontSize: 18 }}>Edit ward</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          <label className="label">Ward name</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
          <div style={{ height: 12 }} />

          <TogglePair label="Bed type" value={bedType} onChange={setBedType} options={[
            { value: "Census",     label: "Census",      color: "var(--teal)" },
            { value: "Non-Census", label: "Non-Census",  color: "var(--amber, #e6a817)" },
          ]} />

          <TogglePair label="Operational" value={operational} onChange={setOperational} options={[
            { value: true,  label: "Yes",  color: "var(--teal)" },
            { value: false, label: "No",   color: "var(--red)" },
          ]} />

          <label className="label">Nursing station</label>
          <select className="field" value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">— None —</option>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div style={{ height: 12 }} />

          <label className="label">Unit type</label>
          <select className="field" value={unitType} onChange={(e) => setUnitType(e.target.value)}>
            <option value="">— Select —</option>
            {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div style={{ height: 12 }} />

          <label className="label">Room type</label>
          <input className="field" value={roomType} onChange={(e) => setRoomType(e.target.value)} placeholder="e.g. ICU" />
          <div style={{ height: 18 }} />

          <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          <div style={{ height: 14 }} />
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  BED MANAGER MODAL  (View beds + Manage beds tabs)
// ══════════════════════════════════════════════════════════════════════════════

function BedManagerModal({ ward, onClose, showToast }) {
  useModal(onClose);
  const [beds,          setBeds]          = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [individualBed, setIndividualBed] = useState("");
  // Generate mode: "range" | "ab"
  const [genMode,       setGenMode]       = useState("range");
  const [genPrefix,     setGenPrefix]     = useState("");
  const [genStart,      setGenStart]      = useState(1);
  const [genEnd,        setGenEnd]        = useState(ward.total_beds || 10);
  const [genRooms,      setGenRooms]      = useState("");  // for AB mode
  const [busy,          setBusy]          = useState(false);
  const [renamingId,    setRenamingId]    = useState(null);
  const [renameVal,     setRenameVal]     = useState("");
  const [confirm, confirmDialog]          = useConfirm();

  const load = async () => {
    setLoading(true);
    try { setBeds((await api.wardBeds(ward.id)).beds || []); }
    catch (e) { showToast(toastErr(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [ward.id]);

  const buildBedNames = () => {
    if (genMode === "range") {
      const s = Math.max(1, genStart), e = Math.max(s, genEnd);
      const names = [];
      for (let i = s; i <= e; i++) names.push(genPrefix + String(i));
      return names;
    }
    // AB mode
    const rooms = genRooms.split(/[,\n]+/).map((r) => r.trim()).filter(Boolean);
    const names = [];
    for (const r of rooms) { names.push(r + "A"); names.push(r + "B"); }
    return names;
  };

  const generate = async () => {
    const names = buildBedNames();
    if (names.length === 0) { showToast("No bed names to generate"); return; }
    setBusy(true);
    try {
      const res = await api.generateBeds(ward.id, names);
      await load();
      showToast(`Generated ${res.generated} bed${res.generated !== 1 ? "s" : ""} ✓`);
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const addBed = async () => {
    const name = individualBed.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.addBed(ward.id, name);
      setIndividualBed("");
      await load();
      showToast(`Bed ${name} added ✓`);
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const startRename = (bed) => { setRenamingId(bed.id); setRenameVal(bed.bed_name); };

  const saveRename = async (bedId) => {
    const val = renameVal.trim();
    if (!val) { showToast("Bed name required"); return; }
    setBusy(true);
    try {
      await api.renameBed(bedId, val);
      setRenamingId(null);
      await load();
      showToast("Bed renamed ✓");
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const removeBed = async (bed) => {
    const ok = await confirm({
      title: `Remove bed "${bed.bed_name}"?`,
      message: `Bed will be removed from ${ward.name}. Its status history is kept for the audit log.\n\nThis cannot be undone.`,
      confirmLabel: "Remove bed",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteBed(bed.id);
      await load();
      showToast(`Bed "${bed.bed_name}" removed`);
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const sortedBeds = [...beds].sort((a, b) => naturalSort(a.bed_name, b.bed_name));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90vh", overflowY: "auto" }}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 16 }}>
            <div>
              <div className="h1" style={{ fontSize: 18 }}>{ward.name}</div>
              <div className="dim" style={{ fontSize: 12 }}>
                {beds.length} bed{beds.length !== 1 ? "s" : ""} configured
              </div>
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          {loading ? (
            <div className="dim" style={{ textAlign: "center", padding: 32 }}>
              <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={22} /></span>
            </div>
          ) : beds.length === 0 ? (
            <GenerateBedForm
              genMode={genMode} setGenMode={setGenMode}
              genPrefix={genPrefix} setGenPrefix={setGenPrefix}
              genStart={genStart} setGenStart={setGenStart}
              genEnd={genEnd} setGenEnd={setGenEnd}
              genRooms={genRooms} setGenRooms={setGenRooms}
              buildBedNames={buildBedNames}
              individualBed={individualBed} setIndividualBed={setIndividualBed}
              busy={busy} onGenerate={generate} onAddBed={addBed}
            />
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 8, marginBottom: 20 }}>
                {sortedBeds.map((bed) => (
                  <div key={bed.id} style={{
                    padding: "10px 6px 8px", borderRadius: 12, textAlign: "center",
                    background: "var(--panel-2)", border: "1.5px solid var(--line)",
                  }}>
                    {renamingId === bed.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        <input
                          className="field"
                          value={renameVal}
                          autoFocus
                          style={{ padding: "4px 6px", fontSize: 12, textAlign: "center" }}
                          onChange={(e) => setRenameVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(bed.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                        />
                        <div className="row" style={{ gap: 4, justifyContent: "center" }}>
                          <button className="btn btn-primary" style={{ padding: "3px 8px", fontSize: 11 }}
                            disabled={busy || !renameVal.trim()} onClick={() => saveRename(bed.id)}>
                            Save
                          </button>
                          <button className="chip" style={{ padding: "3px 8px", fontSize: 11 }}
                            onClick={() => setRenamingId(null)}>✕</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>
                          {bed.bed_name}
                        </div>
                        <div className="row" style={{ gap: 4, justifyContent: "center" }}>
                          <button className="chip"
                            style={{ fontSize: 10, padding: "2px 7px", color: "var(--teal)" }}
                            onClick={() => startRename(bed)}>
                            Edit
                          </button>
                          <button className="chip"
                            style={{ fontSize: 10, padding: "2px 7px", color: "var(--red)" }}
                            onClick={() => removeBed(bed)}>
                            Del
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ paddingTop: 4, borderTop: "1px solid var(--line)" }}>
                <label className="label" style={{ marginTop: 14, display: "block" }}>Add a single bed</label>
                <div className="row" style={{ gap: 8 }}>
                  <input className="field" value={individualBed} style={{ flex: 1 }}
                    onChange={(e) => setIndividualBed(e.target.value)}
                    placeholder="e.g. 201A, ICU5, B12"
                    onKeyDown={(e) => e.key === "Enter" && addBed()} />
                  <button className="btn btn-primary" disabled={busy || !individualBed.trim()}
                    onClick={addBed}>Add</button>
                </div>
                <div style={{ marginTop: 14 }}>
                  <GenerateBedForm
                    genMode={genMode} setGenMode={setGenMode}
                    genPrefix={genPrefix} setGenPrefix={setGenPrefix}
                    genStart={genStart} setGenStart={setGenStart}
                    genEnd={genEnd} setGenEnd={setGenEnd}
                    genRooms={genRooms} setGenRooms={setGenRooms}
                    buildBedNames={buildBedNames}
                    individualBed={null} setIndividualBed={null}
                    busy={busy} onGenerate={generate} onAddBed={null}
                    compact
                  />
                </div>
              </div>
            </>
          )}

          <div style={{ height: 14 }} />
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
//  GENERATE BED FORM  (shared between BedManagerModal empty state + "add more")
// ══════════════════════════════════════════════════════════════════════════════
function GenerateBedForm({
  genMode, setGenMode, genPrefix, setGenPrefix,
  genStart, setGenStart, genEnd, setGenEnd,
  genRooms, setGenRooms, buildBedNames,
  individualBed, setIndividualBed,
  busy, onGenerate, onAddBed, compact,
}) {
  const preview = buildBedNames();
  const previewLabel = preview.length === 0 ? "—"
    : preview.length <= 5 ? preview.join(", ")
    : preview.slice(0, 4).join(", ") + ` … +${preview.length - 4} more`;

  return (
    <div>
      {!compact && (
        <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
          Generate beds by number range or A/B rooms, then add more one at a time.
        </div>
      )}

      <label className="label">{compact ? "Generate more beds" : "Generate beds"}</label>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={genMode === "range" ? "on" : ""} onClick={() => setGenMode("range")}>Number range</button>
        <button className={genMode === "ab"    ? "on" : ""} onClick={() => setGenMode("ab")}>A/B rooms</button>
      </div>

      {genMode === "range" ? (
        <>
          <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
            Beds will be named: prefix + number. E.g. prefix "ICU" with 1–10 → ICU1, ICU2 … or leave prefix empty for plain numbers.
          </div>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1.5 }}>
              <label className="label" style={{ fontSize: 11 }}>Prefix <span className="dim">(optional)</span></label>
              <input className="field" value={genPrefix} onChange={(e) => setGenPrefix(e.target.value)}
                placeholder="e.g. ICU, A" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label" style={{ fontSize: 11 }}>From</label>
              <input className="field" type="number" min="1" value={genStart}
                onChange={(e) => setGenStart(Math.max(1, Number(e.target.value)))} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label" style={{ fontSize: 11 }}>To</label>
              <input className="field" type="number" min="1" value={genEnd}
                onChange={(e) => setGenEnd(Math.max(1, Number(e.target.value)))} />
            </div>
          </div>
          <div className="dim" style={{ fontSize: 11, marginBottom: 10 }}>
            Preview: {previewLabel}
          </div>
        </>
      ) : (
        <>
          <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
            Enter room numbers — each room gets an A and B bed. E.g. 101 → 101A, 101B.
          </div>
          <label className="label" style={{ fontSize: 11 }}>Room numbers <span className="dim">(comma-separated)</span></label>
          <textarea className="field" rows={3} value={genRooms}
            onChange={(e) => setGenRooms(e.target.value)}
            placeholder="101, 102, 403" style={{ resize: "vertical" }} />
          <div className="dim" style={{ fontSize: 11, marginBottom: 10 }}>
            Preview: {previewLabel}
          </div>
        </>
      )}

      <button className="btn btn-primary btn-block" disabled={busy || preview.length === 0} onClick={onGenerate}>
        {busy ? "Generating…" : `Generate ${preview.length} bed${preview.length !== 1 ? "s" : ""}`}
      </button>

      {!compact && onAddBed && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
          <label className="label">Or add a single bed</label>
          <div className="row" style={{ gap: 8 }}>
            <input className="field" value={individualBed} style={{ flex: 1 }}
              onChange={(e) => setIndividualBed(e.target.value)}
              placeholder="e.g. 201A, ICU5, B12"
              onKeyDown={(e) => e.key === "Enter" && onAddBed()} />
            <button className="btn btn-primary" disabled={busy || !individualBed?.trim()}
              onClick={onAddBed}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRE BLOCK MANAGER
// ══════════════════════════════════════════════════════════════════════════════

/** Ward row as returned by GET /manager/wards — used in the picker */
function WardPickerModal({ allWards, selectedIds, onDone, onClose }) {
  useModal(onClose);
  const [search,   setSearch]   = useState("");
  const [selected, setSelected] = useState(new Set(selectedIds));

  const q = search.toLowerCase();
  const filtered = allWards.filter(w =>
    !q ||
    w.name.toLowerCase().includes(q) ||
    (w.block_name || "").toLowerCase().includes(q) ||
    (w.floor_name || "").toLowerCase().includes(q) ||
    (w.station_name || "").toLowerCase().includes(q)
  );

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true"
        style={{ maxHeight: "92vh", display: "flex", flexDirection: "column" }}
        onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad" style={{ paddingBottom: 8, flexShrink: 0 }}>
          <div className="row between" style={{ marginBottom: 12 }}>
            <div className="h1" style={{ fontSize: 17 }}>Select wards</div>
            <button className="chip" onClick={onClose}>Cancel</button>
          </div>
          <input className="field" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search ward, block, floor…" autoFocus />
          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
            {selected.size} selected
          </div>
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "0 16px 8px" }}>
          {filtered.length === 0 && (
            <div className="dim" style={{ textAlign: "center", padding: 24 }}>No wards match</div>
          )}
          {filtered.map(w => {
            const on = selected.has(w.id);
            return (
              <div key={w.id} onClick={() => toggle(w.id)} style={{
                padding: "11px 12px", marginBottom: 6, borderRadius: 10, cursor: "pointer",
                border: `2px solid ${on ? "var(--teal)" : "var(--line)"}`,
                background: on ? "var(--teal-bg, #e6f7f5)" : "var(--panel-2)",
                display: "flex", alignItems: "flex-start", gap: 10,
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 5, flexShrink: 0, marginTop: 1,
                  background: on ? "var(--teal)" : "var(--panel-3, #ddd)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {on && <span style={{ color: "#fff", fontSize: 13, lineHeight: 1 }}>✓</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{w.name}</div>
                  <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                    {[w.block_name && `Block ${w.block_name}`, w.floor_name, w.station_name]
                      .filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
                    <span style={{
                      padding: "1px 7px", borderRadius: 20, fontSize: 10, fontWeight: 600,
                      background: w.bed_type === "Non-Census" ? "#fef9e7" : "var(--teal-bg, #e6f7f5)",
                      color: w.bed_type === "Non-Census" ? "#8a7000" : "var(--teal)",
                      border: `1px solid ${w.bed_type === "Non-Census" ? "#d4c060" : "var(--teal)"}`,
                    }}>{w.bed_type || "Census"}</span>
                    <span className="dim" style={{ fontSize: 10 }}>
                      {w.bed_count ?? w.total_beds ?? 0} beds
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "12px 16px 20px", flexShrink: 0, borderTop: "1px solid var(--line)" }}>
          <button className="btn btn-primary btn-block"
            disabled={selected.size === 0}
            onClick={() => onDone([...selected])}>
            Confirm {selected.size} ward{selected.size !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreBlockManager({ showToast }) {
  const [blocks,  setBlocks]  = useState([]);
  const [allWards, setAllWards] = useState([]);
  const [selBlock, setSelBlock] = useState(null); // null = list | object = detail
  const [editing,  setEditing]  = useState(null); // null | "new" | block obj
  const [confirm, confirmDialog] = useConfirm();

  const load = async () => {
    try {
      const [b, w] = await Promise.all([api.mgrPreBlocks(), api.mgrWards()]);
      setBlocks(b.blocks || []);
      setAllWards(w.wards || []);
    } catch (e) { showToast(toastErr(e)); }
  };
  useEffect(() => { load(); }, []);

  // ── Detail view ───────────────────────────────────────────────────────────

  if (selBlock) return (
    <div>
      <div className="row" style={{ gap: 10, marginBottom: 14, alignItems: "center" }}>
        <button className="chip" style={{ fontSize: 13 }} onClick={() => setSelBlock(null)}>
          ← PRE Blocks
        </button>
        <div style={{ flex: 1 }}>
          <div className="h1" style={{ fontSize: 18 }}>{selBlock.name}</div>
          <div className="dim" style={{ fontSize: 12 }}>
            {selBlock.ward_count ?? selBlock.wards?.length ?? 0} wards ·{" "}
            <span style={{ color: selBlock.status === "active" ? "var(--teal)" : "var(--red)", fontWeight: 600 }}>
              {selBlock.status === "active" ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
        <button className="btn btn-primary" style={{ padding: "8px 12px", fontSize: 13 }}
          onClick={() => setEditing(selBlock)}>Edit</button>
      </div>

      {selBlock.description && (
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="dim" style={{ fontSize: 13 }}>{selBlock.description}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className="btn btn-ghost" style={{ flex: 1, padding: "9px 0", fontSize: 13 }}
          onClick={async () => {
            const newStatus = selBlock.status === "active" ? "inactive" : "active";
            try {
              await api.mgrSetPreBlockStatus(selBlock.id, newStatus);
              await load();
              const updated = { ...selBlock, status: newStatus };
              setSelBlock(updated);
              showToast(`${selBlock.name} ${newStatus === "active" ? "activated" : "deactivated"}`);
            } catch (e) { showToast(toastErr(e)); }
          }}>
          {selBlock.status === "active" ? "Deactivate" : "Activate"}
        </button>
        <button className="btn" style={{ flex: 1, padding: "9px 0", fontSize: 13, color: "var(--red)",
          background: "transparent", border: "1.5px solid var(--red)" }}
          onClick={async () => {
            const ok = await confirm({
              title: `Delete "${selBlock.name}"?`,
              message: "This removes the PRE Block and all ward assignments. Wards themselves are not affected.\n\nThis cannot be undone.",
              confirmLabel: "Delete PRE Block", danger: true,
            });
            if (!ok) return;
            try {
              await api.mgrDeletePreBlock(selBlock.id);
              await load();
              setSelBlock(null);
              showToast(`"${selBlock.name}" deleted`);
            } catch (e) { showToast(toastErr(e)); }
          }}>
          Delete
        </button>
      </div>

      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
        Assigned Wards ({selBlock.wards?.length ?? 0})
      </div>
      {(selBlock.wards || []).length === 0 && (
        <div className="card empty"><div style={{ fontWeight: 600 }}>No wards assigned</div></div>
      )}
      {(selBlock.wards || []).map(w => (
        <div key={w.id} className="card" style={{ padding: "12px 14px", marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>
            {[w.block_name && `Block ${w.block_name}`, w.floor_name, w.station_name]
              .filter(Boolean).join(" · ")}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <span style={{
              padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600,
              background: w.bed_type === "Non-Census" ? "#fef9e7" : "var(--teal-bg, #e6f7f5)",
              color: w.bed_type === "Non-Census" ? "#8a7000" : "var(--teal)",
              border: `1px solid ${w.bed_type === "Non-Census" ? "#d4c060" : "var(--teal)"}`,
            }}>{w.bed_type || "Census"}</span>
            <span className="dim" style={{ fontSize: 11 }}>{w.total_beds} beds</span>
          </div>
        </div>
      ))}

      {editing !== null && (
        <PreBlockEditor
          block={editing === "new" ? null : editing}
          allWards={allWards}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            try {
              const detail = await api.mgrPreBlock(selBlock.id);
              setSelBlock(detail);
            } catch {}
            showToast("Saved ✓");
          }}
          showToast={showToast}
        />
      )}
      {confirmDialog}
    </div>
  );

  // ── List view ─────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="h1" style={{ fontSize: 18 }}>PRE Blocks</div>
        <button className="btn btn-primary" style={{ padding: "8px 12px", fontSize: 13 }}
          onClick={() => setEditing("new")}>
          + New PRE Block
        </button>
      </div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        Logical ward groups for PRE workflow and reporting.
      </div>

      {blocks.map(b => (
        <div key={b.id} className="card" style={{ padding: 0, marginBottom: 10, overflow: "hidden" }}>
          <button style={{ width: "100%", padding: "14px 16px", background: "transparent",
            border: "none", cursor: "pointer", textAlign: "left", display: "flex",
            alignItems: "center", gap: 12 }}
            onClick={async () => {
              try {
                const detail = await api.mgrPreBlock(b.id);
                setSelBlock(detail);
              } catch (e) { showToast(toastErr(e)); }
            }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: b.status === "active" ? "var(--teal)" : "var(--panel-3, #ccc)",
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 16,
            }}>{b.name.charAt(0).toUpperCase()}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{b.name}</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
                {b.ward_count} ward{b.ward_count !== 1 ? "s" : ""} · {b.total_beds} beds
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <span style={{
                padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: b.status === "active" ? "var(--teal-bg, #e6f7f5)" : "#f5f5f5",
                color: b.status === "active" ? "var(--teal)" : "var(--ink-3)",
                border: `1px solid ${b.status === "active" ? "var(--teal)" : "var(--line)"}`,
              }}>{b.status === "active" ? "Active" : "Inactive"}</span>
              <span style={{ color: "var(--ink-3)", fontSize: 18 }}>›</span>
            </div>
          </button>
        </div>
      ))}

      {blocks.length === 0 && (
        <div className="card empty" style={{ marginTop: 14 }}>
          <Ic d={icons.user} s={28} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>No PRE Blocks yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Group wards into logical zones for PRE monitoring.
          </div>
        </div>
      )}

      {editing !== null && (
        <PreBlockEditor
          block={editing === "new" ? null : editing}
          allWards={allWards}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); showToast("Saved ✓"); }}
          showToast={showToast}
        />
      )}
      {confirmDialog}
    </div>
  );
}

function PreBlockEditor({ block, allWards, onClose, onSaved, showToast }) {
  useModal(onClose);
  const isNew = !block;
  const [name,        setName]        = useState(block?.name        || "");
  const [description, setDescription] = useState(block?.description || "");
  const [wardIds,     setWardIds]     = useState(
    block?.wards ? block.wards.map(w => w.id) : []
  );
  const [showPicker, setShowPicker] = useState(false);
  const [busy,       setBusy]       = useState(false);

  const pickedWards = allWards.filter(w => wardIds.includes(w.id));

  const save = async () => {
    if (!name.trim()) { showToast("PRE Block name required"); return; }
    if (wardIds.length === 0) { showToast("Select at least one ward"); return; }
    setBusy(true);
    try {
      if (isNew) {
        await api.mgrCreatePreBlock({ name: name.trim(), description: description.trim() || undefined, wardIds });
      } else {
        await api.mgrEditPreBlock(block.id, { name: name.trim(), description: description.trim() || null, wardIds });
      }
      onSaved();
    } catch (e) { showToast(toastErr(e)); setBusy(false); }
  };

  return (
    <>
      <div className="overlay" onClick={onClose}>
        <div className="sheet" role="dialog" aria-modal="true"
          style={{ maxHeight: "92vh", display: "flex", flexDirection: "column" }}
          onClick={e => e.stopPropagation()}>
          <div className="grab" />
          <div style={{ overflowY: "auto", flex: 1 }}>
            <div className="pad">
              <div className="row between" style={{ marginBottom: 14 }}>
                <div className="h1" style={{ fontSize: 18 }}>
                  {isNew ? "New PRE Block" : `Edit "${block.name}"`}
                </div>
                <button className="chip" onClick={onClose}>Close</button>
              </div>

              <label className="label">PRE Block name</label>
              <input className="field" value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Critical Care, General Wards" autoFocus />
              <div style={{ height: 12 }} />

              <label className="label">Description <span className="dim" style={{ fontSize: 11 }}>(optional)</span></label>
              <textarea className="field" rows={2} value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="e.g. All critical care wards for PRE monitoring"
                style={{ resize: "none" }} />
              <div style={{ height: 16 }} />

              <div className="row between" style={{ marginBottom: 8 }}>
                <label className="label" style={{ margin: 0 }}>
                  Assigned Wards <span style={{ color: wardIds.length === 0 ? "var(--red)" : "var(--teal)",
                    fontSize: 12, marginLeft: 4 }}>
                    {wardIds.length === 0 ? "(required)" : `(${wardIds.length} selected)`}
                  </span>
                </label>
                <button className="chip" style={{ fontSize: 12 }} onClick={() => setShowPicker(true)}>
                  {wardIds.length === 0 ? "Select wards" : "Change"}
                </button>
              </div>

              {pickedWards.length === 0 ? (
                <div style={{
                  padding: 16, borderRadius: 10, border: "2px dashed var(--line)",
                  textAlign: "center", color: "var(--ink-3)", fontSize: 13,
                }}>
                  No wards selected — tap "Select wards" above.
                </div>
              ) : (
                <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", marginBottom: 4 }}>
                  {pickedWards.map((w, i) => (
                    <div key={w.id} style={{
                      padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
                      borderBottom: i < pickedWards.length - 1 ? "1px solid var(--line)" : "none",
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{w.name}</div>
                        <div className="dim" style={{ fontSize: 11 }}>
                          {[w.block_name && `Block ${w.block_name}`, w.floor_name]
                            .filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <button className="chip" style={{ fontSize: 11, color: "var(--red)", padding: "2px 8px" }}
                        onClick={() => setWardIds(ids => ids.filter(id => id !== w.id))}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ height: 20 }} />
              <button className="btn btn-primary btn-block"
                disabled={busy || !name.trim() || wardIds.length === 0} onClick={save}>
                {busy ? "Saving…" : isNew ? "Create PRE Block" : "Save changes"}
              </button>
              <div style={{ height: 14 }} />
            </div>
          </div>
        </div>
      </div>

      {showPicker && (
        <WardPickerModal
          allWards={allWards}
          selectedIds={wardIds}
          onClose={() => setShowPicker(false)}
          onDone={(ids) => { setWardIds(ids); setShowPicker(false); }}
        />
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRE USERS MANAGER
// ══════════════════════════════════════════════════════════════════════════════
function PreManager({ showToast }) {
  const [users,      setUsers]      = useState([]);
  const [preBlocks,  setPreBlocks]  = useState([]);
  const [editing,    setEditing]    = useState(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = async () => {
    try {
      const [u, b] = await Promise.all([api.mgrUsers(), api.mgrPreBlocks()]);
      setUsers((u.users || []).filter((x) => x.role === "PRE"));
      setPreBlocks((b.blocks || []).filter(x => x.status === "active"));
    } catch (e) { showToast(toastErr(e)); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="h1" style={{ fontSize: 18 }}>PRE users</div>
        <button className="btn btn-primary" style={{ padding: "8px 12px", fontSize: 13 }}
          onClick={() => setEditing("new")}>
          <Ic d={icons.user} s={15} /> Add PRE
        </button>
      </div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        Each PRE user is assigned to a PRE Block and submits hourly rounds for its wards.
      </div>

      {users.map((u) => (
        <div className="card" key={u.id} style={{ padding: 14, marginBottom: 10 }}>
          <div className="row between">
            <div className="row" style={{ gap: 10 }}>
              <BlockAvatar code={u.pre_block_name || "?"} size={36} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name}</div>
                <div className="dim" style={{ fontSize: 11 }}>
                  @{u.username}
                  {u.pre_block_name
                    ? <> · <span style={{ color: "var(--teal)" }}>{u.pre_block_name}</span></>
                    : <span style={{ color: "var(--red)" }}> · ⚠ no PRE Block assigned</span>}
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className={"tag " + (u.shift === "night" ? "b" : "v")}>
                {u.shift === "night" ? "Night" : "Morning"}
              </span>
              <button className="chip" onClick={() => setEditing(u)}>Edit</button>
              <button className="chip" style={{ color: "var(--red)" }}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete user "${u.name}"?`,
                    message: `Username: ${u.username}\n\nThey will lose access immediately. Past round submissions are kept for the audit log.\n\nThis cannot be undone.`,
                    confirmLabel: "Delete user", danger: true,
                  });
                  if (!ok) return;
                  try { await api.mgrDeletePre(u.id); load(); showToast(`User "${u.name}" deleted`); }
                  catch (e) { showToast(toastErr(e)); }
                }}>Del</button>
            </div>
          </div>
        </div>
      ))}

      {users.length === 0 && (
        <div className="card empty" style={{ marginTop: 14 }}>
          <Ic d={icons.user} s={28} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>No PRE users yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Add a PRE account above.</div>
        </div>
      )}

      {editing !== null && (
        <PreEditor
          user={editing === "new" ? null : editing}
          preBlocks={preBlocks}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); showToast("Saved ✓"); }}
          showToast={showToast}
        />
      )}
      {confirmDialog}
    </div>
  );
}

function PreEditor({ user, preBlocks, onClose, onSaved, showToast }) {
  useModal(onClose);
  const isNew = !user;
  const [username,   setUsername]   = useState(user?.username || "");
  const [name,       setName]       = useState(user?.name     || "");
  const [password,   setPassword]   = useState("");
  const [shift,      setShift]      = useState(user?.shift    || "morning");
  const [preBlockId, setPreBlockId] = useState(
    user?.pre_block_id != null ? String(user.pre_block_id) : ""
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (isNew) {
        if (!username || !password || !name) { showToast("Fill all required fields"); setBusy(false); return; }
        await api.mgrCreatePre({
          username, password, name, shift,
          preBlockId: preBlockId ? Number(preBlockId) : null,
        });
      } else {
        const data = { name, shift, preBlockId: preBlockId ? Number(preBlockId) : null };
        if (password) data.password = password;
        await api.mgrEditPre(user.id, data);
      }
      onSaved();
    } catch (e) { showToast(toastErr(e)); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="h1" style={{ fontSize: 18 }}>{isNew ? "New PRE user" : "Edit " + user.name}</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          <label className="label">Display name</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="PRE user name" autoFocus />
          <div style={{ height: 12 }} />

          {isNew && (
            <>
              <label className="label">Username <span className="dim" style={{ fontSize: 11 }}>(for login)</span></label>
              <input className="field" value={username} autoCapitalize="none"
                onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="pre1" />
              <div style={{ height: 12 }} />
            </>
          )}

          <label className="label">{isNew ? "Password" : "New password (blank = keep current)"}</label>
          <input className="field" type="text" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="min 8 characters" />
          <div style={{ height: 12 }} />

          <label className="label">Assigned PRE Block</label>
          {preBlocks.length === 0 ? (
            <div style={{
              padding: "10px 14px", borderRadius: 10, background: "#fff8e1",
              border: "1px solid #f0c040", fontSize: 13, color: "#7a5c00",
            }}>
              No active PRE Blocks — create one in the PRE Blks tab first.
            </div>
          ) : (
            <select className="field" value={preBlockId} onChange={(e) => setPreBlockId(e.target.value)}>
              <option value="">— Unassigned —</option>
              {preBlocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.ward_count} ward{b.ward_count !== 1 ? "s" : ""})
                </option>
              ))}
            </select>
          )}
          <div style={{ height: 12 }} />

          <label className="label">Shift</label>
          <div className="seg">
            <button className={shift === "morning" ? "on" : ""} onClick={() => setShift("morning")}>Morning · 9–6:30</button>
            <button className={shift === "night"   ? "on" : ""} onClick={() => setShift("night")}>Night · 8pm–8am</button>
          </div>

          <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} disabled={busy} onClick={save}>
            {busy ? "Saving…" : isNew ? "Create PRE user" : "Save changes"}
          </button>
          <div style={{ height: 14 }} />
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  NURSE-IN-CHARGE MANAGER
// ══════════════════════════════════════════════════════════════════════════════
function NurseManager({ showToast }) {
  const [nurses,   setNurses]   = useState([]);
  const [stations, setStations] = useState([]); // [{id, name, ward_count, nurse_count}]
  const [editing,  setEditing]  = useState(null); // null | "new" | nurse obj
  const [confirm, confirmDialog] = useConfirm();

  const load = async () => {
    try {
      const [u, s] = await Promise.all([api.mgrUsers(), api.mgrNursingStations()]);
      setNurses((u.users || []).filter((x) => x.role === "NURSE"));
      setStations(s.stations || []);
    } catch (e) { showToast(toastErr(e)); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="h1" style={{ fontSize: 18 }}>Nurse In-Charge</div>
        <button className="btn btn-primary" style={{ padding: "8px 12px", fontSize: 13 }}
          onClick={() => setEditing("new")}>
          <Ic d={icons.user} s={15} /> Add Nurse
        </button>
      </div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        Nurse In-Charge accounts are scoped to a nursing station — they can only view and update beds in that station.
      </div>

      {nurses.map((n) => (
        <div className="card" key={n.id} style={{ padding: 14, marginBottom: 10 }}>
          <div className="row between">
            <div className="row" style={{ gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%", background: "var(--teal)",
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 14, flexShrink: 0,
              }}>N</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{n.name}</div>
                <div className="dim" style={{ fontSize: 11 }}>
                  @{n.username}
                  {(() => {
                    const stName = stations.find((s) => s.id === n.station_id)?.name || n.nursing_station;
                    return stName
                      ? <> · <span style={{ color: "var(--teal)" }}>{stName}</span></>
                      : <> · <span style={{ color: "var(--red)" }}>⚠ no station assigned</span></>;
                  })()}
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="chip" onClick={() => setEditing(n)}>Edit</button>
              <button className="chip" style={{ color: "var(--red)" }}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete "${n.name}"?`,
                    message: `Username: ${n.username}\n\nThey will lose access immediately. This cannot be undone.`,
                    confirmLabel: "Delete nurse",
                    danger: true,
                  });
                  if (!ok) return;
                  try { await api.mgrDeleteNurse(n.id); load(); showToast(`Nurse "${n.name}" deleted`); }
                  catch (e) { showToast(toastErr(e)); }
                }}>Del</button>
            </div>
          </div>
        </div>
      ))}

      {nurses.length === 0 && (
        <div className="card empty" style={{ marginTop: 14 }}>
          <Ic d={icons.user} s={28} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>No Nurse In-Charge accounts yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Create one above to grant station-scoped access.</div>
        </div>
      )}

      {editing !== null && (
        <NurseEditor
          nurse={editing === "new" ? null : editing}
          stations={stations}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); showToast("Saved"); }}
          showToast={showToast}
        />
      )}
      {confirmDialog}
    </div>
  );
}

function NurseEditor({ nurse, stations, onClose, onSaved, showToast }) {
  const isNew = !nurse;
  const [username,  setUsername]  = useState(nurse?.username || "");
  const [name,      setName]      = useState(nurse?.name     || "");
  const [password,  setPassword]  = useState("");
  const [stationId, setStationId] = useState(String(nurse?.station_id || ""));
  const [busy,      setBusy]      = useState(false);

  const save = async () => {
    if (!name.trim()) { showToast("Display name is required"); return; }
    if (!stationId) { showToast("Nursing station is required"); return; }
    if (isNew && (!username.trim() || !password)) {
      showToast("Username and password are required for new accounts"); return;
    }
    setBusy(true);
    try {
      if (isNew) {
        await api.mgrCreateNurse({ username: username.trim().toLowerCase(), password, name: name.trim(), stationId: Number(stationId) });
      } else {
        const data = { name: name.trim(), stationId: Number(stationId) };
        if (password) data.password = password;
        await api.mgrEditNurse(nurse.id, data);
      }
      onSaved();
    } catch (e) { showToast(toastErr(e)); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="h1" style={{ fontSize: 18 }}>{isNew ? "New Nurse In-Charge" : "Edit " + nurse.name}</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          <label className="label">Display name</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nurse Priya" />
          <div style={{ height: 12 }} />

          {isNew && (
            <>
              <label className="label">Username <span className="dim" style={{ fontSize: 11 }}>(for login)</span></label>
              <input className="field" value={username} autoCapitalize="none"
                onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="nurse_gm" />
              <div style={{ height: 12 }} />
            </>
          )}

          <label className="label">{isNew ? "Password" : "New password (blank = keep current)"}</label>
          <input className="field" type="text" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••" />
          <div style={{ height: 12 }} />

          <label className="label">Nursing station</label>
          {stations.length > 0 ? (
            <select className="field" value={stationId} onChange={(e) => setStationId(e.target.value)}>
              <option value="">— Select station —</option>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <div className="field" style={{ color: "var(--ink-3)", fontStyle: "italic" }}>
              No stations yet — create one in the Stations tab first.
            </div>
          )}
          <div style={{ height: 16 }} />

          <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
            {busy ? "Saving…" : isNew ? "Create Nurse In-Charge" : "Save changes"}
          </button>
          <div style={{ height: 14 }} />
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  STATION MANAGER
// ══════════════════════════════════════════════════════════════════════════════
function StationManager({ showToast }) {
  const [stations, setStations] = useState([]);
  const [editing,  setEditing]  = useState(null); // null | "new" | station obj
  const [confirm, confirmDialog] = useConfirm();

  const load = async () => {
    try {
      const s = await api.mgrNursingStations();
      setStations(s.stations || []);
    } catch (e) { showToast(toastErr(e)); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="h1" style={{ fontSize: 18 }}>Nursing Stations</div>
        <button className="btn btn-primary" style={{ padding: "8px 12px", fontSize: 13 }}
          onClick={() => setEditing("new")}>
          + New station
        </button>
      </div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        Stations group wards together. Each Nurse In-Charge is assigned to one station.
      </div>

      {stations.map((s) => (
        <div className="card" key={s.id} style={{ padding: 14, marginBottom: 10 }}>
          <div className="row between">
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{s.name}</div>
              <div className="dim" style={{ fontSize: 12 }}>
                {s.ward_count} ward{s.ward_count !== 1 ? "s" : ""} · {s.nurse_count} nurse{s.nurse_count !== 1 ? "s" : ""}
                {s.ward_count === 0 && (
                  <span style={{ color: "var(--amber)", fontWeight: 600 }}> · no wards assigned</span>
                )}
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="chip" onClick={() => setEditing(s)}>Edit</button>
              <button className="chip" style={{ color: "var(--red)" }}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete station "${s.name}"?`,
                    message: `This will delete the station and unassign all its wards and nurses.\n\nThis cannot be undone.`,
                    confirmLabel: "Delete station",
                    danger: true,
                  });
                  if (!ok) return;
                  try { await api.mgrDeleteStation(s.id); load(); showToast(`Station "${s.name}" deleted`); }
                  catch (e) { showToast(toastErr(e)); }
                }}>Del</button>
            </div>
          </div>
        </div>
      ))}

      {stations.length === 0 && (
        <div className="card empty" style={{ marginTop: 14 }}>
          <div style={{ marginTop: 10, fontWeight: 600 }}>No nursing stations yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Create a station, then assign wards to it.</div>
        </div>
      )}

      {editing !== null && (
        <StationEditor
          station={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); showToast("Saved ✓"); }}
          showToast={showToast}
        />
      )}
      {confirmDialog}
    </div>
  );
}

function StationEditor({ station, onClose, onSaved, showToast }) {
  useModal(onClose);
  const isNew = !station;
  const [name,        setName]        = useState(station?.name || "");
  const [allWards,    setAllWards]    = useState([]);
  const [pickedIds,   setPickedIds]   = useState(new Set());
  const [showPicker,  setShowPicker]  = useState(false);
  const [busy,        setBusy]        = useState(false);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    api.mgrWards().then((res) => {
      const wards = res.wards || [];
      setAllWards(wards);
      // Pre-select wards already assigned to this station
      if (!isNew && station.id) {
        setPickedIds(new Set(
          wards.filter(w => w.station_id === station.id).map(w => w.id)
        ));
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!name.trim()) { showToast("Station name required"); return; }
    setBusy(true);
    try {
      let stationId;
      if (isNew) {
        const r = await api.mgrCreateStation({ name: name.trim() });
        stationId = r.id;
      } else {
        await api.mgrEditStation(station.id, { name: name.trim() });
        stationId = station.id;
      }
      await api.mgrAssignStationWards(stationId, [...pickedIds]);
      onSaved();
    } catch (e) { showToast(toastErr(e)); setBusy(false); }
  };

  const pickedWards = allWards.filter(w => pickedIds.has(w.id));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="h1" style={{ fontSize: 18 }}>
              {isNew ? "New nursing station" : `Edit "${station.name}"`}
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          <label className="label">Station name</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. General Male, ICU, Emergency" autoFocus />
          <div style={{ height: 20 }} />

          {/* Ward assignment */}
          <div className="row between" style={{ marginBottom: 8 }}>
            <label className="label" style={{ margin: 0 }}>
              Assigned wards
              {pickedIds.size > 0 && (
                <span className="chip" style={{ marginLeft: 8, fontSize: 11 }}>{pickedIds.size}</span>
              )}
            </label>
            <button className="chip" style={{ color: "var(--teal)" }}
              onClick={() => setShowPicker(true)}>
              {pickedIds.size === 0 ? "＋ Add wards" : "Change"}
            </button>
          </div>

          {loading ? (
            <div className="dim" style={{ fontSize: 12, padding: "10px 0" }}>Loading wards…</div>
          ) : pickedWards.length === 0 ? (
            <div style={{
              border: "1.5px dashed var(--line)", borderRadius: 10,
              padding: "14px 12px", textAlign: "center",
            }}>
              <div className="dim" style={{ fontSize: 13 }}>No wards assigned yet</div>
              <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                Tap "Add wards" to pick from all wards
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {pickedWards.map(w => (
                <div key={w.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 12px", borderRadius: 10,
                  background: "var(--panel-2)", border: "1.5px solid var(--teal-deep)",
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{w.name}</div>
                    <div className="dim" style={{ fontSize: 11 }}>
                      {[w.block_name && `Block ${w.block_name}`, w.floor_name]
                        .filter(Boolean).join(" · ")}
                      {" · "}{w.total_beds ?? 0} beds
                    </div>
                  </div>
                  <button onClick={() => setPickedIds(prev => {
                    const n = new Set(prev); n.delete(w.id); return n;
                  })} style={{
                    border: "none", background: "none", cursor: "pointer",
                    color: "var(--ink-3)", fontSize: 16, lineHeight: 1, padding: 4,
                  }}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ height: 22 }} />
          <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
            {busy ? "Saving…" : isNew ? "Create station" : "Save changes"}
          </button>
          <div style={{ height: 14 }} />
        </div>
      </div>

      {showPicker && (
        <WardPickerModal
          allWards={allWards}
          selectedIds={[...pickedIds]}
          onDone={(ids) => { setPickedIds(new Set(ids)); setShowPicker(false); }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  HISTORY VIEWER
// ══════════════════════════════════════════════════════════════════════════════
function HistoryViewer() {
  const [dates,    setDates]    = useState([]);
  const [floors,   setFloors]   = useState([]);
  const [date,     setDate]     = useState("");
  const [floorId,  setFloorId]  = useState("");
  const [rounds,   setRounds]   = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    Promise.all([api.mgrHistoryDates(), api.mgrFloors()]).then(([d, f]) => {
      setDates(d.dates  || []);
      setFloors(f.floors || []);
      if (d.dates?.length) setDate(d.dates[0]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    setExpanded({});
    api.mgrHistory(date, floorId ? Number(floorId) : undefined)
      .then((d) => setRounds(d.rounds || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [date, floorId]);

  const fmtDateLabel = (d) => {
    const dt = new Date(d + "T00:00:00");
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };

  const reportedFloors = new Set(rounds.map((r) => r.floorName || r.floorId));
  const dayTotals = rounds.reduce((acc, r) => {
    for (const w of (Array.isArray(r.wards) ? r.wards : [])) {
      acc.v += w.vacant   || 0;
      acc.o += w.occupied || 0;
      acc.r += w.reserved || 0;
      acc.t += w.total    || 0;
    }
    return acc;
  }, { v: 0, o: 0, r: 0, t: 0 });

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>History</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>Pick a date to review that day's submitted rounds.</div>

      <div className="row" style={{ gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Date</label>
          <select className="field" value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.length === 0 && <option value="">No history yet</option>}
            {dates.map((d) => <option key={d} value={d}>{fmtDateLabel(d)}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Floor</label>
          <select className="field" value={floorId} onChange={(e) => setFloorId(e.target.value)}>
            <option value="">All floors</option>
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.block_name ? `${f.block_name} - ` : ""}{f.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!loading && rounds.length > 0 && (
        <div className="card glass" style={{ padding: 14, marginBottom: 14 }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <span className="h2">{fmtDateLabel(date)}</span>
            <span className="chip">{rounds.length} round{rounds.length !== 1 ? "s" : ""} · {reportedFloors.size} floor{reportedFloors.size !== 1 ? "s" : ""}</span>
          </div>
          <div style={{ display: "flex", background: "var(--panel-2)", borderRadius: 10, overflow: "hidden" }}>
            {[
              { label: "Vacant",   val: dayTotals.v, color: "var(--green)" },
              { label: "Occupied", val: dayTotals.o, color: "var(--red)"   },
              { label: "Reserved", val: dayTotals.r, color: "var(--amber)" },
              { label: "Beds",     val: dayTotals.t, color: "var(--ink)"   },
            ].map(({ label, val, color }, i) => (
              <div key={label} style={{
                flex: 1, textAlign: "center", padding: "10px 4px",
                borderLeft: i > 0 ? "1px solid var(--line)" : "none",
              }}>
                <div style={{ fontSize: 19, fontWeight: 800, color, lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 9.5, color: "var(--ink-3)", fontWeight: 600, marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>
          <div className="dim" style={{ fontSize: 10, marginTop: 6, textAlign: "right" }}>
            totals across all rounds submitted this day
          </div>
        </div>
      )}

      {loading && (
        <div className="empty" style={{ padding: "30px 0" }}>
          <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={22} /></span>
        </div>
      )}
      {!loading && rounds.length === 0 && date && (
        <div className="card empty">
          <Ic d={icons.clock} s={26} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>No rounds on this date</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Try another date or floor filter.</div>
        </div>
      )}

      {rounds.map((r, i) => {
        const wards  = Array.isArray(r.wards) ? r.wards : [];
        const tot    = wards.reduce((a, w) => ({
          v: a.v + (w.vacant || 0), o: a.o + (w.occupied || 0),
          r: a.r + (w.reserved || 0), t: a.t + (w.total || 0),
        }), { v: 0, o: 0, r: 0, t: 0 });
        const label  = r.floorName || `Floor ${r.floorId || r.floorCode}`;
        const isOpen = !!expanded[i];
        return (
          <div className="card" key={i} style={{ padding: 14, marginBottom: 10 }}>
            <div className="row between">
              <div className="row" style={{ gap: 10 }}>
                <BlockAvatar code={r.floorCode || label} size={36} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
                  <div className="dim" style={{ fontSize: 11, marginTop: 1 }}>
                    submitted {fmtTime(r.submittedAt)} · {fmtClock(r.startMin)} round
                  </div>
                </div>
              </div>
              <span className={"tag " + (r.shift === "night" ? "b" : "v")}>
                {r.shift === "night" ? "Night" : "Morning"}
              </span>
            </div>

            {tot.t > 0 && (
              <div style={{ marginTop: 12 }}>
                <StatusBar v={tot.v} r={tot.r} o={tot.o} or={0} total={tot.t} />
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <span className="tag v">{tot.v} vacant</span>
                  <span className="tag r">{tot.r} reserved</span>
                  <span className="tag o">{tot.o} occupied</span>
                  <span className="dim" style={{ fontSize: 11, marginLeft: "auto" }}>{tot.t} beds</span>
                </div>
              </div>
            )}

            {wards.length > 0 && (
              <>
                <button style={{
                  marginTop: 10, width: "100%", padding: "7px 0", borderRadius: 8,
                  background: "var(--panel-2)", border: "none", cursor: "pointer", fontSize: 12,
                  color: "var(--ink-2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }} onClick={() => setExpanded((p) => ({ ...p, [i]: !p[i] }))}>
                  {isOpen ? "▲ Hide" : "▼ Show"} ward breakdown ({wards.length})
                </button>
                {isOpen && (
                  <div style={{ marginTop: 8 }}>
                    {wards.map((w, j) => (
                      <div className="row between" key={j} style={{
                        padding: "7px 10px", fontSize: 13, borderRadius: 8,
                        background: j % 2 ? "var(--panel-2)" : "transparent",
                      }}>
                        <span style={{ fontWeight: 500 }}>{w.ward}</span>
                        <span className="mono" style={{ fontSize: 12 }}>
                          <span style={{ color: "var(--green)" }}>{w.vacant}V</span>
                          <span style={{ color: "var(--amber)" }}> {w.reserved}R</span>
                          <span style={{ color: "var(--red)" }}> {w.occupied}O</span>
                          <span className="dim"> / {w.total}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
