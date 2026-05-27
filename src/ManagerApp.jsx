import React, { useState, useEffect } from "react";
import { api, fmtTime, fmtClock } from "./lib.js";
import { Ic, icons, StatusBar, ThemeToggle } from "./ui.jsx";

export default function ManagerApp({ user, onLogout }) {
  const [tab, setTab] = useState("pres");
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
        {tab === "report" && <Reporting />}
        {tab === "pres" && <PreManager showToast={showToast} />}
        {tab === "wards" && <WardManager showToast={showToast} />}
        {tab === "history" && <HistoryViewer />}
      </div>

      <div className="navbar">
        <NavBtn on={tab === "report"} ic={icons.map} label="Reporting" onClick={() => setTab("report")} />
        <NavBtn on={tab === "pres"} ic={icons.user} label="PREs" onClick={() => setTab("pres")} />
        <NavBtn on={tab === "wards"} ic={icons.bed} label="Wards & Beds" onClick={() => setTab("wards")} />
        <NavBtn on={tab === "history"} ic={icons.clock} label="History" onClick={() => setTab("history")} />
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function NavBtn({ on, ic, label, onClick }) {
  return <button className={on ? "on" : ""} onClick={onClick}><span style={{ lineHeight: 1 }}><Ic d={ic} s={20} /></span>{label}</button>;
}

/* ---------------- Reporting (team view moved from COO) ---------------- */
const STALE_MS = 3 * 60 * 60 * 1000; // ward not updated in 3h = stale

function Reporting() {
  const [data, setData] = useState(null);
  const [compliance, setCompliance] = useState([]);
  const [audit, setAudit] = useState([]);

  const load = async () => {
    try { setData(await api.cooOverview()); } catch (e) {}
    try { setCompliance((await api.cooCompliance()).compliance || []); } catch (e) {}
    try { setAudit((await api.cooAudit()).logs || []); } catch (e) {}
  };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  if (!data) return <div className="empty"><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={24} /></span><div style={{ marginTop: 10 }}>Loading…</div></div>;

  const compByPre = {};
  for (const c of compliance) compByPre[c.pre] = c;
  const scored = compliance.filter((c) => c.expected > 0);
  const avg = scored.length ? Math.round(scored.reduce((a, c) => a + c.score, 0) / scored.length) : 100;
  const lagging = scored.filter((c) => c.score < 100).length;

  // stale wards across all PREs
  const now = Date.now();
  const stale = [];
  for (const f of data.floors) for (const p of f.pres)
    for (const w of p.wards) {
      if (w.vacant !== null && w.updatedAt && now - w.updatedAt > STALE_MS)
        stale.push({ pre: p.pre, ward: w.ward, updatedAt: w.updatedAt });
    }

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>Team reporting</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>Live progress, on-time compliance, activity, and stale-ward alerts.</div>

      {/* compliance banner */}
      <div className="card" style={{ padding: 14, marginBottom: 14, borderColor: avg >= 80 ? "var(--teal-deep)" : "var(--red)" }}>
        <div className="row between">
          <div>
            <div className="h2">Today's compliance</div>
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{lagging === 0 ? "All PREs on schedule" : `${lagging} PRE${lagging > 1 ? "s" : ""} behind`}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: avg >= 80 ? "var(--green)" : avg >= 50 ? "var(--amber)" : "var(--red)" }}>{avg}%</div>
            <div className="dim" style={{ fontSize: 10 }}>on-time rounds</div>
          </div>
        </div>
      </div>

      {/* (3) stale ward warnings */}
      {stale.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 14, background: "var(--red-bg)", borderColor: "var(--red)" }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <span style={{ color: "var(--red)" }}><Ic d={icons.alert || icons.bell} s={18} /></span>
            <span style={{ fontWeight: 700, color: "var(--red)" }}>{stale.length} stale ward{stale.length > 1 ? "s" : ""}</span>
          </div>
          {stale.slice(0, 5).map((s, i) => (
            <div key={i} className="dim" style={{ fontSize: 12, marginLeft: 26 }}>{s.pre} · {s.ward} — last {fmtTime(s.updatedAt)}</div>
          ))}
        </div>
      )}

      {/* team list with (1) rounds done + last submitted */}
      {data.floors.map((f) => (
        <div key={f.name}>
          <div className="floor-head">{f.name}</div>
          {f.pres.map((p) => {
            const s = p.summary;
            const c = compByPre[p.pre];
            return (
              <div className="card" key={p.pre} style={{ padding: 14, marginBottom: 10 }}>
                <div className="row between">
                  <div className="row" style={{ gap: 10 }}>
                    <div className="logo" style={{ width: 34, height: 34, fontSize: 11, background: s.complete ? "linear-gradient(135deg,var(--green),var(--teal))" : "var(--panel-2)", color: s.complete ? "#FFFFFF" : "var(--ink-2)" }}>{p.pre.replace("PRE-", "P")}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.pre}</div>
                      <div className="dim" style={{ fontSize: 11 }}>{s.wards > 0 ? `${s.total} beds · ${s.wards} wards` : "no beds mapped"}</div>
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
                        {p.roundsToday != null ? `${p.roundsToday} rounds today` : ""}{p.lastSubmittedAt ? ` · ${fmtTime(p.lastSubmittedAt)}` : ""}
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

      {/* (2) live activity feed */}
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
    ward_create: "Created ward", ward_edit: "Edited ward", ward_delete: "Deleted ward",
  };
  return map[a] || a;
}


/* ---------------- PRE management ---------------- */
function PreManager({ showToast }) {
  const [users, setUsers] = useState([]);
  const [floors, setFloors] = useState([]);
  const [editing, setEditing] = useState(null); // user object or "new"
  const load = async () => {
    try {
      const u = await api.mgrUsers();
      setUsers(u.users.filter((x) => x.role === "PRE"));
      const f = await api.mgrFloors();
      setFloors(f.floors.map((x) => x.name));
    } catch (e) { showToast(e.message); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="h1" style={{ fontSize: 18 }}>PRE accounts</div>
        <button className="btn btn-primary" style={{ padding: "8px 12px", fontSize: 13 }} onClick={() => setEditing("new")}>
          <Ic d={icons.user} s={15} /> Add PRE
        </button>
      </div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>Create and edit floor-round managers, set their shift and login.</div>

      {users.map((u) => (
        <div className="card" key={u.id} style={{ padding: 14, marginBottom: 10 }}>
          <div className="row between">
            <div className="row" style={{ gap: 10 }}>
              <div className="logo" style={{ width: 34, height: 34, fontSize: 11 }}>{(u.pre || "P").replace("PRE-", "P")}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name}</div>
                <div className="dim" style={{ fontSize: 11 }}>@{u.username} · {u.pre || "unassigned"}</div>
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className={"tag " + (u.shift === "night" ? "b" : "v")}>{u.shift === "night" ? "Night" : "Morning"}</span>
              <button className="chip" onClick={() => setEditing(u)}>Edit</button>
              {/* FIX: PRE delete with guard confirmation */}
              <button className="chip" style={{ color: "var(--red)" }}
                onClick={async () => {
                  if (!window.confirm(`Delete ${u.name} (${u.pre})?\n\nThis is permanent. Remove their wards first if any are assigned.`)) return;
                  try { await api.mgrDeletePre(u.id); load(); showToast("PRE deleted"); }
                  catch (e) { showToast(e.message); }
                }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}

      {editing && (
        <PreEditor user={editing === "new" ? null : editing} floors={floors}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); showToast("Saved ✓"); }}
          showToast={showToast} />
      )}
    </div>
  );
}

function PreEditor({ user, floors, onClose, onSaved, showToast }) {
  const isNew = !user;
  const [username, setUsername] = useState(user?.username || "");
  const [name, setName] = useState(user?.name || "");
  const [preCode, setPreCode] = useState(user?.pre || "");
  const [password, setPassword] = useState("");
  const [shift, setShift] = useState(user?.shift || "morning");
  // FIX: floor selector available both on create AND edit
  const [floor, setFloor] = useState(floors[0] || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (isNew) {
        if (!username || !password || !name || !preCode) { showToast("Fill all fields"); setBusy(false); return; }
        await api.mgrCreatePre({ username, password, name, preCode, floor: floor || undefined, shift });
      } else {
        const data = { name, shift };
        if (password) data.password = password;
        if (preCode) data.preCode = preCode;
        await api.mgrEditPre(user.id, data);
        // FIX: if floor changed, reassign all wards of this PRE atomically
        const targetCode = preCode || user.pre;
        if (targetCode && floor) {
          await api.mgrSetPreFloor(targetCode, floor || null);
        }
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
            <div className="h1" style={{ fontSize: 18 }}>{isNew ? "New PRE" : "Edit " + user.name}</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          <label className="label">Display name</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="PRE-11 Manager" />
          <div style={{ height: 12 }} />

          {isNew && <>
            <label className="label">Username (for login)</label>
            <input className="field" value={username} autoCapitalize="none"
              onChange={(e) => setUsername(e.target.value)} placeholder="pre11" />
            <div style={{ height: 12 }} />
          </>}

          <label className="label">PRE code</label>
          <input className="field" value={preCode} onChange={(e) => setPreCode(e.target.value)} placeholder="PRE-11" />
          <div style={{ height: 12 }} />

          <label className="label">{isNew ? "Password" : "New password (leave blank to keep)"}</label>
          <input className="field" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" />
          <div style={{ height: 12 }} />

          {/* FIX: floor selector shown for both new and edit */}
          {floors.length > 0 && <>
            <label className="label">Floor {!isNew && <span className="dim" style={{ fontSize: 11 }}>(reassigns all wards)</span>}</label>
            <select className="field" value={floor} onChange={(e) => setFloor(e.target.value)}>
              <option value="">(Unassigned)</option>
              {floors.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <div style={{ height: 12 }} />
          </>}

          <label className="label">Shift</label>
          <div className="seg">
            <button className={shift === "morning" ? "on" : ""} onClick={() => setShift("morning")}>Morning · 9–6:30</button>
            <button className={shift === "night" ? "on" : ""} onClick={() => setShift("night")}>Night · 8pm–8am</button>
          </div>

          <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} disabled={busy} onClick={save}>
            {busy ? "Saving…" : isNew ? "Create PRE" : "Save changes"}
          </button>
          <div style={{ height: 14 }} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- Ward & bed management ---------------- */
function WardManager({ showToast }) {
  const [wards, setWards] = useState([]);
  const [adding, setAdding] = useState(false);
  const load = async () => { try { setWards((await api.mgrWards()).wards); } catch (e) { showToast(e.message); } };
  useEffect(() => { load(); }, []);

  // group by PRE
  const byPre = {};
  for (const w of wards) { (byPre[w.pre_code] ||= []).push(w); }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="h1" style={{ fontSize: 18 }}>Wards &amp; beds</div>
        <button className="btn btn-primary" style={{ padding: "8px 12px", fontSize: 13 }} onClick={() => setAdding(true)}>
          <Ic d={icons.bed} s={15} /> Add ward
        </button>
      </div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>Rooms (wards) and their bed counts, grouped by PRE.</div>

      {Object.entries(byPre).map(([pre, list]) => (
        <div key={pre}>
          <div className="floor-head">{pre} · {list[0]?.floor || "no floor"}</div>
          {list.map((w) => (
            <div className="card" key={w.id} style={{ padding: 13, marginBottom: 9 }}>
              <div className="row between">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{w.name}</div>
                  <div className="dim" style={{ fontSize: 11 }}>{w.total_beds} beds</div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <BedEditor ward={w} onSaved={() => { load(); showToast("Beds updated ✓"); }} showToast={showToast} />
                  <button className="chip" style={{ color: "var(--red)" }}
                    onClick={async () => { try { await api.mgrDeleteWard(w.id); load(); showToast("Deleted"); } catch (e) { showToast(e.message); } }}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}

      {adding && <WardCreator onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); showToast("Ward created ✓"); }} showToast={showToast} />}
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
        onClick={async () => { try { await api.mgrEditWard(ward.id, { totalBeds: beds }); setOpen(false); onSaved(); } catch (e) { showToast(e.message); } }}>
        Save
      </button>
    </div>
  );
}

function WardCreator({ onClose, onSaved, showToast }) {
  const [name, setName] = useState("");
  const [preCode, setPreCode] = useState("");
  const [floor, setFloor] = useState("");
  const [beds, setBeds] = useState(1);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="h1" style={{ fontSize: 18 }}>New ward</div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>
          <label className="label">Ward / room name</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="ICU" />
          <div style={{ height: 12 }} />
          <label className="label">PRE code</label>
          <input className="field" value={preCode} onChange={(e) => setPreCode(e.target.value)} placeholder="PRE-1" />
          <div style={{ height: 12 }} />
          <label className="label">Floor (optional)</label>
          <input className="field" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="1st Floor" />
          <div style={{ height: 12 }} />
          <label className="label">Total beds</label>
          <div className="stepper" style={{ width: "fit-content" }}>
            <button onClick={() => setBeds((b) => Math.max(0, b - 1))}>–</button>
            <span className="val mono">{beds}</span>
            <button onClick={() => setBeds((b) => b + 1)}>+</button>
          </div>
          <button className="btn btn-primary btn-block" style={{ marginTop: 18 }}
            onClick={async () => {
              if (!name || !preCode) { showToast("Name and PRE code required"); return; }
              try { await api.mgrCreateWard({ name, preCode, totalBeds: beds, floor: floor || undefined }); onSaved(); }
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

/* ---------------- History viewer (date dropdown) ---------------- */
function HistoryViewer() {
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState("");
  const [rounds, setRounds] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.mgrHistoryDates().then((d) => {
      setDates(d.dates);
      if (d.dates.length) { setDate(d.dates[0]); }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    api.mgrHistory(date).then((d) => setRounds(d.rounds)).catch(() => {}).finally(() => setLoading(false));
  }, [date]);

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>Previous data</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>Pick a date to view that day's submitted rounds.</div>

      <label className="label">Date</label>
      <select className="field" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginBottom: 16 }}>
        {dates.length === 0 && <option value="">No history yet</option>}
        {dates.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>

      {loading && <div className="dim" style={{ fontSize: 13 }}>Loading…</div>}
      {!loading && rounds.length === 0 && date && (
        <div className="card empty"><Ic d={icons.clock} s={26} /><div style={{ marginTop: 10, fontWeight: 600 }}>No rounds on this date</div></div>
      )}

      {rounds.map((r, i) => (
        <div className="card" key={i} style={{ padding: 14, marginBottom: 10 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>{r.pre}</div>
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
