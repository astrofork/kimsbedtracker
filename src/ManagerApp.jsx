import React, { useState, useEffect } from "react";
import { api, fmtTime, fmtClock, toastErr } from "./lib.js";
import { Ic, icons, StatusBar, ThemeToggle, useModal, BlockAvatar, useConfirm } from "./ui.jsx";

export default function ManagerApp({ user, onLogout }) {
  const [tab, setTab] = useState("blocks");
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
        {tab === "report"  && <Reporting />}
        {tab === "blocks"  && <BlocksManager showToast={showToast} />}
        {tab === "pres"    && <PreManager showToast={showToast} />}
        {tab === "history" && <HistoryViewer />}
      </div>

      <div className="navbar">
        <NavBtn on={tab === "report"}  ic={icons.map}   label="Report"  onClick={() => setTab("report")} />
        <NavBtn on={tab === "blocks"}  ic={icons.bed}   label="Blocks"  onClick={() => setTab("blocks")} />
        <NavBtn on={tab === "pres"}    ic={icons.user}  label="PRE Users" onClick={() => setTab("pres")} />
        <NavBtn on={tab === "history"} ic={icons.clock} label="History" onClick={() => setTab("history")} />
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
  const ms = Date.now() - ts;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 1) return `${h}h ${m}m ago`;
  return `${m}m ago`;
}

function MiniStats({ v, o, r }) {
  return (
    <div style={{ display: "flex", background: "var(--panel-2)", borderRadius: 10, overflow: "hidden", marginTop: 12 }}>
      {[
        { label: "Vacant",   val: v, color: "var(--green)" },
        { label: "Reserved", val: r, color: "var(--amber)" },
        { label: "Occupied", val: o, color: "var(--red)"   },
      ].map(({ label, val, color }, i) => (
        <div key={label} style={{
          flex: 1, textAlign: "center", padding: "10px 4px",
          borderLeft: i > 0 ? "1px solid var(--line)" : "none",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: "var(--ink-3)", fontWeight: 600 }}>{label}</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{val}</div>
        </div>
      ))}
    </div>
  );
}

function Reporting() {
  const [data,       setData]       = useState(null);
  const [compliance, setCompliance] = useState([]);
  const [audit,      setAudit]      = useState([]);
  const [bedsBlock,  setBedsBlock]  = useState(null); // { pre, wards } | null

  const load = async () => {
    try { setData(await api.cooOverview()); } catch {}
    try { setCompliance((await api.cooCompliance()).compliance || []); } catch {}
    try { setAudit((await api.cooAudit()).logs || []); } catch {}
  };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  if (!data) return (
    <div className="empty">
      <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={24} /></span>
      <div style={{ marginTop: 10 }}>Loading…</div>
    </div>
  );

  const compByPre = {};
  for (const c of compliance) compByPre[c.block] = c;
  const scored  = compliance.filter((c) => c.expected > 0);
  const avg     = scored.length ? Math.round(scored.reduce((a, c) => a + c.score, 0) / scored.length) : 100;
  const lagging = scored.filter((c) => c.score < 100).length;

  const now = Date.now();
  const stale = [];
  for (const f of data.floors) for (const p of f.pres)
    for (const w of p.wards)
      if (w.vacant !== null && w.updatedAt && now - w.updatedAt > STALE_MS)
        stale.push({ pre: p.pre, ward: w.ward, updatedAt: w.updatedAt, age: now - w.updatedAt });
  stale.sort((a, b) => b.age - a.age);

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 2 }}>Team Report</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>Live compliance, bed status and activity.</div>

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
                ? "All blocks are submitting on time"
                : `${lagging} block${lagging > 1 ? "s" : ""} behind schedule`}
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
                    Block {s.pre} · <span style={{ color: "var(--ink-2)" }}>{s.ward}</span>
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

      {/* ── Block cards ── */}
      {data.floors.map((f) => (
        <div key={f.name}>
          <div className="floor-head">Block {f.name}</div>
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
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.label || `Block ${p.pre}`}</div>
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
                      {s.v + s.o + s.r > 0
                        ? <StatusBar v={s.v} o={s.o} r={s.r} total={s.total} />
                        : <div className="bar"><span style={{ flex: 1, background: "var(--line)" }} /></div>
                      }
                    </div>

                    {/* Mini stats block */}
                    <MiniStats v={s.v} o={s.o} r={s.r} />

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
            <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none", msOverflowStyle: "none" }}>
              {[
                { key: "ALL",  label: `All (${allBeds.length})`,                color: "var(--ink)" },
                { key: "V",    label: `Vacant (${counts.vn})`,                  color: "var(--green)" },
                { key: "V+R",  label: `V+R (${counts.vr})`,                     color: "var(--amber)" },
                { key: "O",    label: `Occupied (${counts.on_})`,               color: "var(--red)" },
                { key: "O+R",  label: `O+R (${counts.or_})`,                    color: "#8B5CF6" },
                { key: "R",    label: `Reserved (${counts.vr + counts.or_})`,   color: "var(--amber)" },
              ].map(({ key, label, color }) => (
                <button key={key} onClick={() => setFilter(key)} style={{
                  flexShrink: 0,
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
                .sort((a, b) => {
                  const na = parseInt(a.bed_number, 10), nb = parseInt(b.bed_number, 10);
                  return !isNaN(na) && !isNaN(nb) ? na - nb : a.bed_number.localeCompare(b.bed_number);
                });
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

function actionLabel(a) {
  const map = {
    login: "Signed in", ward_update: "Updated beds", round_submit: "Submitted round",
    pre_create: "Created PRE", pre_edit: "Edited PRE", pre_shift: "Changed shift",
    pre_delete: "Deleted PRE", block_create: "Created block", block_edit: "Edited block",
    block_delete: "Deleted block", ward_create: "Created ward", ward_edit: "Edited ward",
    ward_delete: "Deleted ward", bed_add: "Added bed", bed_delete: "Removed bed",
    bed_rename: "Renamed bed", beds_generate: "Generated beds", bed_status_update: "Updated bed status",
  };
  return map[a] || a;
}

// ══════════════════════════════════════════════════════════════════════════════
//  BLOCKS MANAGER — primary management screen
// ══════════════════════════════════════════════════════════════════════════════
function BlocksManager({ showToast }) {
  const [blocks, setBlocks] = useState([]);   // from GET /manager/blocks
  const [wards,  setWards]  = useState([]);   // from GET /manager/wards
  const [editingBlock, setEditingBlock] = useState(null); // null | "new" | block obj
  const [addingWard,   setAddingWard]   = useState(null); // blockId | null
  const [expanded,     setExpanded]     = useState({});   // { [blockId]: bool }
  const [managingBeds, setManagingBeds] = useState(null); // ward obj | null
  const [confirm, confirmDialog] = useConfirm();

  const load = async () => {
    try {
      const [b, w] = await Promise.all([api.mgrBlocks(), api.mgrWards()]);
      setBlocks(b.blocks || []);
      setWards(w.wards   || []);
    } catch (e) { showToast(toastErr(e)); }
  };
  useEffect(() => { load(); }, []);

  const wardsByBlock = {};
  for (const w of wards) { (wardsByBlock[w.block_id] ||= []).push(w); }

  const toggleExpand = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="h1" style={{ fontSize: 18 }}>Blocks &amp; Wards</div>
        <button className="btn btn-primary" style={{ padding: "8px 12px", fontSize: 13 }}
          onClick={() => setEditingBlock("new")}>
          <Ic d={icons.bed} s={15} /> New block
        </button>
      </div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        Manage hospital blocks, their wards, bed counts, and PRE assignments.
      </div>

      {blocks.map(block => {
        const bWards = wardsByBlock[block.id] || [];
        const isOpen = !!expanded[block.id];
        const totalBeds = bWards.reduce((s, w) => s + (w.total_beds ?? 0), 0);
        const hasPre = !!block.user_id;

        return (
          <div className="card" key={block.id} style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
            {/* ── Block header ── */}
            <div style={{ padding: 14 }}>
              <div className="row between">
                <div className="row" style={{ gap: 12 }}>
                  <BlockAvatar code={block.name} size={42} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{block.label || block.name}</div>
                    <div className="dim" style={{ fontSize: 12 }}>
                      {bWards.length} ward{bWards.length !== 1 ? "s" : ""} · {totalBeds} beds
                    </div>
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="chip" onClick={() => setEditingBlock(block)}>Edit</button>
                  <button className="chip" style={{ color: "var(--red)" }}
                    onClick={async () => {
                      const wardCount = bWards.length;
                      if (wardCount > 0) {
                        showToast(`Block "${block.name}" still has ${wardCount} ward${wardCount === 1 ? "" : "s"} — remove them first`);
                        return;
                      }
                      const ok = await confirm({
                        title: `Delete block "${block.name}"?`,
                        message: "Any PRE user assigned to this block will be unassigned.\n\nThis cannot be undone.",
                        confirmLabel: "Delete block",
                        danger: true,
                      });
                      if (!ok) return;
                      try { await api.mgrDeleteBlock(block.id); load(); showToast(`Block "${block.name}" deleted`); }
                      catch (e) { showToast(toastErr(e)); }
                    }}>Del</button>
                </div>
              </div>

              {/* PRE user badge */}
              {hasPre ? (
                <div className="row" style={{ gap: 8, marginTop: 10, padding: "7px 10px", borderRadius: 8, background: "var(--panel-2)" }}>
                  <Ic d={icons.user} s={13} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{block.user_name}</span>
                  <span className={"tag " + (block.shift === "night" ? "b" : "v")}
                    style={{ fontSize: 10, padding: "1px 6px" }}>{block.shift === "night" ? "Night" : "Morning"}</span>
                </div>
              ) : (
                <div style={{ marginTop: 10, padding: "7px 10px", borderRadius: 8, background: "var(--red-bg)",
                  fontSize: 12, color: "var(--red)", fontWeight: 600 }}>
                  ⚠️ No PRE user assigned
                </div>
              )}

              {/* Toggle ward list */}
              <button style={{ marginTop: 10, width: "100%", padding: "7px 0", borderRadius: 8,
                background: "var(--panel-2)", border: "none", cursor: "pointer", fontSize: 12,
                color: "var(--ink-2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                onClick={() => toggleExpand(block.id)}>
                {isOpen ? "▲" : "▼"} {isOpen ? "Hide" : "Show"} wards ({bWards.length})
              </button>
            </div>

            {/* ── Ward list (collapsible) ── */}
            {isOpen && (
              <div style={{ borderTop: "1px solid var(--line)" }}>
                {bWards.length === 0 && (
                  <div className="dim" style={{ padding: "12px 14px", fontSize: 13 }}>No wards yet.</div>
                )}
                {bWards.map((w, i) => (
                  <div key={w.id} style={{
                    padding: "11px 14px",
                    borderBottom: i < bWards.length - 1 ? "1px solid var(--line)" : "none",
                  }}>
                    <div className="row between">
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{w.name}</div>
                        <div className="dim" style={{ fontSize: 11 }}>
                          {w.total_beds} beds
                        </div>
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="chip" style={{ color: "var(--teal)" }}
                          onClick={() => setManagingBeds(w)}>
                          <Ic d={icons.bed} s={13} /> Beds
                        </button>
                        <button className="chip" style={{ color: "var(--red)" }}
                          onClick={async () => {
                            const bedCount = w.total ?? w.total_beds ?? 0;
                            const message = bedCount > 0
                              ? `This will permanently remove the ward and all ${bedCount} bed${bedCount === 1 ? "" : "s"} inside it, along with their status history.\n\nThis cannot be undone.`
                              : "This cannot be undone.";
                            const ok = await confirm({
                              title: `Delete ward "${w.name}"?`,
                              message,
                              confirmLabel: "Delete ward",
                              danger: true,
                            });
                            if (!ok) return;
                            try { await api.mgrDeleteWard(w.id); load(); showToast(`Ward "${w.name}" deleted`); }
                            catch (e) { showToast(toastErr(e)); }
                          }}>Del</button>
                      </div>
                    </div>
                  </div>
                ))}
                {/* Add ward button at bottom of expanded block */}
                <button style={{
                  width: "100%", padding: "11px 14px", border: "none", cursor: "pointer",
                  background: "transparent", display: "flex", alignItems: "center", gap: 6,
                  fontSize: 13, color: "var(--teal)", fontWeight: 600, borderTop: "1px dashed var(--line)",
                }} onClick={() => setAddingWard(block.id)}>
                  <Ic d={icons.bed} s={14} /> + Add ward to {block.name}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {blocks.length === 0 && (
        <div className="card empty" style={{ marginTop: 14 }}>
          <Ic d={icons.bed} s={28} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>No blocks yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Add your first hospital block above.</div>
        </div>
      )}

      {/* ── Block editor sheet ── */}
      {editingBlock !== null && (
        <BlockEditor
          block={editingBlock === "new" ? null : editingBlock}
          onClose={() => setEditingBlock(null)}
          onSaved={() => { setEditingBlock(null); load(); showToast("Saved ✓"); }}
          showToast={showToast}
        />
      )}

      {/* ── Ward creator sheet ── */}
      {addingWard !== null && (
        <WardCreator
          blockId={addingWard}
          blockName={blocks.find(b => b.id === addingWard)?.name || ""}
          onClose={() => setAddingWard(null)}
          onSaved={() => { setAddingWard(null); load(); showToast("Ward created ✓"); }}
          showToast={showToast}
        />
      )}

      {/* ── Bed manager sheet ── */}
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

function BlockEditor({ block, onClose, onSaved, showToast }) {
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
        await api.mgrCreateBlock({ name: name.trim(), label: label.trim() || undefined });
      } else {
        await api.mgrEditBlock(block.id, { name: name.trim(), label: label.trim() || undefined });
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
            <div className="h1" style={{ fontSize: 18 }}>{isNew ? "New block" : `Edit Block ${block.name}`}</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          <label className="label">Block code <span className="dim" style={{ fontSize: 11 }}>(e.g. 1A, 2B)</span></label>
          <input className="field" value={name} autoCapitalize="characters"
            onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="1A" />
          <div style={{ height: 12 }} />

          <label className="label">Label <span className="dim" style={{ fontSize: 11 }}>(optional display name)</span></label>
          <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Block 1A" />
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

function WardCreator({ blockId, blockName, onClose, onSaved, showToast }) {
  useModal(onClose);
  const [name,       setName]       = useState("");
  const [beds,       setBeds]       = useState(10);
  const [genBeds,    setGenBeds]    = useState(true);
  const [startNum,   setStartNum]   = useState(101);
  const [busy,       setBusy]       = useState(false);

  const save = async () => {
    if (!name.trim()) { showToast("Ward name required"); return; }
    setBusy(true);
    try {
      const res = await api.mgrCreateWard({ name: name.trim(), blockId, totalBeds: beds });
      if (genBeds && beds > 0 && res.id) {
        try { await api.generateBeds(res.id, { startNumber: startNum, count: beds }); }
        catch { /* non-fatal — beds can be generated later */ }
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
            <div className="h1" style={{ fontSize: 18 }}>New ward — Block {blockName}</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>
          <label className="label">Ward / room name</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="ICU" />
          <div style={{ height: 12 }} />
          <label className="label">Total beds</label>
          <div className="stepper" style={{ width: "fit-content" }}>
            <button onClick={() => setBeds((b) => Math.max(0, b - 1))}>–</button>
            <span className="val mono">{beds}</span>
            <button onClick={() => setBeds((b) => b + 1)}>+</button>
          </div>

          {beds > 0 && (
            <>
              <div style={{ height: 14 }} />
              <label className="label">Generate individual bed numbers?</label>
              <div className="seg">
                <button className={genBeds ? "on" : ""} onClick={() => setGenBeds(true)}>Yes</button>
                <button className={!genBeds ? "on" : ""} onClick={() => setGenBeds(false)}>No (counts only)</button>
              </div>
              {genBeds && (
                <>
                  <div style={{ height: 12 }} />
                  <label className="label">
                    Start number&nbsp;
                    <span className="dim" style={{ fontSize: 11 }}>
                      (will create {startNum} – {startNum + beds - 1})
                    </span>
                  </label>
                  <input className="field" type="number" min="1" value={startNum}
                    onChange={(e) => setStartNum(Math.max(1, Number(e.target.value)))} />
                </>
              )}
            </>
          )}

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

// ══════════════════════════════════════════════════════════════════════════════
//  BED MANAGER MODAL  (View beds + Manage beds tabs)
// ══════════════════════════════════════════════════════════════════════════════

function BedManagerModal({ ward, onClose, showToast }) {
  useModal(onClose);
  const [beds,          setBeds]          = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [individualBed, setIndividualBed] = useState("");
  const [genStart,      setGenStart]      = useState(101);
  const [genCount,      setGenCount]      = useState(ward.total_beds || 10);
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

  const generate = async () => {
    if (genCount < 1) { showToast("Count must be at least 1"); return; }
    setBusy(true);
    try {
      const res = await api.generateBeds(ward.id, { startNumber: genStart, count: genCount });
      await load();
      showToast(`Generated ${res.generated} beds ✓`);
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const addBed = async () => {
    const num = individualBed.trim();
    if (!num) return;
    setBusy(true);
    try {
      await api.addBed(ward.id, num);
      setIndividualBed("");
      await load();
      showToast(`Bed ${num} added ✓`);
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const startRename = (bed) => { setRenamingId(bed.id); setRenameVal(bed.bed_number); };

  const saveRename = async (bedId) => {
    const val = renameVal.trim();
    if (!val) { showToast("Bed number required"); return; }
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
      title: `Remove bed "${bed.bed_number}"?`,
      message: `Bed will be removed from ${ward.name}. Its status history is kept for the audit log.\n\nThis cannot be undone.`,
      confirmLabel: "Remove bed",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteBed(bed.id);
      await load();
      showToast(`Bed ${bed.bed_number} removed`);
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  // Always display beds in numeric order (matches DB ORDER BY CAST(bed_number AS INTEGER))
  const sortedBeds = [...beds].sort((a, b) => {
    const na = parseInt(a.bed_number, 10), nb = parseInt(b.bed_number, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.bed_number.localeCompare(b.bed_number);
  });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90vh", overflowY: "auto" }}>
        <div className="grab" />
        <div className="pad">
          {/* Header — no status counts */}
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
            /* ── No beds yet: show generate range form ── */
            <>
              <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
                No beds yet. Generate a numbered range or add beds one by one.
              </div>
              <div className="row" style={{ gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label className="label">Start number</label>
                  <input className="field" type="number" min="1" value={genStart}
                    onChange={(e) => setGenStart(Math.max(1, Number(e.target.value)))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">Count</label>
                  <input className="field" type="number" min="1" max="500" value={genCount}
                    onChange={(e) => setGenCount(Math.max(1, Number(e.target.value)))} />
                </div>
              </div>
              <div className="dim" style={{ fontSize: 11, marginBottom: 10 }}>
                Will create: {genStart} – {genStart + genCount - 1}
              </div>
              <button className="btn btn-primary btn-block" disabled={busy} onClick={generate}>
                {busy ? "Generating…" : `Generate ${genCount} beds`}
              </button>
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                <label className="label">Or add a single bed</label>
                <div className="row" style={{ gap: 8 }}>
                  <input className="field" value={individualBed} style={{ flex: 1 }}
                    onChange={(e) => setIndividualBed(e.target.value)}
                    placeholder="e.g. 101A"
                    onKeyDown={(e) => e.key === "Enter" && addBed()} />
                  <button className="btn btn-primary" disabled={busy || !individualBed.trim()}
                    onClick={addBed}>Add</button>
                </div>
              </div>
            </>
          ) : (
            /* ── Beds exist: grid + inline rename + add more ── */
            <>
              {/* Bed grid — 3 columns, name only, sorted numerically */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 20 }}>
                {sortedBeds.map((bed) => (
                  <div key={bed.id} style={{
                    padding: "10px 8px", borderRadius: 10, textAlign: "center",
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
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                          Bed {bed.bed_number}
                        </div>
                        <div className="row" style={{ gap: 4, justifyContent: "center" }}>
                          <button
                            className="chip"
                            style={{ fontSize: 10, padding: "2px 7px", color: "var(--teal)" }}
                            onClick={() => startRename(bed)}>
                            Edit
                          </button>
                          <button
                            className="chip"
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

              {/* Add another bed */}
              <div style={{ paddingTop: 4, borderTop: "1px solid var(--line)" }}>
                <label className="label" style={{ marginTop: 14, display: "block" }}>Add another bed</label>
                <div className="row" style={{ gap: 8 }}>
                  <input className="field" value={individualBed} style={{ flex: 1 }}
                    onChange={(e) => setIndividualBed(e.target.value)}
                    placeholder="Bed number, e.g. 113"
                    onKeyDown={(e) => e.key === "Enter" && addBed()} />
                  <button className="btn btn-primary" disabled={busy || !individualBed.trim()}
                    onClick={addBed}>Add</button>
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
//  PRE USERS MANAGER
// ══════════════════════════════════════════════════════════════════════════════
function PreManager({ showToast }) {
  const [users,   setUsers]   = useState([]);
  const [blocks,  setBlocks]  = useState([]);
  const [editing, setEditing] = useState(null); // null | "new" | user obj
  const [confirm, confirmDialog] = useConfirm();

  const load = async () => {
    try {
      const [u, b] = await Promise.all([api.mgrUsers(), api.mgrBlocks()]);
      setUsers((u.users || []).filter((x) => x.role === "PRE"));
      setBlocks(b.blocks || []);
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
        Create and edit floor-round managers. Assign each PRE user to a block.
      </div>

      {users.map((u) => (
        <div className="card" key={u.id} style={{ padding: 14, marginBottom: 10 }}>
          <div className="row between">
            <div className="row" style={{ gap: 10 }}>
              <BlockAvatar code={u.block_name || "?"} size={36} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name}</div>
                <div className="dim" style={{ fontSize: 11 }}>
                  @{u.username}
                  {u.block_name ? ` · Block ${u.block_name}` : " · ⚠️ no block assigned"}
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
                  const blockInfo = u.block_name ? ` from block ${u.block_name}` : "";
                  const ok = await confirm({
                    title: `Delete user "${u.name}"?`,
                    message: `Username: ${u.username}\n\nThey will lose access immediately and be unassigned${blockInfo}. Past round submissions are kept for the audit log.\n\nThis cannot be undone.`,
                    confirmLabel: "Delete user",
                    danger: true,
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
          blocks={blocks}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); showToast("Saved ✓"); }}
          showToast={showToast}
        />
      )}
      {confirmDialog}
    </div>
  );
}

function PreEditor({ user, blocks, onClose, onSaved, showToast }) {
  const isNew = !user;
  const [username, setUsername] = useState(user?.username || "");
  const [name,     setName]     = useState(user?.name     || "");
  const [password, setPassword] = useState("");
  const [shift,    setShift]    = useState(user?.shift    || "morning");
  // blockId: current user's block_id (from users list) or ""
  const [blockId,  setBlockId]  = useState(user?.block_id != null ? String(user.block_id) : "");
  const [busy,     setBusy]     = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (isNew) {
        if (!username || !password || !name) { showToast("Fill all required fields"); setBusy(false); return; }
        await api.mgrCreatePre({
          username, password, name, shift,
          blockId: blockId ? Number(blockId) : null,
        });
      } else {
        const data = { name, shift, blockId: blockId ? Number(blockId) : null };
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
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="1A Manager" />
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
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••" />
          <div style={{ height: 12 }} />

          <label className="label">Assigned block</label>
          <select className="field" value={blockId} onChange={(e) => setBlockId(e.target.value)}>
            <option value="">— Unassigned —</option>
            {blocks.map((b) => (
              <option key={b.id} value={b.id}>{b.name}{b.label ? ` · ${b.label}` : ""}</option>
            ))}
          </select>
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
//  HISTORY VIEWER
// ══════════════════════════════════════════════════════════════════════════════
function HistoryViewer() {
  const [dates,   setDates]   = useState([]);
  const [blocks,  setBlocks]  = useState([]);
  const [date,    setDate]    = useState("");
  const [blockId, setBlockId] = useState("");
  const [rounds,  setRounds]  = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([api.mgrHistoryDates(), api.mgrBlocks()]).then(([d, b]) => {
      setDates(d.dates || []);
      setBlocks(b.blocks || []);
      if (d.dates?.length) setDate(d.dates[0]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    api.mgrHistory(date, blockId ? Number(blockId) : undefined)
      .then((d) => setRounds(d.rounds || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [date, blockId]);

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>Previous data</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>Pick a date to view that day's submitted rounds.</div>

      <div className="row" style={{ gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Date</label>
          <select className="field" value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.length === 0 && <option value="">No history yet</option>}
            {dates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Block</label>
          <select className="field" value={blockId} onChange={(e) => setBlockId(e.target.value)}>
            <option value="">All blocks</option>
            {blocks.map((b) => <option key={b.id} value={b.id}>Block {b.name}</option>)}
          </select>
        </div>
      </div>

      {loading && <div className="dim" style={{ fontSize: 13 }}>Loading…</div>}
      {!loading && rounds.length === 0 && date && (
        <div className="card empty"><Ic d={icons.clock} s={26} /><div style={{ marginTop: 10, fontWeight: 600 }}>No rounds on this date</div></div>
      )}

      {rounds.map((r, i) => (
        <div className="card" key={i} style={{ padding: 14, marginBottom: 10 }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 10 }}>
              <BlockAvatar code={r.blockName || String(r.blockId)} size={34} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Block {r.blockName || r.blockId}</div>
                <div className="dim" style={{ fontSize: 11, marginTop: 1 }}>submitted {fmtTime(r.submittedAt)}</div>
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className={"tag " + (r.shift === "night" ? "b" : "v")}>{r.shift}</span>
              <span className="chip">{fmtClock(r.startMin)}</span>
            </div>
          </div>
          {Array.isArray(r.wards) && r.wards.map((w, j) => (
            <div className="row between" key={j} style={{ padding: "4px 0", fontSize: 13 }}>
              <span>{w.ward}</span>
              <span className="mono">
                <span style={{ color: "var(--green)" }}>{w.vacant}</span> /
                <span style={{ color: "var(--red)" }}> {w.occupied}</span> /
                <span style={{ color: "var(--amber)" }}> {w.reserved}</span>
                <span className="dim"> of {w.total}</span>
              </span>
            </div>
          ))}
        </div>
      ))}
      {rounds.length > 0 && (
        <div className="dim" style={{ fontSize: 11, textAlign: "center", marginTop: 6 }}>
          green vacant · red occupied · amber reserved
        </div>
      )}
    </div>
  );
}
