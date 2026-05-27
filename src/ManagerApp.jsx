import React, { useState, useEffect } from "react";
import { api, fmtTime, fmtClock } from "./lib.js";
import { Ic, icons, StatusBar, ThemeToggle } from "./ui.jsx";

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
          <span className="pre-pill"><Ic d={icons.clock} s={13} /> {fmtTime(Date.now())}</span>
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
//  REPORTING (team view — unchanged from previous, works with current API)
// ══════════════════════════════════════════════════════════════════════════════
const STALE_MS = 3 * 60 * 60 * 1000;

function Reporting() {
  const [data, setData] = useState(null);
  const [compliance, setCompliance] = useState([]);
  const [audit, setAudit] = useState([]);

  const load = async () => {
    try { setData(await api.cooOverview()); } catch {}
    try { setCompliance((await api.cooCompliance()).compliance || []); } catch {}
    try { setAudit((await api.cooAudit()).logs || []); } catch {}
  };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  if (!data) return <div className="empty"><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={24} /></span><div style={{ marginTop: 10 }}>Loading…</div></div>;

  const compByPre = {};
  for (const c of compliance) compByPre[c.block] = c;
  const scored = compliance.filter((c) => c.expected > 0);
  const avg = scored.length ? Math.round(scored.reduce((a, c) => a + c.score, 0) / scored.length) : 100;
  const lagging = scored.filter((c) => c.score < 100).length;

  const now = Date.now();
  const stale = [];
  for (const f of data.floors) for (const p of f.pres)
    for (const w of p.wards)
      if (w.vacant !== null && w.updatedAt && now - w.updatedAt > STALE_MS)
        stale.push({ pre: p.pre, ward: w.ward, updatedAt: w.updatedAt });

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>Team reporting</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>Live progress, compliance, activity and stale-ward alerts.</div>

      <div className="card" style={{ padding: 14, marginBottom: 14, borderColor: avg >= 80 ? "var(--teal-deep)" : "var(--red)" }}>
        <div className="row between">
          <div>
            <div className="h2">Today's compliance</div>
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{lagging === 0 ? "All blocks on schedule" : `${lagging} block${lagging > 1 ? "s" : ""} behind`}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: avg >= 80 ? "var(--green)" : avg >= 50 ? "var(--amber)" : "var(--red)" }}>{avg}%</div>
            <div className="dim" style={{ fontSize: 10 }}>on-time rounds</div>
          </div>
        </div>
      </div>

      {stale.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 14, background: "var(--red-bg)", borderColor: "var(--red)" }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <span style={{ color: "var(--red)" }}><Ic d={icons.bell} s={18} /></span>
            <span style={{ fontWeight: 700, color: "var(--red)" }}>{stale.length} stale ward{stale.length > 1 ? "s" : ""}</span>
          </div>
          {stale.slice(0, 5).map((s, i) => (
            <div key={i} className="dim" style={{ fontSize: 12, marginLeft: 26 }}>{s.pre} · {s.ward} — last {fmtTime(s.updatedAt)}</div>
          ))}
        </div>
      )}

      {data.floors.map((f) => (
        <div key={f.name}>
          <div className="floor-head">Block {f.name}</div>
          {f.pres.map((p) => {
            const s = p.summary;
            const c = compByPre[p.pre];
            return (
              <div className="card" key={p.pre} style={{ padding: 14, marginBottom: 10 }}>
                <div className="row between">
                  <div className="row" style={{ gap: 10 }}>
                    <div className="logo" style={{ width: 34, height: 34, fontSize: 12,
                      background: s.complete ? "linear-gradient(135deg,var(--green),var(--teal))" : "var(--panel-2)",
                      color: s.complete ? "#fff" : "var(--ink-2)" }}>{p.pre}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.label || p.pre}</div>
                      <div className="dim" style={{ fontSize: 11 }}>
                        {p.assignedUser ? p.assignedUser.name : "⚠️ No PRE assigned"}
                        {s.wards > 0 ? ` · ${s.total} beds · ${s.wards} wards` : " · no beds mapped"}
                      </div>
                    </div>
                  </div>
                  {s.wards === 0 ? <span className="tag b">pending</span>
                    : p.alarm?.alarmActive ? <span className="tag o pulse">overdue</span>
                    : s.complete ? <span className="tag v"><Ic d={icons.check} s={12} /> done</span>
                    : s.wardsDone > 0 ? <span className="tag r">{Math.round((s.wardsDone / s.wards) * 100)}%</span>
                    : <span className="tag o">no data</span>}
                </div>
                {s.wards > 0 && (
                  <>
                    <div style={{ marginTop: 12 }}><StatusBar v={s.v} o={s.o} r={s.r} total={s.total} /></div>
                    <div className="row between" style={{ marginTop: 8 }}>
                      <span className="dim" style={{ fontSize: 11 }}>
                        <span style={{ color: "var(--green)" }}>{s.v}V</span> · <span style={{ color: "var(--red)" }}>{s.o}O</span> · <span style={{ color: "var(--amber)" }}>{s.r}R</span>
                      </span>
                      <span className="dim" style={{ fontSize: 11 }}>
                        {p.roundsToday != null ? `${p.roundsToday} rounds today` : ""}
                        {p.lastSubmittedAt ? ` · ${fmtTime(p.lastSubmittedAt)}` : ""}
                      </span>
                    </div>
                    {c && c.expected > 0 && (
                      <div className="row between" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
                        <span className="dim" style={{ fontSize: 11 }}>Rounds {c.submitted}/{c.expected} · {c.shift}</span>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: c.score >= 80 ? "var(--green)" : c.score >= 50 ? "var(--amber)" : "var(--red)" }}>{c.score}%</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <div className="floor-head">Recent activity</div>
      <div className="card" style={{ padding: 8 }}>
        {audit.slice(0, 12).map((a, i) => (
          <div key={i} className="row between" style={{ padding: "8px 6px", borderBottom: i < 11 ? "1px solid var(--line)" : "none" }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="dim" style={{ fontSize: 11, minWidth: 54 }}>{fmtTime(a.ts)}</span>
              <span style={{ fontSize: 12 }}>{actionLabel(a.action)}{a.entity ? ` · ${a.entity}` : ""}</span>
            </div>
            <span className="dim" style={{ fontSize: 11 }}>{a.username || "—"}</span>
          </div>
        ))}
        {audit.length === 0 && <div className="dim" style={{ padding: 12, fontSize: 12 }}>No activity yet.</div>}
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
    ward_delete: "Deleted ward",
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
  const [expanded, setExpanded] = useState({});           // { [blockId]: bool }

  const load = async () => {
    try {
      const [b, w] = await Promise.all([api.mgrBlocks(), api.mgrWards()]);
      setBlocks(b.blocks || []);
      setWards(w.wards   || []);
    } catch (e) { showToast(e.message); }
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
                  <div className="logo" style={{
                    width: 42, height: 42, fontSize: 13, borderRadius: 10,
                    background: hasPre ? "linear-gradient(135deg,var(--teal),var(--teal-deep))" : "var(--panel-2)",
                    color: hasPre ? "#fff" : "var(--ink-3)", fontWeight: 800,
                  }}>{block.name}</div>
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
                      if (!window.confirm(`Delete block "${block.name}"?\nAll wards must be removed first.`)) return;
                      try { await api.mgrDeleteBlock(block.id); load(); showToast(`Block ${block.name} deleted`); }
                      catch (e) { showToast(e.message); }
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
                  <div key={w.id} className="row between" style={{
                    padding: "11px 14px",
                    borderBottom: i < bWards.length - 1 ? "1px solid var(--line)" : "none",
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{w.name}</div>
                      <div className="dim" style={{ fontSize: 11 }}>{w.total_beds} beds</div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <BedEditor ward={w} onSaved={() => { load(); showToast("Beds updated ✓"); }} showToast={showToast} />
                      <button className="chip" style={{ color: "var(--red)" }}
                        onClick={async () => {
                          if (!window.confirm(`Delete ward "${w.name}"?`)) return;
                          try { await api.mgrDeleteWard(w.id); load(); showToast("Ward deleted"); }
                          catch (e) { showToast(e.message); }
                        }}>Del</button>
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
    </div>
  );
}

function BlockEditor({ block, onClose, onSaved, showToast }) {
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
    } catch (e) { showToast(e.message); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
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
  const [name, setName] = useState("");
  const [beds, setBeds] = useState(10);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
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
          <button className="btn btn-primary btn-block" style={{ marginTop: 18 }}
            onClick={async () => {
              if (!name.trim()) { showToast("Ward name required"); return; }
              try { await api.mgrCreateWard({ name: name.trim(), blockId, totalBeds: beds }); onSaved(); }
              catch (e) { showToast(e.message); }
            }}>
            Create ward
          </button>
          <div style={{ height: 14 }} />
        </div>
      </div>
    </div>
  );
}

function BedEditor({ ward, onSaved, showToast }) {
  const [open, setOpen] = useState(false);
  const [beds, setBeds] = useState(ward.total_beds);
  if (!open) return <button className="chip" onClick={() => setOpen(true)}>Beds</button>;
  return (
    <div className="row" style={{ gap: 6 }}>
      <div className="stepper">
        <button onClick={() => setBeds((b) => Math.max(0, b - 1))}>–</button>
        <span className="val mono">{beds}</span>
        <button onClick={() => setBeds((b) => b + 1)}>+</button>
      </div>
      <button className="chip" style={{ color: "var(--teal)" }}
        onClick={async () => {
          try { await api.mgrEditWard(ward.id, { totalBeds: beds }); setOpen(false); onSaved(); }
          catch (e) { showToast(e.message); }
        }}>Save</button>
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

  const load = async () => {
    try {
      const [u, b] = await Promise.all([api.mgrUsers(), api.mgrBlocks()]);
      setUsers((u.users || []).filter((x) => x.role === "PRE"));
      setBlocks(b.blocks || []);
    } catch (e) { showToast(e.message); }
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
              <div className="logo" style={{ width: 36, height: 36, fontSize: 12,
                background: u.block_name
                  ? "linear-gradient(135deg,var(--teal),var(--teal-deep))"
                  : "var(--panel-2)",
                color: u.block_name ? "#fff" : "var(--ink-3)",
              }}>{u.block_name || "?"}</div>
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
                  if (!window.confirm(`Delete ${u.name}?\nThis is permanent.`)) return;
                  try { await api.mgrDeletePre(u.id); load(); showToast("PRE deleted"); }
                  catch (e) { showToast(e.message); }
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
    } catch (e) { showToast(e.message); setBusy(false); }
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
          <div className="row between" style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>Block {r.blockName || r.blockId}</div>
            <div className="row" style={{ gap: 8 }}>
              <span className={"tag " + (r.shift === "night" ? "b" : "v")}>{r.shift}</span>
              <span className="chip">{fmtClock(r.startMin)}</span>
            </div>
          </div>
          <div className="dim" style={{ fontSize: 11, marginBottom: 8 }}>submitted {fmtTime(r.submittedAt)}</div>
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
