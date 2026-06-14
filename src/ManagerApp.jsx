import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { api, fmtTime, fmtClock, toastErr, friendlyError, toMs, createSocket } from "./lib.js";
import { Ic, icons, StatusBar, useModal, BlockAvatar, useConfirm } from "./ui.jsx";
import { AppShell } from "./shell.jsx";
import { naturalSort } from "./bedUtils.js";

const MGR_TITLES = {
  report: "Reports", setup: "Blocks Overview", preblocks: "PRE Blocks",
  pres: "PRE Users", stations: "Nursing Stations", nurses: "Nurse Users",
  history: "Round History", payers: "Payer Types",
};

export default function ManagerApp({ user, onLogout }) {
  const [tab, setTab] = useState("setup");

  const [toast, setToast] = useState("");
  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2400); }, []);

  const menu = [
    { key: "report",    icon: icons.chart,  label: "Report" },
    { key: "setup",     icon: icons.layers, label: "Blocks" },
    { key: "preblocks", icon: icons.grid,   label: "PRE Blocks" },
    { key: "pres",      icon: icons.user,   label: "PRE Users" },
    { key: "stations",  icon: icons.bed,    label: "Stations" },
    { key: "nurses",    icon: icons.user,   label: "Nurse Users" },
    { key: "history",   icon: icons.clock,  label: "History" },
    { key: "payers",    icon: icons.list,   label: "Payer Types" },
  ];

  return (
    <AppShell
      menu={menu}
      active={tab}
      onSelect={setTab}
      title={MGR_TITLES[tab]}
      user={{ name: user.name || user.username || "Manager", role: "MANAGER" }}
      onLogout={onLogout}
      topExtra={
        <span className="pre-pill" style={{ flexDirection: "column", gap: 1, lineHeight: 1.2, padding: "5px 9px" }}>
          <span style={{ fontSize: 11 }}><Ic d={icons.clock} s={11} /> {fmtTime(Date.now())}</span>
          <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{new Date().toLocaleDateString("en-GB")}</span>
        </span>
      }
    >
      {tab === "report"     && <Reporting />}
      {tab === "setup"      && <HierarchyManager showToast={showToast} />}
      {tab === "preblocks"  && <PreBlockManager showToast={showToast} />}
      {tab === "pres"       && <PreManager showToast={showToast} />}
      {tab === "stations"   && <StationManager showToast={showToast} />}
      {tab === "nurses"     && <NurseManager showToast={showToast} />}
      {tab === "history"    && <HistoryViewer showToast={showToast} />}
      {tab === "payers"     && <PayerTypeManager showToast={showToast} />}

      {toast && <div className="toast">{toast}</div>}
    </AppShell>
  );
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

function MiniStats({ v, r, o, or: or_ = 0, notUpdated, lastUpdatedAt }) {
  const stats = [
    { label: "Vacant",   val: v,          color: "var(--st-v)"  },
    { label: "V+R",      val: r,          color: "var(--st-vr)" },
    { label: "Occupied", val: o,          color: "var(--st-o)"  },
    { label: "Occ+Res",  val: or_,        color: "var(--st-or)" },
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

function WardTable({ wards }) {
  const hdr  = { fontSize: 9, fontWeight: 700, padding: "5px 8px", textAlign: "center", letterSpacing: 0.3 };
  const cell = { padding: "6px 8px", textAlign: "center", fontSize: 13 };
  const div  = "1px solid var(--line)";

  const OccBar = ({ pct }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px" }}>
      <div style={{ flex: 1, height: 6, borderRadius: 4, background: "var(--panel-2)", overflow: "hidden", minWidth: 40 }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", borderRadius: 4, background: "var(--st-o)" }} />
      </div>
      <span className="mono" style={{ fontSize: 11, fontWeight: 700, minWidth: 44, textAlign: "right" }}>
        {Math.round(pct)}%
      </span>
    </div>
  );

  return (
    <div className="tbl-scroll" style={{ marginTop: 8, borderRadius: 8, border: div }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 540 }}>
        <thead>
          <tr>
            <th style={{ ...hdr, textAlign: "left",  background: "var(--panel-2)",    borderRight: div }}>WARD</th>
            <th style={{ ...hdr,                     background: "var(--panel-2)",    borderRight: div }}>TOTAL BEDS</th>
            <th style={{ ...hdr, color: "var(--st-o)",  background: "var(--st-o-bg)",  borderRight: div }}>TOTAL OCC</th>
            <th style={{ ...hdr, color: "var(--st-o)",  background: "var(--st-o-bg)"                   }}>ON BED</th>
            <th style={{ ...hdr, color: "var(--st-or)", background: "var(--st-or-bg)", borderRight: div }}>OCC+RES</th>
            <th style={{ ...hdr, color: "var(--st-v)",  background: "var(--st-v-bg)",  borderRight: div }}>TOTAL VAC</th>
            <th style={{ ...hdr, color: "var(--st-v)",  background: "var(--st-v-bg)"                   }}>VACANT</th>
            <th style={{ ...hdr, color: "var(--st-vr)", background: "var(--st-vr-bg)", borderRight: div }}>VAC+RES</th>
            <th style={{ ...hdr, background: "var(--panel-2)", minWidth: 120           }}>OCCUPANCY %</th>
          </tr>
        </thead>
        <tbody>
          {wards.map((w, j) => {
            const reported = w.vacant !== null && w.vacant !== undefined;
            const o   = w.occupied          || 0;
            const or_ = w.occupied_reserved || 0;
            const v   = w.vacant            || 0;
            const r   = w.reserved          || 0;
            const occ = o + or_;
            const pct = reported && (w.total || 0) > 0 ? (occ / w.total) * 100 : 0;
            const d   = (n) => reported ? n : <span className="dim">–</span>;
            return (
              <tr key={j} style={{ background: j % 2 ? "var(--panel-2)" : "transparent" }}>
                <td style={{ ...cell, textAlign: "left", fontWeight: 600, borderRight: div, whiteSpace: "nowrap" }}>
                  {w.ward}
                  {w.bed_type === "Non-Census" && <span className="dim" style={{ fontSize: 10, marginLeft: 6 }}>Non-Census</span>}
                </td>
                <td style={{ ...cell, fontWeight: 700, borderRight: div }}>{w.total || 0}</td>
                <td style={{ ...cell, color: "var(--st-o)",  fontWeight: 700, borderRight: div }}>{d(occ)}</td>
                <td style={{ ...cell, color: "var(--st-o)"  }}>{d(o)}</td>
                <td style={{ ...cell, color: "var(--st-or)", borderRight: div }}>{d(or_)}</td>
                <td style={{ ...cell, color: "var(--st-v)",  fontWeight: 700, borderRight: div }}>{d(v + r)}</td>
                <td style={{ ...cell, color: "var(--st-v)"  }}>{d(v)}</td>
                <td style={{ ...cell, color: "var(--st-vr)", borderRight: div }}>{d(r)}</td>
                <td style={{ ...cell, padding: "6px 4px" }}>
                  {reported ? <OccBar pct={pct} /> : <span className="dim">–</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Reporting() {
  const [data,       setData]       = useState(null);
  const [loadError,  setLoadError]  = useState(false);
  const [compliance, setCompliance] = useState([]);
  const [audit,      setAudit]      = useState([]);
  const [kpis,       setKpis]       = useState(null);
  const [bedsBlock,  setBedsBlock]  = useState(null); // { pre, wards } | null
  const [toast,      setToast]      = useState("");
  const [expanded,   setExpanded]   = useState({});

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  const loadRef = useRef(null);
  const load = useCallback(async () => {
    setLoadError(false);
    try { setData(await api.cooOverview()); }
    catch (e) {
      if ((e?.message ?? "") !== "Unauthorized") { setLoadError(true); showToast(toastErr(e)); }
    }
    // secondary — don't block or double-toast on failure
    try { setCompliance((await api.cooCompliance()).compliance || []); } catch { /* non-fatal */ }
    try { setAudit((await api.cooAudit()).logs || []); } catch { /* non-fatal */ }
    try { setKpis(await api.mgrKpis()); } catch { /* non-fatal */ }
  }, []);
  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  // Real-time updates via WebSocket — replaces 15-second polling
  useEffect(() => {
    const socket = createSocket();
    const refresh = () => { loadRef.current(); };
    socket.on("bed:update",   refresh);
    socket.on("round:submit", refresh);
    socket.on("connect",      refresh);
    return () => { socket.disconnect(); };
  }, []);

  if (!data) return (
    <div className="empty">
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
          <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={24} /></span>
          <div style={{ marginTop: 10 }}>Loading…</div>
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );

  // Only score PRE Blocks that actually have a PRE assigned — unstaffed
  // blocks cannot submit rounds, so counting them buries the real signal.
  const compByPre = {};
  for (const c of compliance) compByPre[c.floor || c.block] = c;
  const scored  = compliance.filter((c) => c.expected > 0 && c.hasPre);
  const avg     = scored.length ? Math.round(scored.reduce((a, c) => a + c.score, 0) / scored.length) : 100;
  const lagging = scored.filter((c) => c.score < 100).length;
  const unstaffed = compliance.filter((c) => !c.hasPre).length;

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
            <span className="chip mono">{Math.round(kpis.occupancy_pct)}% occupied</span>
          </div>
          <div className="auto-grid-4" style={{ gap: 8 }}>
            {[
              { label: "Total",      val: kpis.total,             color: "var(--ink)"   },
              { label: "Census",     val: kpis.census,            color: "var(--primary)" },
              { label: "Non-Census", val: kpis.non_census,        color: "var(--ink-2)" },
              { label: "Non-Op",     val: kpis.non_operational,   color: "var(--red)"   },
              { label: "Vacant",     val: kpis.vacant,            color: "var(--st-v)"  },
              { label: "Vac+Res",    val: kpis.vacant_reserved,   color: "var(--st-vr)" },
              { label: "Occupied",   val: kpis.occupied,          color: "var(--st-o)"  },
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
                ? "All PRE blocks are submitting on time"
                : `${lagging} PRE block${lagging > 1 ? "s" : ""} behind schedule`}
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
                      {s.v + s.o + (s.or || 0) + s.r > 0
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

                    {/* Ward breakdown table */}
                    {p.wards.length > 0 && (() => {
                      const isOpen = !!expanded[p.pre];
                      return (
                        <>
                          <button style={{
                            marginTop: 10, width: "100%", padding: "7px 0", borderRadius: 8,
                            background: "var(--panel-2)", border: "none", cursor: "pointer",
                            fontSize: 12, color: "var(--ink-2)",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                          }} onClick={() => setExpanded((prev) => ({ ...prev, [p.pre]: !prev[p.pre] }))}>
                            {isOpen ? "▲ Hide" : "▼ Show"} ward breakdown ({p.wards.length})
                          </button>
                          {isOpen && <WardTable wards={p.wards} />}
                        </>
                      );
                    })()}

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
                            }}>{Math.round(c.score)}%</span>
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

function bedColor(physical, reservation) {
  if (physical === "VACANT" && reservation === "RESERVED") return "var(--st-vr)";
  if (physical === "VACANT")   return "var(--st-v)";
  if (physical === "OCCUPIED") return "var(--st-o)";
  return "var(--ink-3)";
}
function bedBg(physical, reservation) {
  if (physical === "VACANT" && reservation === "RESERVED") return "var(--st-vr-bg)";
  if (physical === "VACANT")   return "var(--st-v-bg)";
  if (physical === "OCCUPIED") return "var(--st-o-bg)";
  return "var(--panel-2)";
}

function BedGrid({ wardList, bedsByWard, filter }) {
  return wardList.map((w) => {
    const wardBeds = bedsByWard[w.id] || [];
    const beds = wardBeds
      .filter(b => {
        if (filter === "V")   return b.physical_status === "VACANT"   && b.reservation_status === "NONE";
        if (filter === "V+R") return b.physical_status === "VACANT"   && b.reservation_status === "RESERVED";
        if (filter === "O")   return b.physical_status === "OCCUPIED";
        if (filter === "R")   return b.reservation_status === "RESERVED";
        return true;
      })
      .sort((a, b) => naturalSort(a.bed_name, b.bed_name));
    if (beds.length === 0) return null;
    return (
      <div key={w.id} style={{ marginBottom: 18 }}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{w.ward || w.name}</span>
          <span className="dim" style={{ fontSize: 12 }}>{wardBeds.length} beds</span>
        </div>
        <div className="bed-grid">
          {beds.map((bed) => {
            const p = bed.physical_status, r = bed.reservation_status;
            const color = bedColor(p, r);
            const lbl = p === "VACANT" && r === "NONE"     ? "Vacant"
                      : p === "VACANT" && r === "RESERVED" ? "Vac + Res"
                      : "Occupied";
            return (
              <div key={bed.id} className="bed-tile"
                style={{ borderColor: color, background: bedBg(p, r) }}>
                <span className="bname">{bed.bed_name}</span>
                <span className="bstate" style={{ color }}>{lbl}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  });
}

function BlockBedsSheet({ pre, label, wards, onClose }) {
  useModal(onClose);

  // ── PRE Block tab state ───────────────────────────────────────────────────
  const [preBeds,    setPreBeds]    = useState({});
  const [preLoading, setPreLoading] = useState(true);

  // ── Station tab state ─────────────────────────────────────────────────────
  const [stWards,    setStWards]    = useState([]);   // all wards in linked stations
  const [stBeds,     setStBeds]     = useState({});
  const [stLoading,  setStLoading]  = useState(false);
  const [stLoaded,   setStLoaded]   = useState(false);

  const [tab,    setTab]    = useState("pre");   // "pre" | "station"
  const [filter, setFilter] = useState("ALL");

  // Unique stations referenced by the PRE block's wards
  const linkedStations = useMemo(() => {
    const seen = new Map();
    for (const w of wards) {
      if (w.station_id && !seen.has(w.station_id))
        seen.set(w.station_id, w.nursing_station || `Station ${w.station_id}`);
    }
    return seen; // Map<stationId, stationName>
  }, [wards]);

  const hasStations = linkedStations.size > 0;

  // Load PRE block beds on mount
  const wardKey = wards.map(w => w.id).sort().join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPreLoading(true);
      const result = {};
      await Promise.all(wards.map(async (w) => {
        try { const { beds } = await api.wardBeds(w.id); if (!cancelled) result[w.id] = beds || []; }
        catch { result[w.id] = []; }
      }));
      if (!cancelled) { setPreBeds(result); setPreLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [wardKey]);

  // Load station beds the first time the Station tab is opened
  useEffect(() => {
    if (tab !== "station" || stLoaded || !hasStations) return;
    const stationIds = [...linkedStations.keys()];
    let cancelled = false;
    (async () => {
      setStLoading(true);
      try {
        const { wards: allWards } = await api.mgrWards();
        const filtered = (allWards || []).filter(
          w => stationIds.includes(w.station_id) && w.operational !== false
        );
        if (!cancelled) setStWards(filtered);
        const result = {};
        await Promise.all(filtered.map(async (w) => {
          try { const { beds } = await api.wardBeds(w.id); if (!cancelled) result[w.id] = beds || []; }
          catch { result[w.id] = []; }
        }));
        if (!cancelled) { setStBeds(result); setStLoading(false); setStLoaded(true); }
      } catch { if (!cancelled) { setStLoading(false); setStLoaded(true); } }
    })();
    return () => { cancelled = true; };
  }, [tab, stLoaded, hasStations, linkedStations]);

  // Reset filter when switching tabs
  const switchTab = (t) => { setTab(t); setFilter("ALL"); };

  const activeBeds    = tab === "pre" ? preBeds    : stBeds;
  const activeLoading = tab === "pre" ? preLoading : stLoading;
  const allBeds       = Object.values(activeBeds).flat();

  const counts = { vn: 0, vr: 0, on_: 0 };
  for (const b of allBeds) {
    if (b.physical_status === "VACANT" && b.reservation_status === "NONE")     counts.vn++;
    else if (b.physical_status === "VACANT" && b.reservation_status === "RESERVED") counts.vr++;
    else if (b.physical_status === "OCCUPIED") counts.on_++;
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 12 }}>
            <div>
              <div className="h1" style={{ fontSize: 18 }}>Block {pre}</div>
              <div className="dim" style={{ fontSize: 12 }}>{label || `Block ${pre}`} · bed status</div>
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          {/* Tab selector — only shown when linked nursing stations exist */}
          {hasStations && (
            <div className="seg" style={{ marginBottom: 14 }}>
              <button className={tab === "pre"     ? "on" : ""} onClick={() => switchTab("pre")}>PRE Block</button>
              <button className={tab === "station" ? "on" : ""} onClick={() => switchTab("station")}>Nursing Station</button>
            </div>
          )}

          {/* Filter chips */}
          {!activeLoading && allBeds.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {[
                { key: "ALL", label: `All (${allBeds.length})` },
                { key: "V",   label: `Vacant (${counts.vn})` },
                { key: "V+R", label: `Vac+Res (${counts.vr})` },
                { key: "O",   label: `Occupied (${counts.on_})` },
                { key: "R",   label: `Reserved (${counts.vr})` },
              ].map(({ key, label: lbl }) => (
                <button key={key} className={"fchip" + (filter === key ? " on" : "")}
                  onClick={() => setFilter(key)}>{lbl}</button>
              ))}
            </div>
          )}

          {activeLoading ? (
            <div style={{ textAlign: "center", padding: 32 }}>
              <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={22} /></span>
            </div>
          ) : allBeds.length === 0 ? (
            <div className="card empty">
              <Ic d={icons.bed} s={26} />
              <div style={{ marginTop: 10, fontWeight: 600 }}>No individual beds configured</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                {tab === "pre"
                  ? "Generate beds from the Blocks tab to enable bed-level tracking."
                  : "No beds found for the linked nursing stations."}
              </div>
            </div>
          ) : tab === "pre" ? (
            <BedGrid wardList={wards} bedsByWard={preBeds} filter={filter} />
          ) : (
            // Station tab: group wards by station name
            [...linkedStations.entries()].map(([sid, sname]) => {
              const sWards = stWards.filter(w => w.station_id === sid);
              if (sWards.length === 0) return null;
              return (
                <div key={sid}>
                  {linkedStations.size > 1 && (
                    <div style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                      color: "var(--teal)", textTransform: "uppercase",
                      marginBottom: 8, marginTop: 4,
                    }}>{sname}</div>
                  )}
                  <BedGrid wardList={sWards} bedsByWard={stBeds} filter={filter} />
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


export function actionLabel(a) {
  const map = {
    login:                  "Signed in",
    login_failed:           "Failed login attempt",
    ward_update:            "Updated beds",
    ward_create:            "Created ward",
    ward_edit:              "Edited ward",
    ward_delete:            "Deleted ward",
    bed_add:                "Added bed",
    bed_delete:             "Removed bed",
    bed_rename:             "Renamed bed",
    beds_generate:          "Generated beds",
    bed_status_update:      "Updated bed status",
    bed_master_edit:        "Updated bed details",
    pre_create:             "Created PRE user",
    pre_edit:               "Edited PRE user",
    pre_delete:             "Deleted PRE user",
    pre_shift:              "Changed shift",
    pre_block_create:       "Created PRE block",
    pre_block_edit:         "Edited PRE block",
    pre_block_delete:       "Deleted PRE block",
    round_submit:           "Submitted round",
    building_block_create:  "Created building block",
    building_block_edit:    "Edited building block",
    building_block_delete:  "Deleted building block",
    floor_create:           "Created floor",
    floor_edit:             "Edited floor",
    floor_delete:           "Deleted floor",
    station_create:         "Created nursing station",
    station_edit:           "Edited nursing station",
    station_delete:         "Deleted nursing station",
    station_assign_wards:   "Assigned wards to station",
    nurse_create:           "Created nurse",
    nurse_edit:             "Edited nurse",
    nurse_delete:           "Deleted nurse",
    nurse_access_create:    "Created nurse access",
    nurse_access_edit:      "Edited nurse access",
    nurse_access_update:    "Updated nurse access",
    nurse_access_delete:    "Deleted nurse access",
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
                    message: "This cannot be undone.",
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

function useUnitTypes() {
  const [unitTypes, setUnitTypes] = useState([]);
  useEffect(() => {
    api.mgrUnitTypes().then((r) => setUnitTypes(r.unitTypes || [])).catch(() => {});
  }, []);
  return unitTypes;
}

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
  const unitTypes                     = useUnitTypes();
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

          <label className="label">Unit type <span className="dim" style={{ fontSize: 11 }}>(pick or type custom)</span></label>
          <input className="field" list="unit-type-list" value={unitType}
            onChange={(e) => setUnitType(e.target.value)} placeholder="e.g. KIMS, ICU…" />
          <datalist id="unit-type-list">
            {unitTypes.map((t) => <option key={t} value={t} />)}
          </datalist>
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
  const unitTypes                     = useUnitTypes();
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

          <label className="label">Unit type <span className="dim" style={{ fontSize: 11 }}>(pick or type custom)</span></label>
          <input className="field" list="unit-type-list" value={unitType}
            onChange={(e) => setUnitType(e.target.value)} placeholder="e.g. KIMS, ICU…" />
          <datalist id="unit-type-list">
            {unitTypes.map((t) => <option key={t} value={t} />)}
          </datalist>
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
//  BED MANAGER MODAL — table design with tabs
// ══════════════════════════════════════════════════════════════════════════════

// iOS-style toggle switch
function ToggleSwitch({ value, onChange, disabled }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!value)}
      style={{
        position: "relative", display: "inline-flex", alignItems: "center",
        width: 44, height: 24, borderRadius: 12, border: "none",
        cursor: disabled ? "default" : "pointer", padding: 0, flexShrink: 0,
        background: value ? "var(--primary, #2563EB)" : "#cbd5e1",
        transition: "background .2s",
      }}>
      <span style={{
        position: "absolute", top: 3, left: value ? 23 : 3,
        width: 18, height: 18, borderRadius: "50%", background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left .15s",
      }} />
    </button>
  );
}

// Census / Non-Census coloured badge
function BedTypeBadge({ type }) {
  const c = type === "Census"
    ? { bg: "#dcfce7", color: "#16a34a", border: "#bbf7d0" }
    : { bg: "#fff7ed", color: "#ea580c", border: "#fed7aa" };
  return (
    <span style={{
      padding: "2px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      whiteSpace: "nowrap",
    }}>{type || "—"}</span>
  );
}

// AC / Non-AC badge
function AcBadge({ ac }) {
  return ac
    ? <span style={{ padding: "2px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600,
        background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe",
        whiteSpace: "nowrap" }}>AC</span>
    : <span style={{ padding: "2px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600,
        background: "#f8fafc", color: "#94a3b8", border: "1px solid #e2e8f0",
        whiteSpace: "nowrap" }}>Non-AC</span>;
}

function BedManagerModal({ ward, onClose, showToast }) {
  useModal(onClose);
  const [beds,    setBeds]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab,     setTab]     = useState("beds"); // "beds" | "add" | "generate"
  const [busy,    setBusy]    = useState(false);
  const [editingBed, setEditingBed] = useState(null);
  const [confirm, confirmDialog]    = useConfirm();

  // ── Add Bed tab state ─────────────────────────────────────────────────────
  const [addName,    setAddName]    = useState("");
  const [addOpStatus, setAddOp]    = useState(true);
  const [addBedType,  setAddType]  = useState(ward.bed_type || "Non-Census");
  const [addAcStatus, setAddAc]    = useState(true);

  // ── Generate Beds tab state ───────────────────────────────────────────────
  const [genMode,    setGenMode]    = useState("range");
  const [genPrefix,  setGenPrefix]  = useState("");
  const [genStart,   setGenStart]   = useState(1);
  const [genEnd,     setGenEnd]     = useState(ward.total_beds || 10);
  const [genRooms,   setGenRooms]   = useState("");
  const [genOpStatus, setGenOp]     = useState(true);
  const [genBedType,  setGenType]   = useState(ward.bed_type || "Non-Census");
  const [genAcStatus, setGenAc]     = useState(true);

  // ── Search / filter / pagination ─────────────────────────────────────────
  const [search,   setSearch]   = useState("");
  const [filter,   setFilter]   = useState("all"); // "all" | "operational" | "non-operational" | "Census" | "Non-Census"
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 15;

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
      const res = await api.generateBeds(ward.id, names, { operationalStatus: genOpStatus, bedType: genBedType, acStatus: genAcStatus });
      await load(); setTab("beds");
      showToast(`Generated ${res.generated} bed${res.generated !== 1 ? "s" : ""} ✓`);
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const addBed = async () => {
    const name = addName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.addBed(ward.id, name, { operationalStatus: addOpStatus, bedType: addBedType, acStatus: addAcStatus });
      setAddName("");
      await load(); setTab("beds");
      showToast(`Bed "${name}" added ✓`);
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const toggleBedOp = async (bed) => {
    const next = !(bed.operational_status !== false);
    setBeds(prev => prev.map(b => b.id === bed.id ? { ...b, operational_status: next } : b));
    try {
      await api.updateBedMaster(bed.id, { operationalStatus: next });
    } catch (e) {
      setBeds(prev => prev.map(b => b.id === bed.id ? { ...b, operational_status: !next } : b));
      showToast(toastErr(e));
    }
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

  const exportCSV = () => {
    const rows = [["Bed Name", "Operational", "Bed Type", "AC", "Physical Status", "Reservation Status"]];
    [...beds].sort((a, b) => naturalSort(a.bed_name, b.bed_name)).forEach(b => {
      rows.push([b.bed_name, b.operational_status !== false ? "Yes" : "No", b.bed_type || "Census",
        b.ac_status !== false ? "AC" : "Non-AC", b.physical_status, b.reservation_status]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `beds-${ward.name.replace(/\s+/g, "_")}.csv`;
    a.click();
  };

  const sortedBeds = [...beds].sort((a, b) => naturalSort(a.bed_name, b.bed_name));
  const filteredBeds = sortedBeds.filter(b => {
    const q = search.toLowerCase();
    if (q && !b.bed_name.toLowerCase().includes(q)) return false;
    if (filter === "operational"     && b.operational_status === false) return false;
    if (filter === "non-operational" && b.operational_status !== false) return false;
    if (filter === "Census"          && b.bed_type !== "Census") return false;
    if (filter === "Non-Census"      && b.bed_type !== "Non-Census") return false;
    if (filter === "ac"              && b.ac_status === false) return false;
    if (filter === "non-ac"          && b.ac_status !== false) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filteredBeds.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedBeds = filteredBeds.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const genPreview = buildBedNames();

  const tabStyle = (t) => ({
    padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer",
    fontWeight: 600, fontSize: 13,
    background: tab === t ? "var(--primary, #2563EB)" : "transparent",
    color: tab === t ? "#fff" : "var(--ink-2)",
  });

  const thStyle = {
    padding: "9px 12px", textAlign: "left", fontSize: 11, fontWeight: 700,
    color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".05em",
    borderBottom: "1px solid var(--line)", background: "var(--panel-2)",
  };
  const tdStyle = {
    padding: "10px 12px", fontSize: 13, borderBottom: "1px solid var(--line)",
    verticalAlign: "middle",
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="grab" />

        {/* ── Header ── */}
        <div style={{ padding: "14px clamp(12px, 4vw, 18px) 0", borderBottom: "1px solid var(--line)" }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <div>
              <div className="h1" style={{ fontSize: 17 }}>{ward.name}</div>
              <div className="dim" style={{ fontSize: 12 }}>
                {beds.length} bed{beds.length !== 1 ? "s" : ""} configured
              </div>
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          {/* ── Tabs ── */}
          <div className="row" style={{ gap: 4, paddingBottom: 12 }}>
            <button style={tabStyle("beds")}   onClick={() => setTab("beds")}>All Beds</button>
            <button style={tabStyle("add")}    onClick={() => setTab("add")}>Add Bed</button>
            <button style={tabStyle("generate")} onClick={() => setTab("generate")}>Generate Beds</button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px clamp(12px, 4vw, 18px)" }}>

          {/* ════ ALL BEDS TAB ════ */}
          {tab === "beds" && (
            <>
              {/* Search + filter + export bar */}
              <div className="row bm-search-row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <input className="field" value={search} style={{ flex: 1, minWidth: 0 }}
                  placeholder="Search beds…"
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
                <select className="field" value={filter}
                  style={{ minWidth: 130, width: "auto" }}
                  onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
                  <option value="all">Show: All</option>
                  <option value="operational">Operational only</option>
                  <option value="non-operational">Non-Op only</option>
                  <option value="Census">Census only</option>
                  <option value="Non-Census">Non-Census only</option>
                  <option value="ac">AC only</option>
                  <option value="non-ac">Non-AC only</option>
                </select>
              </div>

              {loading ? (
                <div className="dim" style={{ textAlign: "center", padding: 40 }}>
                  <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={22} /></span>
                </div>
              ) : filteredBeds.length === 0 ? (
                <div className="dim" style={{ textAlign: "center", padding: 32, fontSize: 13 }}>
                  {beds.length === 0 ? "No beds yet. Use Add Bed or Generate Beds." : "No beds match your search."}
                </div>
              ) : (
                <>
                  {/* Table */}
                  <div className="tbl-scroll" style={{ borderRadius: 10, border: "1px solid var(--line)", marginBottom: 12 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Bed Name</th>
                          <th style={{ ...thStyle, textAlign: "center" }}>Operational</th>
                          <th style={{ ...thStyle, textAlign: "center" }}>Type</th>
                          <th style={{ ...thStyle, textAlign: "center" }}>AC</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedBeds.map((bed) => {
                          const isOp = bed.operational_status !== false;
                          const isAC = bed.ac_status !== false;
                          return (
                            <tr key={bed.id} style={{ background: isOp ? "transparent" : "rgba(239,68,68,.04)" }}>
                              <td style={tdStyle}>
                                <span style={{ fontWeight: 600, color: isOp ? "var(--ink)" : "var(--ink-3)" }}>
                                  {bed.bed_name}
                                </span>
                              </td>
                              <td style={{ ...tdStyle, textAlign: "center" }}>
                                <ToggleSwitch value={isOp} onChange={() => toggleBedOp(bed)} />
                              </td>
                              <td style={{ ...tdStyle, textAlign: "center" }}>
                                <BedTypeBadge type={bed.bed_type || "Census"} />
                              </td>
                              <td style={{ ...tdStyle, textAlign: "center" }}>
                                <AcBadge ac={isAC} />
                              </td>
                              <td style={{ ...tdStyle, textAlign: "right" }}>
                                <div className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                                  <button title="Edit" onClick={() => setEditingBed(bed)}
                                    style={{ background: "none", border: "none", cursor: "pointer",
                                      color: "var(--primary, #2563EB)", padding: 5, borderRadius: 6 }}>
                                    <Ic d={icons.pencil} s={15} />
                                  </button>
                                  <button title="Remove" onClick={() => removeBed(bed)}
                                    style={{ background: "none", border: "none", cursor: "pointer",
                                      color: "var(--red)", padding: 5, borderRadius: 6 }}>
                                    <Ic d={icons.trash} s={15} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="row between" style={{ fontSize: 12, color: "var(--ink-2)", flexWrap: "wrap", gap: 8 }}>
                    <span>
                      Showing {((safePage - 1) * PAGE_SIZE) + 1}–{Math.min(safePage * PAGE_SIZE, filteredBeds.length)} of {filteredBeds.length} beds
                    </span>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="chip" disabled={safePage <= 1} onClick={() => setPage(p => p - 1)}
                        style={{ padding: "4px 10px" }}>← Prev</button>
                      <span style={{ padding: "4px 8px" }}>{safePage} / {totalPages}</span>
                      <button className="chip" disabled={safePage >= totalPages} onClick={() => setPage(p => p + 1)}
                        style={{ padding: "4px 10px" }}>Next →</button>
                    </div>
                  </div>
                </>
              )}

              {/* Legend */}
              <div className="row" style={{ gap: 12, marginTop: 18, flexWrap: "wrap", fontSize: 11, color: "var(--ink-3)", alignItems: "center" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary, #2563EB)", display: "inline-block" }} />
                  Operational
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#cbd5e1", display: "inline-block" }} />
                  Non-Op
                </span>
                <BedTypeBadge type="Census" />
                <BedTypeBadge type="Non-Census" />
                <AcBadge ac={true} />
                <AcBadge ac={false} />
              </div>
            </>
          )}

          {/* ════ ADD BED TAB ════ */}
          {tab === "add" && (
            <div style={{ maxWidth: 420 }}>
              <div className="label" style={{ marginBottom: 14, fontSize: 13, color: "var(--ink-2)" }}>
                Add a single bed to <strong>{ward.name}</strong>
              </div>
              <label className="label">Bed Name</label>
              <input className="field" value={addName} style={{ marginBottom: 12 }}
                placeholder="e.g. 201A, ICU-5, B12"
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addBed()} />

              <div className="row" style={{ gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label className="label">Operational Status</label>
                  <select className="field" value={addOpStatus ? "true" : "false"}
                    onChange={(e) => setAddOp(e.target.value === "true")}>
                    <option value="true">Operational</option>
                    <option value="false">Non-Operational</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label className="label">Bed Type</label>
                  <select className="field" value={addBedType}
                    onChange={(e) => setAddType(e.target.value)}>
                    <option value="Census">Census</option>
                    <option value="Non-Census">Non-Census</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label className="label">AC Status</label>
                  <select className="field" value={addAcStatus ? "true" : "false"}
                    onChange={(e) => setAddAc(e.target.value === "true")}>
                    <option value="true">AC</option>
                    <option value="false">Non-AC</option>
                  </select>
                </div>
              </div>

              <button className="btn btn-primary" disabled={busy || !addName.trim()}
                onClick={addBed} style={{ width: "100%" }}>
                {busy ? "Adding…" : "Add Bed"}
              </button>
            </div>
          )}

          {/* ════ GENERATE BEDS TAB ════ */}
          {tab === "generate" && (
            <div style={{ maxWidth: 480 }}>
              <div className="label" style={{ marginBottom: 14, fontSize: 13, color: "var(--ink-2)" }}>
                Generate multiple beds for <strong>{ward.name}</strong>
              </div>

              {/* Mode toggle */}
              <div className="row" style={{ gap: 6, marginBottom: 14 }}>
                {["range", "ab"].map(m => (
                  <button key={m} onClick={() => setGenMode(m)} style={{
                    padding: "6px 14px", borderRadius: 8, border: "1px solid var(--line)",
                    background: genMode === m ? "var(--primary, #2563EB)" : "var(--panel-2)",
                    color: genMode === m ? "#fff" : "var(--ink-2)", fontWeight: 600, fontSize: 12, cursor: "pointer",
                  }}>{m === "range" ? "Numbered Range" : "Room A/B"}</button>
                ))}
              </div>

              {genMode === "range" ? (
                <>
                  <label className="label">Prefix (optional)</label>
                  <input className="field" value={genPrefix} placeholder="e.g. ICU, B, Room"
                    style={{ marginBottom: 10 }} onChange={(e) => setGenPrefix(e.target.value)} />
                  <div className="row" style={{ gap: 10, marginBottom: 12 }}>
                    <div style={{ flex: 1 }}>
                      <label className="label">From</label>
                      <input className="field" type="number" min={1} value={genStart}
                        onChange={(e) => setGenStart(Number(e.target.value))} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="label">To</label>
                      <input className="field" type="number" min={genStart} value={genEnd}
                        onChange={(e) => setGenEnd(Number(e.target.value))} />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <label className="label">Room numbers (one per line or comma-separated)</label>
                  <textarea className="field" rows={4} value={genRooms}
                    placeholder="101, 102, 103" style={{ marginBottom: 12, resize: "vertical" }}
                    onChange={(e) => setGenRooms(e.target.value)} />
                </>
              )}

              <div className="row" style={{ gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label className="label">Operational Status</label>
                  <select className="field" value={genOpStatus ? "true" : "false"}
                    onChange={(e) => setGenOp(e.target.value === "true")}>
                    <option value="true">Operational</option>
                    <option value="false">Non-Operational</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label className="label">Bed Type</label>
                  <select className="field" value={genBedType}
                    onChange={(e) => setGenType(e.target.value)}>
                    <option value="Census">Census</option>
                    <option value="Non-Census">Non-Census</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label className="label">AC Status</label>
                  <select className="field" value={genAcStatus ? "true" : "false"}
                    onChange={(e) => setGenAc(e.target.value === "true")}>
                    <option value="true">AC</option>
                    <option value="false">Non-AC</option>
                  </select>
                </div>
              </div>

              {genPreview.length > 0 && (
                <div style={{ marginBottom: 14, padding: "8px 12px", borderRadius: 8,
                  background: "var(--panel-2)", border: "1px solid var(--line)", fontSize: 12 }}>
                  <span style={{ color: "var(--ink-2)", fontWeight: 600 }}>
                    Will generate {genPreview.length} bed{genPreview.length !== 1 ? "s" : ""}:{" "}
                  </span>
                  <span style={{ color: "var(--ink-3)" }}>
                    {genPreview.slice(0, 8).join(", ")}{genPreview.length > 8 ? `, +${genPreview.length - 8} more` : ""}
                  </span>
                </div>
              )}

              <button className="btn btn-primary" disabled={busy || genPreview.length === 0}
                onClick={generate} style={{ width: "100%" }}>
                {busy ? "Generating…" : `Generate ${genPreview.length} Bed${genPreview.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          )}
        </div>
      </div>
      {confirmDialog}

      {editingBed && (
        <BedEditModal
          bed={editingBed}
          wardName={ward.name}
          onClose={() => setEditingBed(null)}
          onSaved={async (msg) => { setEditingBed(null); await load(); showToast(msg); }}
          onRemove={async () => { const b = editingBed; setEditingBed(null); await removeBed(b); }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  BED EDIT MODAL
// ══════════════════════════════════════════════════════════════════════════════
function BedEditModal({ bed, wardName, onClose, onSaved, onRemove }) {
  useModal(onClose);
  const [name,      setName]      = useState(bed.bed_name);
  const [opStatus,  setOpStatus]  = useState(bed.operational_status !== false);
  const [bedType,   setBedType]   = useState(bed.bed_type || "Census");
  const [acStatus,  setAcStatus]  = useState(bed.ac_status !== false);
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState("");

  const save = async () => {
    if (!name.trim()) { setErr("Bed name is required"); return; }
    setErr(""); setBusy(true);
    try {
      const nameChanged = name.trim() !== bed.bed_name;
      const opChanged   = opStatus  !== (bed.operational_status !== false);
      const typeChanged = bedType   !== (bed.bed_type || "Census");
      const acChanged   = acStatus  !== (bed.ac_status !== false);

      if (nameChanged)
        await api.renameBed(bed.id, name.trim());
      if (opChanged || typeChanged || acChanged)
        await api.updateBedMaster(bed.id, {
          ...(opChanged   ? { operationalStatus: opStatus } : {}),
          ...(typeChanged ? { bedType }                     : {}),
          ...(acChanged   ? { acStatus }                    : {}),
        });

      await onSaved(`Bed "${name.trim()}" updated ✓`);
    } catch (e) { setErr(toastErr(e)); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "80vh", overflowY: "auto" }}>
        <div className="grab" />
        <div className="pad">

          {/* Header */}
          <div className="row between" style={{ marginBottom: 18 }}>
            <div>
              <div className="h1" style={{ fontSize: 17 }}>Edit Bed</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{wardName}</div>
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          {/* Bed Name */}
          <label className="label">Bed name</label>
          <input
            className="field"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="e.g. ICU-1, B12"
          />
          <div style={{ height: 16 }} />

          {/* Operational status */}
          <label className="label">Operational status</label>
          <div className="seg" style={{ marginBottom: 4 }}>
            <button className={opStatus  ? "on" : ""} onClick={() => setOpStatus(true)}>Operational</button>
            <button className={!opStatus ? "on" : ""} onClick={() => setOpStatus(false)}
              style={!opStatus ? { background: "var(--red)", color: "#fff" } : {}}>Non-Operational</button>
          </div>
          <div className="dim" style={{ fontSize: 11, marginBottom: 16 }}>
            {opStatus
              ? "Bed is active and counted in ward totals."
              : "Bed is offline — excluded from occupancy counts."}
          </div>

          {/* Bed type */}
          <label className="label">Bed type</label>
          <div className="seg" style={{ marginBottom: 4 }}>
            <button className={bedType === "Census"     ? "on" : ""} onClick={() => setBedType("Census")}>Census</button>
            <button className={bedType === "Non-Census" ? "on" : ""} onClick={() => setBedType("Non-Census")}>Non-Census</button>
          </div>
          <div className="dim" style={{ fontSize: 11, marginBottom: 16 }}>
            {bedType === "Census"
              ? "Counted in official hospital census figures."
              : "Excluded from census — day-care, observation, etc."}
          </div>

          {/* AC status */}
          <label className="label">AC status</label>
          <div className="seg" style={{ marginBottom: 4 }}>
            <button className={acStatus  ? "on" : ""} onClick={() => setAcStatus(true)}>AC</button>
            <button className={!acStatus ? "on" : ""} onClick={() => setAcStatus(false)}>Non-AC</button>
          </div>
          <div className="dim" style={{ fontSize: 11, marginBottom: 20 }}>
            {acStatus ? "Bed is air-conditioned." : "Bed is non-air-conditioned."}
          </div>

          {err && <AppError message={err} style={{ marginBottom: 12 }} />}

          <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save changes"}
          </button>

          {/* Remove bed — danger zone */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
            <div className="dim" style={{ fontSize: 11, marginBottom: 8 }}>Danger zone</div>
            <button
              className="btn btn-block"
              style={{ background: "transparent", border: "1px solid var(--red)", color: "var(--red)" }}
              disabled={busy}
              onClick={onRemove}
            >
              Remove bed "{bed.bed_name}"
            </button>
          </div>

          <div style={{ height: 14 }} />
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  GENERATE BED FORM  (shared between BedManagerModal empty state + "add more")
// ══════════════════════════════════════════════════════════════════════════════
// Small inline Op/Non-Op toggle used in bed creation and editing
function OpToggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)", flexShrink: 0 }}>
      <button type="button"
        style={{ padding: "0 10px", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
          background: value  ? "var(--teal)" : "transparent",
          color:      value  ? "#fff" : "var(--ink-3)" }}
        onClick={() => onChange(true)}>Op</button>
      <button type="button"
        style={{ padding: "0 10px", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
          background: !value ? "var(--red)" : "transparent",
          color:      !value ? "#fff" : "var(--ink-3)" }}
        onClick={() => onChange(false)}>Non-Op</button>
    </div>
  );
}

function GenerateBedForm({
  genMode, setGenMode, genPrefix, setGenPrefix,
  genStart, setGenStart, genEnd, setGenEnd,
  genRooms, setGenRooms, buildBedNames,
  opStatus, setOpStatus,
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

      {/* Op status for the batch */}
      {setOpStatus && (
        <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 10 }}>
          <span className="dim" style={{ fontSize: 12 }}>Beds created as:</span>
          <OpToggle value={opStatus ?? true} onChange={setOpStatus} />
        </div>
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
function WardPickerModal({ allWards, selectedIds, onDone, onClose, currentStationId }) {
  useModal(onClose);
  const [search,   setSearch]   = useState("");
  const [selected, setSelected] = useState(new Set(selectedIds));

  const q = search.toLowerCase();
  const filtered = allWards.filter(w =>
    w.operational !== false && (
      !q ||
      w.name.toLowerCase().includes(q) ||
      (w.block_name || "").toLowerCase().includes(q) ||
      (w.floor_name || "").toLowerCase().includes(q) ||
      (w.station_name || "").toLowerCase().includes(q)
    )
  );

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Only relevant when called from StationEditor (currentStationId is null or a number)
  const stationContext = currentStationId !== undefined;
  const hasConflict = stationContext && [...selected].some(id => {
    const w = allWards.find(x => x.id === id);
    return w?.station_id && w.station_id !== currentStationId;
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
          {hasConflict && (
            <div style={{
              marginTop: 8, padding: "8px 10px", borderRadius: 8,
              background: "#fff8e1", border: "1px solid #f0c040",
              fontSize: 11, color: "#7a5900", lineHeight: 1.4,
            }}>
              Wards marked with are currently in another station. Moving them will automatically remove those nurses' access.
            </div>
          )}
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "0 16px 8px" }}>
          {filtered.length === 0 && (
            <div className="dim" style={{ textAlign: "center", padding: 24 }}>No wards match</div>
          )}
          {filtered.map(w => {
            const on = selected.has(w.id);
            const inOtherStation = stationContext && w.station_id && w.station_id !== currentStationId;
            return (
              <div key={w.id} onClick={() => toggle(w.id)} style={{
                padding: "11px 12px", marginBottom: 6, borderRadius: 10, cursor: "pointer",
                border: `2px solid ${on ? (inOtherStation ? "#f0a500" : "var(--teal)") : "var(--line)"}`,
                background: on ? (inOtherStation ? "#fff8e1" : "var(--teal-bg, #e6f7f5)") : "var(--panel-2)",
                display: "flex", alignItems: "flex-start", gap: 10,
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 5, flexShrink: 0, marginTop: 1,
                  background: on ? (inOtherStation ? "#f0a500" : "var(--teal)") : "var(--panel-3, #ddd)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {on && <span style={{ color: "#fff", fontSize: 13, lineHeight: 1 }}>✓</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    {w.name}
                    {inOtherStation && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 20,
                        background: "#fff0c0", color: "#7a5900", border: "1px solid #e0c040",
                      }}>In {w.station_name}</span>
                    )}
                  </div>
                  <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                    {[w.block_name && `Block ${w.block_name}`, w.floor_name]
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
  const [showPwd,    setShowPwd]    = useState(false);
  const [shift,      setShift]      = useState(user?.shift    || "morning");
  const [preBlockId, setPreBlockId] = useState(
    user?.pre_block_id != null ? String(user.pre_block_id) : ""
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { showToast("Display name is required."); return; }
    if (isNew) {
      const uname = username.trim().toLowerCase();
      if (!uname) { showToast("Username is required."); return; }
      if (!/^[a-z0-9_]+$/.test(uname)) {
        showToast("Username can only contain letters, numbers, and underscores — no spaces or special characters.");
        return;
      }
      if (!password) { showToast("Password is required."); return; }
      if (password.length < 8) { showToast("Password must be at least 8 characters."); return; }
    }
    if (password && !isNew && password.length < 8) {
      showToast("New password must be at least 8 characters."); return;
    }
    setBusy(true);
    try {
      if (isNew) {
        await api.mgrCreatePre({
          username: username.trim().toLowerCase(), password, name, shift,
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
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
                Letters, numbers, and underscores only — e.g. pre1, pre_b2
              </div>
              <div style={{ height: 12 }} />
            </>
          )}

          <label className="label">{isNew ? "Password" : "New password (blank = keep current)"}</label>
          <div style={{ position: "relative" }}>
            <input className="field" type={showPwd ? "text" : "password"} value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="min 8 characters"
              style={{ paddingRight: 42 }} />
            <button type="button" onClick={() => setShowPwd((v) => !v)}
              style={{
                position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", padding: 0, cursor: "pointer",
                color: "var(--ink-3)", display: "flex", alignItems: "center",
              }}
              aria-label={showPwd ? "Hide password" : "Show password"}
            >
              <Ic d={showPwd ? icons.eyeOff : icons.eye} s={18} />
            </button>
          </div>
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
        Nurse In-Charge accounts can view and update beds in their assigned station. Station assignment is optional.
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
                  {n.employee_id && <> · {n.employee_id}</>}
                  {(() => {
                    const stName = stations.find((s) => s.id === n.station_id)?.name || n.nursing_station;
                    return stName
                      ? <> · <span style={{ color: "var(--teal)" }}>{stName}</span></>
                      : <> · <span style={{ color: "var(--amber)" }}>no station</span></>;
                  })()}
                </div>
                {(n.phone || n.email) && (
                  <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                    {n.phone}{n.phone && n.email ? " · " : ""}{n.email}
                  </div>
                )}
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
  const [username,   setUsername]   = useState(nurse?.username    || "");
  const [name,       setName]       = useState(nurse?.name        || "");
  const [password,   setPassword]   = useState("");
  const [showPwd,    setShowPwd]    = useState(false);
  const [stationId,  setStationId]  = useState(String(nurse?.station_id || ""));
  const [employeeId, setEmployeeId] = useState(nurse?.employee_id || "");
  const [phone,      setPhone]      = useState(nurse?.phone       || "");
  const [email,      setEmail]      = useState(nurse?.email       || "");
  const [busy,       setBusy]       = useState(false);

  const save = async () => {
    if (!name.trim()) { showToast("Display name is required."); return; }
    if (isNew) {
      const uname = username.trim().toLowerCase();
      if (!uname) { showToast("Username is required."); return; }
      if (!/^[a-z0-9_]+$/.test(uname)) {
        showToast("Username can only contain letters, numbers, and underscores — no spaces or special characters.");
        return;
      }
      if (!password) { showToast("Password is required."); return; }
      if (password.length < 8) { showToast("Password must be at least 8 characters."); return; }
    }
    if (password && !isNew && password.length < 8) {
      showToast("New password must be at least 8 characters."); return;
    }
    setBusy(true);
    try {
      const sid = stationId ? Number(stationId) : null;
      if (isNew) {
        await api.mgrCreateNurse({
          username: username.trim().toLowerCase(), password, name: name.trim(),
          stationId: sid,
          employeeId: employeeId.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
        });
      } else {
        const data = { name: name.trim(), stationId: sid,
          employeeId: employeeId.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
        };
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
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
                Letters, numbers, and underscores only — e.g. nurse_gm, nic1
              </div>
              <div style={{ height: 12 }} />
            </>
          )}

          <label className="label">{isNew ? "Password" : "New password (blank = keep current)"}</label>
          <div style={{ position: "relative" }}>
            <input className="field" type={showPwd ? "text" : "password"} value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="min 8 characters"
              style={{ paddingRight: 42 }} />
            <button type="button" onClick={() => setShowPwd((v) => !v)}
              style={{
                position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", padding: 0, cursor: "pointer",
                color: "var(--ink-3)", display: "flex", alignItems: "center",
              }}
              aria-label={showPwd ? "Hide password" : "Show password"}
            >
              <Ic d={showPwd ? icons.eyeOff : icons.eye} s={18} />
            </button>
          </div>
          <div style={{ height: 12 }} />

          <label className="label">Nursing station <span className="dim" style={{ fontSize: 11 }}>(optional)</span></label>
          {stations.length > 0 ? (
            <select className="field" value={stationId} onChange={(e) => setStationId(e.target.value)}>
              <option value="">— No station yet —</option>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <div className="field" style={{ color: "var(--ink-3)", fontStyle: "italic" }}>
              No stations yet — create one in the Stations tab first.
            </div>
          )}
          <div style={{ height: 12 }} />

          <label className="label">Employee ID <span className="dim" style={{ fontSize: 11 }}>(optional)</span></label>
          <input className="field" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="e.g. EMP-1234" />
          <div style={{ height: 12 }} />

          <label className="label">Phone <span className="dim" style={{ fontSize: 11 }}>(optional)</span></label>
          <input className="field" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 98765 43210" />
          <div style={{ height: 12 }} />

          <label className="label">Email <span className="dim" style={{ fontSize: 11 }}>(optional)</span></label>
          <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nurse@hospital.in" />
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
  const [stations,         setStations]         = useState([]);
  const [selectedStation,  setSelectedStation]  = useState(null);
  const [editing,          setEditing]          = useState(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = async () => {
    try {
      const s = await api.mgrNursingStations();
      setStations(s.stations || []);
    } catch (e) { showToast(toastErr(e)); }
  };
  useEffect(() => { load(); }, []);

  if (selectedStation) {
    return (
      <StationDetail
        station={selectedStation}
        onBack={() => { setSelectedStation(null); load(); }}
        showToast={showToast}
      />
    );
  }

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
        Click a station to manage its nurses, access assignments, and coverage.
      </div>

      {stations.map((s) => (
        <div className="card" key={s.id} style={{ padding: 14, marginBottom: 10, cursor: "pointer" }}
          onClick={() => setSelectedStation(s)}>
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
            <div className="row" style={{ gap: 8 }} onClick={(e) => e.stopPropagation()}>
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
          currentStationId={isNew ? null : station?.id}
          onDone={(ids) => { setPickedIds(new Set(ids)); setShowPicker(false); }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  STATION DETAIL (drill-down)
// ══════════════════════════════════════════════════════════════════════════════

function StationDetail({ station, onBack, showToast }) {
  const [activeTab,     setActiveTab]     = useState("nurses");
  const [nurses,        setNurses]        = useState([]);
  const [coverageData,  setCoverageData]  = useState(null);
  const [assigning,     setAssigning]     = useState(false);
  const [editingStation, setEditingStation] = useState(false);
  const [stationData,   setStationData]   = useState(station);
  const [confirm, confirmDialog] = useConfirm();

  const loadNurses = async () => {
    try {
      const u = await api.mgrUsers();
      setNurses((u.users || []).filter((x) => x.role === "NURSE" && x.station_id === stationData.id));
    } catch (e) { showToast(toastErr(e)); }
  };

  const loadCoverage = async () => {
    try {
      const d = await api.mgrStationCoverage(stationData.id);
      setCoverageData(d);
    } catch (e) { showToast(toastErr(e)); }
  };

  useEffect(() => { loadNurses(); }, []);

  useEffect(() => {
    if (activeTab === "coverage") loadCoverage();
  }, [activeTab]);

  const removeNurse = async (n) => {
    const ok = await confirm({
      title: `Remove "${n.name}" from station?`,
      message: `${n.name} will be unassigned from ${stationData.name}. They keep their login access.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.mgrSetNurseStation(n.id, null);
      loadNurses();
      showToast(`${n.name} removed from station`);
    } catch (e) { showToast(toastErr(e)); }
  };

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <button className="chip" onClick={onBack}>← Back to Stations</button>
        <button className="chip" onClick={() => setEditingStation(true)}>Edit Station</button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 20 }}>{stationData.name}</div>
        <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
          {stationData.ward_count} ward{stationData.ward_count !== 1 ? "s" : ""} · {nurses.length} nurse{nurses.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 18 }}>
        {[["nurses", "Nurses"], ["access", "Access"], ["coverage", "Coverage"]].map(([key, label]) => (
          <button key={key}
            className={"fchip" + (activeTab === key ? " on" : "")}
            onClick={() => setActiveTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === "nurses" && (
        <div>
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="h1" style={{ fontSize: 16 }}>Nurses</div>
            <button className="btn btn-primary" style={{ padding: "7px 12px", fontSize: 13 }}
              onClick={() => setAssigning(true)}>
              + Assign Nurse
            </button>
          </div>

          {nurses.length === 0 ? (
            <div className="card empty">
              <Ic d={icons.user} s={28} />
              <div style={{ marginTop: 10, fontWeight: 600 }}>No nurses in this station</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Assign a nurse using the button above.</div>
            </div>
          ) : nurses.map((n) => (
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
                      @{n.username}{n.employee_id ? ` · ${n.employee_id}` : ""}
                    </div>
                    {(n.phone || n.email) && (
                      <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                        {n.phone}{n.phone && n.email ? " · " : ""}{n.email}
                      </div>
                    )}
                  </div>
                </div>
                <button className="chip" style={{ color: "var(--red)" }}
                  onClick={() => removeNurse(n)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "access" && (
        <NurseAccessManager showToast={showToast} stationId={stationData.id} />
      )}

      {activeTab === "coverage" && (
        <CoveragePanel
          data={coverageData}
          onLoad={loadCoverage}
          stationName={stationData.name}
          stationNurses={nurses}
          showToast={showToast}
        />
      )}

      {assigning && (
        <AssignNurseModal
          stationId={stationData.id}
          stationName={stationData.name}
          onClose={() => setAssigning(false)}
          onSaved={() => { setAssigning(false); loadNurses(); showToast("Nurse assigned to station"); }}
          showToast={showToast}
        />
      )}

      {editingStation && (
        <StationEditor
          station={stationData}
          onClose={() => setEditingStation(false)}
          onSaved={async () => {
            setEditingStation(false);
            try {
              const s = await api.mgrNursingStations();
              const updated = (s.stations || []).find((x) => x.id === stationData.id);
              if (updated) setStationData(updated);
            } catch { /* ignore — name stays as-is */ }
            showToast("Station updated");
          }}
          showToast={showToast}
        />
      )}

      {confirmDialog}
    </div>
  );
}

function AssignNurseModal({ stationId, stationName, onClose, onSaved, showToast }) {
  useModal(onClose);
  const [unassigned, setUnassigned] = useState([]);
  const [nurseId,    setNurseId]    = useState("");
  const [busy,       setBusy]       = useState(false);
  const [err,        setErr]        = useState("");

  useEffect(() => {
    api.mgrUsers().then((r) => {
      setUnassigned((r.users || []).filter((u) => u.role === "NURSE" && !u.station_id));
    }).catch(() => {});
  }, []);

  const save = async () => {
    if (!nurseId) { setErr("Select a nurse"); return; }
    setBusy(true);
    try {
      await api.mgrSetNurseStation(Number(nurseId), stationId);
      onSaved();
    } catch (e) { setErr(friendlyError(e).message); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="h1" style={{ fontSize: 17 }}>Assign Nurse to {stationName}</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          <label className="label">Nurse (unassigned)</label>
          <select className="field" value={nurseId} onChange={(e) => setNurseId(e.target.value)}>
            <option value="">— Select nurse —</option>
            {unassigned.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} (@{n.username}){n.employee_id ? ` · ${n.employee_id}` : ""}
              </option>
            ))}
          </select>
          {unassigned.length === 0 && (
            <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
              All nurses are already assigned to a station.
            </div>
          )}

          {err && (
            <div style={{
              background: "var(--red-bg, #FEF2F2)", color: "var(--red, #DC2626)",
              padding: "9px 12px", borderRadius: 8, fontSize: 13, margin: "12px 0 0",
            }}>{err}</div>
          )}

          <div style={{ height: 16 }} />
          <button className="btn btn-primary btn-block"
            disabled={busy || unassigned.length === 0} onClick={save}>
            {busy ? "Assigning…" : "Assign to Station"}
          </button>
          <div style={{ height: 14 }} />
        </div>
      </div>
    </div>
  );
}

function CoveragePanel({ data, onLoad, stationName, stationNurses, showToast }) {
  const [wardSelections, setWardSelections] = useState({});
  const [wardNurseIds,   setWardNurseIds]   = useState({});
  const [assigningWard,  setAssigningWard]  = useState(null);
  const [loading,        setLoading]        = useState(false);

  useEffect(() => {
    if (!data) {
      setLoading(true);
      onLoad().finally(() => setLoading(false));
    }
  }, []);

  const toggleBed = (wardId, bedName) => {
    setWardSelections((prev) => {
      const s = new Set(prev[wardId] || []);
      s.has(bedName) ? s.delete(bedName) : s.add(bedName);
      return { ...prev, [wardId]: s };
    });
  };

  const assignBeds = async (ward) => {
    const nurseId  = wardNurseIds[ward.ward_id];
    const selected = [...(wardSelections[ward.ward_id] || new Set())];
    if (!nurseId)           { showToast("Select a nurse first"); return; }
    if (selected.length === 0) { showToast("Select at least one bed"); return; }
    setAssigningWard(ward.ward_id);
    try {
      const existing = await api.mgrNurseAccess({ nurseId, wardId: ward.ward_id, status: "active" });
      const asgn = (existing.assignments || [])[0];
      if (asgn) {
        const existingBeds = Array.isArray(asgn.bed_names) ? asgn.bed_names : [];
        const merged = [...new Set([...existingBeds, ...selected])];
        await api.mgrEditNurseAccess(asgn.id, { accessType: asgn.access_type, bedNames: merged, status: "active" });
      } else {
        await api.mgrCreateNurseAccess({ nurseId: Number(nurseId), wardId: ward.ward_id, accessType: "BEDS", bedNames: selected });
      }
      setWardSelections((prev) => ({ ...prev, [ward.ward_id]: new Set() }));
      setWardNurseIds((prev)   => ({ ...prev, [ward.ward_id]: "" }));
      await onLoad();
      showToast(`${selected.length} bed${selected.length !== 1 ? "s" : ""} assigned`);
    } catch (e) { showToast(toastErr(e)); }
    finally { setAssigningWard(null); }
  };

  const exportCsv = () => {
    if (!data) return;
    const rows = [["Station", "Ward", "Total Beds", "Assigned Beds", "Unassigned Beds", "Coverage %"]];
    for (const w of data.wards)
      rows.push([stationName, w.ward_name, w.total_beds, w.assigned_beds, w.unassigned_beds.length, w.coverage_pct + "%"]);
    const csv = rows.map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `coverage-${stationName.replace(/\s+/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  if (loading || !data) {
    return (
      <div className="empty" style={{ padding: "30px 0" }}>
        <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={22} /></span>
      </div>
    );
  }

  const { wards, nurses } = data;

  const coverageTag = (pct) => {
    if (pct >= 100) return <span className="tag v">Fully Covered</span>;
    if (pct >= 80)  return <span className="tag" style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #F59E0B" }}>Partial</span>;
    return <span className="tag o">Needs Coverage</span>;
  };

  return (
    <div>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div className="h1" style={{ fontSize: 16 }}>Coverage Report</div>
        <button className="chip" style={{ color: "var(--teal)" }} onClick={exportCsv}>Export CSV</button>
      </div>

      {nurses.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Nurse Workload</div>
          {nurses.map((n) => (
            <div className="row between" key={n.id} style={{ padding: "4px 0", fontSize: 13 }}>
              <span>{n.name}</span>
              <span className="dim">
                {n.ward_count} ward{n.ward_count !== 1 ? "s" : ""} · {n.bed_count} bed{n.bed_count !== 1 ? "s" : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {wards.length === 0 ? (
        <div className="card empty">
          <div style={{ fontWeight: 600 }}>No wards in this station</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Add wards via Edit Station.</div>
        </div>
      ) : wards.map((w) => {
        const selSet      = wardSelections[w.ward_id] || new Set();
        const nurseForWard = wardNurseIds[w.ward_id] || "";
        const pct         = w.coverage_pct;
        const barColor    = pct >= 100 ? "var(--st-v)" : pct >= 80 ? "#F59E0B" : "var(--st-o)";

        return (
          <div className="card" key={w.ward_id} style={{ padding: 14, marginBottom: 10 }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{w.ward_name}</div>
              <div className="row" style={{ gap: 8 }}>
                {coverageTag(pct)}
                <span className="dim" style={{ fontSize: 12 }}>{pct}%</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--ink-2)", marginBottom: 8 }}>
              <span>Total: <b>{w.total_beds}</b></span>
              <span>Assigned: <b style={{ color: "var(--st-v)" }}>{w.assigned_beds}</b></span>
              <span>Unassigned: <b style={{ color: w.unassigned_beds.length > 0 ? "var(--st-o)" : "var(--ink-3)" }}>{w.unassigned_beds.length}</b></span>
            </div>

            {w.total_beds > 0 && (
              <div style={{ height: 6, borderRadius: 4, background: "var(--line)", overflow: "hidden",
                marginBottom: w.unassigned_beds.length > 0 ? 12 : 0 }}>
                <div style={{ width: pct + "%", height: "100%", background: barColor,
                  borderRadius: 4, transition: "width 0.3s" }} />
              </div>
            )}

            {w.unassigned_beds.length > 0 && (
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>
                  Unassigned Beds
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
                  gap: 5, marginBottom: 10 }}>
                  {w.unassigned_beds.map((bed) => {
                    const checked = selSet.has(bed);
                    return (
                      <label key={bed} style={{
                        display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                        padding: "5px 7px", borderRadius: 7, fontSize: 11,
                        background: checked ? "var(--primary-bg, #EFF6FF)" : "var(--panel-2)",
                        border: "1.5px solid", borderColor: checked ? "var(--primary)" : "var(--line)",
                        fontWeight: checked ? 600 : 400,
                      }}>
                        <input type="checkbox" checked={checked}
                          onChange={() => toggleBed(w.ward_id, bed)}
                          style={{ accentColor: "var(--primary)", flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bed}</span>
                      </label>
                    );
                  })}
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <select className="field" style={{ flex: "1 1 140px", fontSize: 12, padding: "6px 8px" }}
                    value={nurseForWard}
                    onChange={(e) => setWardNurseIds((p) => ({ ...p, [w.ward_id]: e.target.value }))}>
                    <option value="">— Assign to nurse —</option>
                    {stationNurses.map((n) => (
                      <option key={n.id} value={n.id}>{n.name}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    style={{ padding: "6px 12px", fontSize: 12,
                      opacity: selSet.size === 0 || !nurseForWard ? 0.5 : 1 }}
                    disabled={selSet.size === 0 || !nurseForWard || assigningWard === w.ward_id}
                    onClick={() => assignBeds(w)}>
                    {assigningWard === w.ward_id
                      ? "Assigning…"
                      : selSet.size > 0
                        ? `Assign ${selSet.size} bed${selSet.size !== 1 ? "s" : ""}`
                        : "Assign Selected"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  NURSE ACCESS ASSIGNMENTS
// ══════════════════════════════════════════════════════════════════════════════

function NurseAccessModal({ assignment, onClose, onSaved, showToast, stationId }) {
  useModal(onClose);
  const isNew = !assignment;

  const [nurses,    setNurses]    = useState([]);
  const [wards,     setWards]     = useState([]);
  const [beds,      setBeds]      = useState([]);
  const [loadBeds,  setLoadBeds]  = useState(false);

  const [nurseId,   setNurseId]   = useState(assignment?.nurse_id  ? String(assignment.nurse_id)  : "");
  const [wardId,    setWardId]    = useState(assignment?.ward_id   ? String(assignment.ward_id)   : "");
  const [accType,   setAccType]   = useState(assignment?.access_type || "FULL");
  const [selBeds,   setSelBeds]   = useState(new Set(assignment?.bed_names || []));
  const [status,    setStatus]    = useState(assignment?.status || "active");
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState("");

  useEffect(() => {
    Promise.all([api.mgrUsers(), api.mgrWards()]).then(([u, w]) => {
      let allNurses = (u.users || []).filter((x) => x.role === "NURSE");
      if (stationId != null) allNurses = allNurses.filter((x) => x.station_id === stationId);
      setNurses(allNurses);
      let stationWards = (w.wards || []).filter((x) => x.operational !== false);
      if (stationId != null) stationWards = stationWards.filter((x) => x.station_id === stationId);
      setWards(stationWards);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!wardId || accType !== "BEDS") { setBeds([]); return; }
    setLoadBeds(true);
    api.wardBeds(Number(wardId))
      .then((r) => setBeds(r.beds || []))
      .catch(() => {})
      .finally(() => setLoadBeds(false));
  }, [wardId, accType]);

  const toggleBed = (name) => setSelBeds((prev) => {
    const n = new Set(prev);
    n.has(name) ? n.delete(name) : n.add(name);
    return n;
  });

  const save = async () => {
    setErr("");
    if (!nurseId) { setErr("Select a nurse"); return; }
    if (!wardId)  { setErr("Select a ward");  return; }
    if (accType === "BEDS" && selBeds.size === 0) { setErr("Select at least one bed"); return; }
    setBusy(true);
    try {
      const body = { accessType: accType, bedNames: [...selBeds], status };
      if (isNew) {
        await api.mgrCreateNurseAccess({ nurseId: Number(nurseId), wardId: Number(wardId), ...body });
      } else {
        await api.mgrEditNurseAccess(assignment.id, body);
      }
      onSaved();
    } catch (e) {
      setErr(e?.message || "Save failed");
      setBusy(false);
    }
  };

  const selWard = wards.find((w) => w.id === Number(wardId));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="h1" style={{ fontSize: 17 }}>
              {isNew ? "Assign Nurse Access" : "Edit Assignment"}
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          {/* Nurse */}
          <label className="label">Nurse</label>
          <select className="field" value={nurseId}
            onChange={(e) => setNurseId(e.target.value)}
            disabled={!isNew}
            style={!isNew ? { opacity: 0.6 } : {}}>
            <option value="">— Select nurse —</option>
            {nurses.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} (@{n.username}){n.nursing_station ? ` · ${n.nursing_station}` : ""}
              </option>
            ))}
          </select>
          <div style={{ height: 14 }} />

          {/* Ward */}
          <label className="label">Ward</label>
          <select className="field" value={wardId}
            onChange={(e) => { setWardId(e.target.value); setSelBeds(new Set()); }}
            disabled={!isNew}
            style={!isNew ? { opacity: 0.6 } : {}}>
            <option value="">— Select ward —</option>
            {wards.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}{w.block_name ? ` · Block ${w.block_name}` : ""}{w.floor_name ? ` · ${w.floor_name}` : ""}
              </option>
            ))}
          </select>
          <div style={{ height: 14 }} />

          {/* Access type */}
          <label className="label">Access Type</label>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            {[["FULL", "Full Ward Access"], ["BEDS", "Selected Beds"]].map(([val, label]) => (
              <label key={val} style={{
                flex: 1, display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                padding: "9px 12px", borderRadius: 10, border: "1.5px solid",
                borderColor: accType === val ? "var(--primary)" : "var(--line)",
                background: accType === val ? "var(--primary-bg, #EFF6FF)" : "var(--panel-2)",
                fontWeight: accType === val ? 600 : 400, fontSize: 13,
              }}>
                <input type="radio" name="accType" value={val}
                  checked={accType === val}
                  onChange={() => { setAccType(val); setSelBeds(new Set()); }}
                  style={{ accentColor: "var(--primary)" }} />
                {label}
              </label>
            ))}
          </div>

          {/* Bed picker (BEDS only) */}
          {accType === "BEDS" && wardId && (
            <div style={{ marginBottom: 14 }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <label className="label" style={{ margin: 0 }}>
                  Select Beds
                  {selBeds.size > 0 && (
                    <span className="chip" style={{ marginLeft: 8, fontSize: 11 }}>{selBeds.size} selected</span>
                  )}
                  {selWard && (
                    <span className="dim" style={{ fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                      ({selWard.name})
                    </span>
                  )}
                </label>
                <div className="row" style={{ gap: 6 }}>
                  <button className="chip" style={{ fontSize: 11 }}
                    onClick={() => setSelBeds(new Set(beds.map((b) => b.bed_name)))}>
                    Select all
                  </button>
                  <button className="chip" style={{ fontSize: 11, color: "var(--ink-3)" }}
                    onClick={() => setSelBeds(new Set())}>
                    Clear
                  </button>
                </div>
              </div>

              {loadBeds ? (
                <div className="dim" style={{ fontSize: 12, padding: "10px 0" }}>Loading beds…</div>
              ) : beds.length === 0 ? (
                <div className="dim" style={{ fontSize: 12, padding: "10px 0" }}>
                  No beds configured for this ward yet.
                </div>
              ) : (
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                  gap: 6, maxHeight: 260, overflowY: "auto",
                  border: "1px solid var(--line)", borderRadius: 10, padding: 10,
                }}>
                  {beds.map((b) => {
                    const checked = selBeds.has(b.bed_name);
                    return (
                      <label key={b.id} style={{
                        display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
                        padding: "6px 8px", borderRadius: 8, fontSize: 12,
                        background: checked ? "var(--primary-bg, #EFF6FF)" : "var(--panel-2)",
                        border: "1.5px solid", borderColor: checked ? "var(--primary)" : "var(--line)",
                        fontWeight: checked ? 600 : 400,
                      }}>
                        <input type="checkbox" checked={checked}
                          onChange={() => toggleBed(b.bed_name)}
                          style={{ accentColor: "var(--primary)", flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {b.bed_name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Status (edit only) */}
          {!isNew && (
            <>
              <label className="label">Status</label>
              <select className="field" value={status}
                onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <div style={{ height: 14 }} />
            </>
          )}

          {err && (
            <div style={{
              background: "var(--red-bg, #FEF2F2)", color: "var(--red, #DC2626)",
              padding: "9px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12,
            }}>{err}</div>
          )}

          <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
            {busy ? "Saving…" : isNew ? "Save Assignment" : "Save Changes"}
          </button>
          <div style={{ height: 14 }} />
        </div>
      </div>
    </div>
  );
}

function NurseAccessManager({ showToast, stationId }) {
  const [assignments,    setAssignments]    = useState([]);
  const [stationNurseIds, setStationNurseIds] = useState(null);
  const [filterNurse,    setFilterNurse]    = useState("");
  const [filterWard,     setFilterWard]     = useState("");
  const [filterType,     setFilterType]     = useState("");
  const [filterStat,     setFilterStat]     = useState("active");
  const [editing,        setEditing]        = useState(null);
  const [confirm, confirmDialog]            = useConfirm();

  const load = async () => {
    try {
      const r = await api.mgrNurseAccess(filterStat ? { status: filterStat } : {});
      setAssignments(r.assignments || []);
    } catch (e) { showToast(toastErr(e)); }
  };
  useEffect(() => { load(); }, [filterStat]);

  useEffect(() => {
    if (stationId != null) {
      api.mgrUsers().then((r) => {
        const ids = new Set(
          (r.users || []).filter((u) => u.role === "NURSE" && u.station_id === stationId).map((u) => u.id)
        );
        setStationNurseIds(ids);
      }).catch(() => {});
    }
  }, [stationId]);

  const nurses = [...new Map(assignments.map((a) => [a.nurse_id, a.nurse_name])).entries()]
    .filter(([id]) => stationNurseIds == null || stationNurseIds.has(id))
    .sort((x, y) => x[1].localeCompare(y[1]));
  const allWards = [...new Map(assignments.map((a) => [a.ward_id, a.ward_name])).entries()]
    .sort((x, y) => x[1].localeCompare(y[1]));

  const visible = assignments.filter((a) => {
    if (stationNurseIds != null && !stationNurseIds.has(a.nurse_id)) return false;
    if (filterNurse && a.nurse_id !== Number(filterNurse)) return false;
    if (filterWard  && a.ward_id  !== Number(filterWard))  return false;
    if (filterType  && a.access_type !== filterType)        return false;
    return true;
  });

  const fmtBeds = (a) => {
    if (a.access_type === "FULL") return "All Beds";
    const beds = Array.isArray(a.bed_names) ? a.bed_names : [];
    if (beds.length === 0) return "—";
    if (beds.length <= 3) return beds.join(", ");
    return beds.slice(0, 3).join(", ") + ` +${beds.length - 3} more`;
  };

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="h1" style={{ fontSize: 18 }}>Nurse Access Assignments</div>
        <button className="btn btn-primary" style={{ padding: "8px 12px", fontSize: 13 }}
          onClick={() => setEditing("new")}>
          + Assign Nurse Access
        </button>
      </div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        Define exactly which wards or beds each nurse can access. Overrides station-wide access.
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <select className="field" style={{ flex: "1 1 130px", minWidth: 0 }}
          value={filterNurse} onChange={(e) => setFilterNurse(e.target.value)}>
          <option value="">All Nurses</option>
          {nurses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className="field" style={{ flex: "1 1 130px", minWidth: 0 }}
          value={filterWard} onChange={(e) => setFilterWard(e.target.value)}>
          <option value="">All Wards</option>
          {allWards.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className="field" style={{ flex: "1 1 130px", minWidth: 0 }}
          value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          <option value="FULL">Full Access</option>
          <option value="BEDS">Selected Beds</option>
        </select>
        <select className="field" style={{ flex: "1 1 110px", minWidth: 0 }}
          value={filterStat} onChange={(e) => setFilterStat(e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="">All</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="card empty" style={{ marginTop: 14 }}>
          <Ic d={icons.user} s={28} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>No assignments yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Click "+ Assign Nurse Access" to start.</div>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Nurse</th><th>Ward</th><th>Access Type</th>
                <th>Assigned Beds</th><th>Status</th><th style={{ width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{a.nurse_name}</div>
                    <div className="dim" style={{ fontSize: 11 }}>@{a.nurse_username}</div>
                  </td>
                  <td>{a.ward_name}</td>
                  <td>
                    <span className={"tag " + (a.access_type === "FULL" ? "v" : "r")}>
                      {a.access_type === "FULL" ? "Full Access" : "Selected Beds"}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{fmtBeds(a)}</td>
                  <td>
                    <span className={"tag " + (a.status === "active" ? "v" : "b")}
                      style={{ fontSize: 11 }}>
                      {a.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="chip" onClick={() => setEditing(a)}>Edit</button>
                      <button className="chip" style={{ color: "var(--red)" }}
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Remove access for "${a.nurse_name}"?`,
                            message: `Remove ${a.nurse_name}'s ${a.access_type === "FULL" ? "full" : "selected bed"} access to ${a.ward_name}?`,
                            confirmLabel: "Remove",
                            danger: true,
                          });
                          if (!ok) return;
                          try { await api.mgrDeleteNurseAccess(a.id); load(); showToast("Assignment removed"); }
                          catch (e) { showToast(toastErr(e)); }
                        }}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && (
        <NurseAccessModal
          assignment={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); showToast("Saved ✓"); }}
          showToast={showToast}
          stationId={stationId}
        />
      )}
      {confirmDialog}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  PAYER TYPE MANAGER
// ══════════════════════════════════════════════════════════════════════════════
function PayerTypeManager({ showToast }) {
  const [types,    setTypes]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState(false);
  const [newName,  setNewName]  = useState("");
  const [editId,   setEditId]   = useState(null); // id being renamed
  const [editName, setEditName] = useState("");
  const [confirm, confirmDialog] = useConfirm();

  const load = async () => {
    setLoading(true);
    try { setTypes((await api.mgrPayerTypes()).payerTypes || []); }
    catch (e) { showToast(toastErr(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    const n = newName.trim();
    if (!n) return;
    setBusy(true);
    try {
      await api.mgrCreatePayerType(n);
      setNewName("");
      await load();
      showToast(`"${n}" added ✓`);
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const saveRename = async (pt) => {
    const n = editName.trim();
    if (!n || n === pt.name) { setEditId(null); return; }
    setBusy(true);
    try {
      await api.mgrUpdatePayerType(pt.id, { name: n });
      setEditId(null);
      await load();
      showToast(`Renamed to "${n}" ✓`);
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const toggleActive = async (pt) => {
    setBusy(true);
    try {
      await api.mgrUpdatePayerType(pt.id, { active: !pt.active });
      await load();
      showToast(`"${pt.name}" ${pt.active ? "deactivated" : "activated"}`);
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const reorder = async (pt, dir) => {
    setBusy(true);
    try { await api.mgrReorderPayerType(pt.id, dir); await load(); }
    catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const remove = async (pt) => {
    const ok = await confirm({
      title: `Delete "${pt.name}"?`,
      message: `This payer type will be removed. It cannot be deleted if any bed is currently using it.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.mgrDeletePayerType(pt.id);
      await load();
      showToast(`"${pt.name}" deleted`);
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const rowStyle = { display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--line)" };
  const iconBtn  = (onClick, color, title, icon) => (
    <button title={title} onClick={onClick} disabled={busy}
      style={{ background: "none", border: "none", cursor: busy ? "default" : "pointer", color, padding: 4, borderRadius: 6, display: "flex" }}>
      <Ic d={icon} s={16} />
    </button>
  );

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="h2" style={{ marginBottom: 4 }}>Payer Types</div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 18 }}>
        Active types appear in the PRE and Nurse bed-update dropdown. Deactivated types are hidden from staff but preserved in history.
      </div>

      {/* Add new */}
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <label className="label">Add new payer type</label>
        <div className="row" style={{ gap: 8 }}>
          <input className="field" value={newName} style={{ flex: 1 }}
            placeholder='e.g. "Government Scheme"'
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn btn-primary" disabled={busy || !newName.trim()} onClick={add}
            style={{ whiteSpace: "nowrap" }}>
            <Ic d={icons.plus} s={15} /> Add
          </button>
        </div>
      </div>

      {/* List */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="dim" style={{ padding: 32, textAlign: "center" }}>
            <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={20} /></span>
          </div>
        ) : types.length === 0 ? (
          <div className="empty">No payer types yet.</div>
        ) : (
          types.map((pt, i) => (
            <div key={pt.id} style={{ ...rowStyle, background: pt.active ? "transparent" : "var(--panel-2)", opacity: pt.active ? 1 : 0.65 }}>
              {/* Reorder arrows */}
              <div style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0 }}>
                <button disabled={busy || i === 0} onClick={() => reorder(pt, "up")}
                  style={{ background: "none", border: "none", cursor: i === 0 ? "default" : "pointer",
                    color: "var(--ink-3)", padding: "1px 4px", fontSize: 11, lineHeight: 1 }}>▲</button>
                <button disabled={busy || i === types.length - 1} onClick={() => reorder(pt, "down")}
                  style={{ background: "none", border: "none", cursor: i === types.length - 1 ? "default" : "pointer",
                    color: "var(--ink-3)", padding: "1px 4px", fontSize: 11, lineHeight: 1 }}>▼</button>
              </div>

              {/* Name / edit */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {editId === pt.id ? (
                  <input className="field" autoFocus value={editName}
                    style={{ padding: "6px 10px", fontSize: 13 }}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveRename(pt); if (e.key === "Escape") setEditId(null); }}
                    onBlur={() => saveRename(pt)} />
                ) : (
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{pt.name}</span>
                )}
              </div>

              {/* Active badge */}
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                background: pt.active ? "var(--green-bg)" : "var(--panel-2)",
                color: pt.active ? "var(--green)" : "var(--ink-3)",
                border: `1px solid ${pt.active ? "var(--green)" : "var(--line)"}`,
                flexShrink: 0, whiteSpace: "nowrap",
              }}>{pt.active ? "Active" : "Inactive"}</span>

              {/* Actions */}
              <div className="row" style={{ gap: 0, flexShrink: 0 }}>
                {iconBtn(() => { setEditId(pt.id); setEditName(pt.name); }, "var(--primary)", "Rename", icons.pencil)}
                {iconBtn(() => toggleActive(pt), pt.active ? "var(--amber)" : "var(--green)", pt.active ? "Deactivate" : "Activate", pt.active ? icons.eyeOff : icons.eye)}
                {iconBtn(() => remove(pt), "var(--red)", "Delete", icons.trash)}
              </div>
            </div>
          ))
        )}
      </div>
      {confirmDialog}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  HISTORY VIEWER
// ══════════════════════════════════════════════════════════════════════════════
export function HistoryViewer({ showToast }) {
  const [dates,    setDates]    = useState([]);
  const [floors,   setFloors]   = useState([]);
  const [date,     setDate]     = useState("");
  const [floorId,  setFloorId]  = useState("");
  const [rounds,   setRounds]   = useState([]);
  const [census,   setCensus]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    Promise.all([api.mgrHistoryDates(), api.mgrPreBlocks()]).then(([d, b]) => {
      setDates(d.dates  || []);
      setFloors(b.blocks || []);
      if (d.dates?.length) setDate(d.dates[0]);
    }).catch((e) => showToast(toastErr(e)));
  }, []);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    setExpanded({});
    api.mgrHistory(date, floorId ? Number(floorId) : undefined)
      .then((d) => { setRounds(d.rounds || []); setCensus(d.census || null); })
      .catch((e) => { if ((e?.message ?? "") !== "Unauthorized") showToast(toastErr(e)); })
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
          <label className="label">PRE Block</label>
          <select className="field" value={floorId} onChange={(e) => setFloorId(e.target.value)}>
            <option value="">All PRE Blocks</option>
            {floors.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>

      {!loading && rounds.length > 0 && (
        <div className="card glass" style={{ padding: 14, marginBottom: 14 }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <span className="h2">{fmtDateLabel(date)}</span>
            <span className="chip">{rounds.length} round{rounds.length !== 1 ? "s" : ""} · {reportedFloors.size} PRE Block{reportedFloors.size !== 1 ? "s" : ""}</span>
          </div>
          <div style={{ display: "flex", background: "var(--panel-2)", borderRadius: 10, overflow: "hidden" }}>
            {[
              { label: "Vacant",   val: dayTotals.v, color: "var(--st-v)"  },
              { label: "Occupied", val: dayTotals.o, color: "var(--st-o)"  },
              { label: "Reserved", val: dayTotals.r, color: "var(--st-vr)" },
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

      {!loading && census && (() => {
        const wards = Array.isArray(census.wards) ? census.wards : [];
        const tot = wards.reduce((a, w) => ({
          v:  a.v  + (w.vacant || 0),
          o:  a.o  + (w.occupied || 0),
          r:  a.r  + (w.reserved || 0),
          or: a.or + (w.occupied_reserved || 0),
          t:  a.t  + (w.total || 0),
        }), { v: 0, o: 0, r: 0, or: 0, t: 0 });
        const censusBeds    = wards.filter((w) => w.bed_type !== "Non-Census").reduce((a, w) => a + (w.total || 0), 0);
        const isOpen = !!expanded.census;
        return (
          <div className="card" style={{ padding: 14, marginBottom: 14, borderLeft: "3px solid var(--st-vr)" }}>
            <div className="row between">
              <div className="row" style={{ gap: 10 }}>
                <span style={{ color: "var(--st-vr)", display: "flex" }}><Ic d={icons.clock} s={20} /></span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Midnight Census</div>
                  <div className="dim" style={{ fontSize: 11, marginTop: 1 }}>
                    captured {fmtTime(census.ts)} · {wards.length} wards · {censusBeds} census / {tot.t - censusBeds} non-census beds
                  </div>
                </div>
              </div>
              <span className="tag b">12:00 AM</span>
            </div>
            {tot.t > 0 && (
              <div style={{ marginTop: 12 }}>
                <StatusBar v={tot.v} r={tot.r} o={tot.o} or={tot.or} total={tot.t} />
                <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <span className="tag v">{tot.v} vacant</span>
                  <span className="tag r">{tot.r} vac+res</span>
                  <span className="tag o">{tot.o} occupied</span>
                  {tot.or > 0 && <span className="tag or">{tot.or} occ+res</span>}
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
                }} onClick={() => setExpanded((p) => ({ ...p, census: !p.census }))}>
                  {isOpen ? "▲ Hide" : "▼ Show"} ward breakdown ({wards.length})
                </button>
                {isOpen && <WardTable wards={wards} />}
              </>
            )}
          </div>
        );
      })()}

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
          r: a.r + (w.reserved || 0), or: a.or + (w.occupied_reserved || 0),
          t: a.t + (w.total || 0),
        }), { v: 0, o: 0, r: 0, or: 0, t: 0 });
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
                <StatusBar v={tot.v} r={tot.r} o={tot.o} or={tot.or} total={tot.t} />
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <span className="tag v">{tot.v} vacant</span>
                  <span className="tag r">{tot.r} vac+res</span>
                  <span className="tag o">{tot.o} occupied</span>
                  {tot.or > 0 && <span className="tag or">{tot.or} occ+res</span>}
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
                {isOpen && <WardTable wards={wards} />}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
