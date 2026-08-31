import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api, toastErr, getSocket, onReconnect } from "./lib.js";
import { AppShell } from "./shell.jsx";
import { Ic, icons } from "./ui.jsx";
import { BackBtn } from "./PREApp.jsx";

function minutesSince(ts) {
  return Math.max(0, Math.floor((Date.now() - Number(ts || 0)) / 60000));
}

const HK_COLS = [
  { key: "waiting", label: "Pending",     color: "var(--st-o)" },
  { key: "doing",   label: "In Progress", color: "var(--st-clean)" },
  { key: "overdue", label: "Overdue",     color: "var(--red)" },
];

function hkCounts(beds, tat) {
  const tasks   = beds.filter((b) => b.task_id);
  const doing   = tasks.filter((b) => b.task_status === "IN_PROGRESS");
  const overdue = tasks.filter((b) => minutesSince(b.created_at) > Number(b.expected_minutes || tat));
  return { waiting: tasks.length - doing.length, doing: doing.length, overdue: overdue.length, total: tasks.length };
}

function statusTag(overdue, pending) {
  if (overdue > 0) return <span className="tag" style={{ background: "var(--red)", color: "#fff" }}>{overdue} overdue</span>;
  if (pending > 0) return <span className="tag b">{pending} pending</span>;
  return <span className="tag v"><Ic d={icons.check} s={12} /> All clear</span>;
}

function WardCard({ ward, tat, onClick }) {
  const c = hkCounts(ward.beds, tat);

  return (
    <div className="ward-card" onClick={onClick}
      style={{ cursor: "pointer", padding: 16, display: "flex", flexDirection: "column",
               borderColor: c.overdue ? "var(--red)" : c.total ? "var(--st-o)" : "var(--st-v)" }}>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{ward.name}</div>
          <div className="dim" style={{ fontSize: 12 }}>{ward.beds.length} bed{ward.beds.length !== 1 ? "s" : ""}</div>
        </div>
        {statusTag(c.overdue, c.total)}
      </div>

      <div className="ward-stats-4" style={{ marginBottom: 14 }}>
        {HK_COLS.map(({ key, label, color }) => (
          <div key={key} className="ws-col">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span className="ws-label">{label}</span>
            </div>
            <div className="ws-val" style={{ color }}>{c[key]}</div>
          </div>
        ))}
      </div>

      <div className="row ward-card-btns" style={{ gap: 8, marginTop: "auto", flexWrap: "wrap" }}>
        <button className="btn btn-primary" style={{ flex: "1 1 100px", padding: "9px 0", fontSize: 13 }}>
          <Ic d={icons.bed} s={13} /> View Beds
        </button>
      </div>
    </div>
  );
}

function BedCard({ bed, tat, busy, onStart, onComplete }) {
  const mins = bed.task_id ? minutesSince(bed.created_at) : 0;
  const limit = Number(bed.expected_minutes || tat);
  const over = !!bed.task_id && mins > limit;
  const doing = bed.task_status === "IN_PROGRESS";

  const badgeCls = over ? "o" : doing ? "clean" : bed.task_id ? "o" : "v";
  const badgeLabel = over ? "Overdue" : doing ? "Cleaning" : bed.task_id ? "Pending" : "Upcoming";

  return (
    <div className={`hkc st-${badgeCls}`}>
      <div className="hkc-head">
        <span className="hkc-title">{bed.bed_name}</span>
        <span className={`pbadge ${badgeCls}`}>{badgeLabel}</span>
      </div>

      {bed.task_id && (
        <div className="hkc-details">
          <div className="hkc-row">
            <span className="hkc-label">Source</span>
            <span className="hkc-val">{bed.source === "TRANSFER" ? "Transfer" : "Discharge"}</span>
          </div>
          <div className="hkc-row">
            <span className="hkc-label">TAT</span>
            <span className="hkc-val">{limit}m</span>
          </div>
          {doing && bed.claimed_name && (
            <div className="hkc-row">
              <span className="hkc-label">Started by</span>
              <span className="hkc-val" style={{ color: "var(--primary)" }}>{bed.claimed_name}</span>
            </div>
          )}
          {mins > 0 && (
            <div className="hkc-row">
              <span className="hkc-label">{over ? "Overdue by" : "Time Left"}</span>
              <span className={"hkc-val" + (over ? " hkc-urgent" : "")}>
                {over ? mins - limit : limit - mins}m
              </span>
            </div>
          )}
        </div>
      )}

      {bed.task_id && (
        <div className="hkc-actions">
          {doing ? (
            <button className="hkc-btn hkc-btn-pri" disabled={busy} aria-busy={busy || undefined}
              onClick={() => onComplete(bed.id)}>
              {busy ? <><span className="dc-spinner" aria-hidden="true" />Marking Done…</> : "Mark Done"}
            </button>
          ) : (
            <button className="hkc-btn hkc-btn-pri" disabled={busy} aria-busy={busy || undefined}
              onClick={() => onStart(bed.id)}>
              {busy ? <><span className="dc-spinner" aria-hidden="true" />Starting…</> : "Start"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const BED_FILTERS = [
  { key: "all",      label: "All" },
  { key: "pending",  label: "Pending" },
  { key: "cleaning", label: "Cleaning" },
  { key: "overdue",  label: "Overdue" },
];

const WARD_FILTERS = [
  { key: "all",     label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "active",  label: "Active" },
  { key: "clear",   label: "Clear" },
];

function BedsPage({ ward, tat, busyBed, onStart, onComplete, onBack, initialSearch }) {
  const [search, setSearch] = useState(initialSearch || "");
  const [filter, setFilter] = useState("all");

  const q = search.trim().toLowerCase();
  const filtered = ward.beds.filter((b) => {
    if (q && !b.bed_name.toLowerCase().includes(q)) return false;
    if (filter === "pending")  return b.task_id && b.task_status !== "IN_PROGRESS";
    if (filter === "cleaning") return b.task_status === "IN_PROGRESS";
    if (filter === "overdue")  return b.task_id && minutesSince(b.created_at) > Number(b.expected_minutes || tat);
    return true;
  });

  const counts = {
    all: ward.beds.length,
    pending:  ward.beds.filter((b) => b.task_id && b.task_status !== "IN_PROGRESS").length,
    cleaning: ward.beds.filter((b) => b.task_status === "IN_PROGRESS").length,
    overdue:  ward.beds.filter((b) => b.task_id && minutesSince(b.created_at) > Number(b.expected_minutes || tat)).length,
  };

  return (
    <div>
      <BackBtn label={ward.name} onClick={onBack} style={{ marginBottom: 12 }} />

      <div className="pill-search entry-tools" style={{ marginBottom: 10 }}>
        <div className="entry-search">
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex" }}>
            <Ic d={icons.search} s={15} />
          </span>
          <input className="field" value={search} placeholder="Search bed..."
            style={{ paddingLeft: 38, paddingRight: search ? 36 : 15 }}
            onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Clear search"
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex", padding: 4, background: "none", border: "none", cursor: "pointer" }}>
              <Ic d={icons.x} s={14} />
            </button>
          )}
        </div>
      </div>

      <div className="hkc-filters">
        {BED_FILTERS.map(({ key, label }) => (
          <button key={key} className={"hkc-pill" + (filter === key ? " on" : "")}
            onClick={() => setFilter(key)}>
            {label}<span className="pill-n">{counts[key]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        ward.beds.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", minHeight: "60vh", padding: "0 20px" }}>
            <svg style={{ width: "min(180px, 44vw)", height: "auto", display: "block" }} viewBox="0 0 440 400" xmlns="http://www.w3.org/2000/svg">
              <g className="hk-illo-in"><g className="hk-float">
                <path fill="var(--ink-3)" opacity="0.12" d="M150 150C110 130 120 90 165 78C205 68 250 78 285 70C330 60 372 78 372 118C372 158 340 172 305 185C260 202 195 178 150 150Z"/>
                <path fill="var(--ink-3)" opacity="0.08" d="M170 300C120 300 96 258 118 224C138 196 178 200 214 196C258 191 300 200 316 236C332 272 306 300 262 306C226 311 205 300 170 300Z"/>
                <path className="hk-orbit" fill="none" stroke="var(--ink-3)" strokeWidth="2.4" strokeLinecap="round" d="M300 96C356 118 356 190 300 208M150 150C96 176 108 244 168 250"/>
                <g className="hk-leaves">
                  <path fill="var(--st-v)" opacity="0.5" d="M150 300C150 262 172 236 210 232C204 274 184 300 150 300Z"/>
                  <path fill="var(--st-v)" opacity="0.7" d="M158 300C154 272 168 246 200 240C199 274 186 296 158 300Z"/>
                  <path fill="none" stroke="var(--st-v)" strokeWidth="1.6" strokeLinecap="round" opacity="0.4" d="M162 296C176 276 192 262 204 246"/>
                </g>
                <g className="hk-clipboard">
                  <ellipse cx="221" cy="316" rx="86" ry="12" fill="var(--ink)" opacity="0.04"/>
                  <rect x="152" y="112" width="138" height="188" rx="16" fill="#fff" stroke="var(--line)" strokeWidth="2"/>
                  <rect x="196" y="98" width="50" height="30" rx="10" fill="var(--ink-3)"/>
                  <rect x="205" y="90" width="32" height="18" rx="9" fill="var(--ink-2)"/>
                  <circle cx="221" cy="97" r="5" fill="#fff"/>
                  <g className="hk-eyes" fill="var(--ink-2)">
                    <rect x="199" y="182" width="9" height="17" rx="4.5"/>
                    <rect x="234" y="182" width="9" height="17" rx="4.5"/>
                  </g>
                  <path d="M203 208Q221 226 239 208" fill="none" stroke="var(--ink-2)" strokeWidth="5" strokeLinecap="round"/>
                  <rect x="178" y="244" width="86" height="9" rx="4.5" fill="var(--line)"/>
                  <rect x="178" y="264" width="66" height="9" rx="4.5" fill="var(--line)" opacity="0.6"/>
                </g>
                <g className="hk-bucket">
                  <path fill="none" stroke="var(--ink-2)" strokeWidth="6" strokeLinecap="round" d="M268 236C268 210 332 210 332 236"/>
                  <path fill="var(--ink-3)" d="M262 234L338 234L330 300C329 306 324 310 318 310L282 310C276 310 271 306 270 300Z"/>
                  <path fill="#fff" opacity="0.18" d="M262 234L338 234L336 250L264 250Z"/>
                  <g className="hk-spark hk-spark-b">
                    <path fill="#fff" d="M300 258C302 268 306 272 316 274C306 276 302 280 300 290C298 280 294 276 284 274C294 272 298 268 300 258Z"/>
                  </g>
                </g>
                <g className="hk-spark hk-spark-a">
                  <path fill="var(--primary)" d="M168 150C171 162 176 167 188 170C176 173 171 178 168 190C165 178 160 173 148 170C160 167 165 162 168 150Z"/>
                </g>
                <g className="hk-spark hk-spark-c">
                  <path fill="var(--st-v)" d="M306 158C308 167 312 171 321 173C312 175 308 179 306 188C304 179 300 175 291 173C300 171 304 167 306 158Z"/>
                </g>
              </g></g>
            </svg>
            <div style={{ fontWeight: 700, fontSize: 17, color: "var(--ink)", marginTop: -6 }}>No tasks yet</div>
            <div style={{ fontSize: 13, marginTop: 4, color: "var(--ink-3)" }}>All beds in this ward are clean</div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink-3)" }}>
            <Ic d={icons.search} s={28} />
            <div style={{ marginTop: 8, fontWeight: 600, fontSize: 14 }}>No matching beds</div>
          </div>
        )
      ) : (
        <div className="hkc-grid">
          {filtered.map((bd) => (
            <BedCard key={bd.id} bed={bd} tat={tat} busy={busyBed === bd.id}
              onStart={onStart} onComplete={onComplete} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Board tab — unchanged from the original: ward cards drilling into bed
// cards. This is the existing product; it is not part of the redesign. ─────
function HousekeepingBoard({ isManager, onDrillChange }) {
  const [board, setBoard] = useState(null);
  const [err, setErr] = useState("");
  const [busyBed, setBusyBed] = useState(null);
  const [toast, setToast] = useState("");
  const [openWard, setOpenWard] = useState(null);
  const [search, setSearch] = useState("");
  const [wardFilter, setWardFilter] = useState("all");

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2200); }, []);

  const load = useCallback(() => {
    api.hkBoard()
      .then((d) => { setBoard(d); setErr(""); })
      .catch((e) => setErr(toastErr(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    const socket = getSocket();
    const onBed = (b) => {
      if (!b || b.id == null) return;
      setBoard((prev) => {
        if (!prev) return prev;
        let touched = false;
        const wards = prev.wards.map((w) => {
          if (Number(w.id) !== Number(b.ward_id)) return w;
          const has = w.beds.some((x) => Number(x.id) === Number(b.id));
          if (!b.housekeeping_status && !b.task_id) {
            if (!has) return w;
            touched = true;
            return { ...w, beds: w.beds.filter((x) => Number(x.id) !== Number(b.id)) };
          }
          touched = true;
          return has
            ? { ...w, beds: w.beds.map((x) => (Number(x.id) === Number(b.id) ? { ...x, ...b } : x)) }
            : { ...w, beds: [...w.beds, b] };
        });
        return touched ? { ...prev, wards } : prev;
      });
    };
    socket.on("hk:bed", onBed);
    const offReconnect = onReconnect(socket, () => loadRef.current());
    return () => { socket.off("hk:bed", onBed); offReconnect(); };
  }, []);

  const act = async (bedId, fn, msg) => {
    setBusyBed(bedId);
    try { await fn(bedId); showToast(msg); }
    catch (e) { showToast(toastErr(e)); load(); }
    finally { setBusyBed(null); }
  };
  const start = (bedId) => act(bedId, api.hkStart, "Started");
  const complete = (bedId) => act(bedId, api.hkComplete, "Marked clean");

  const wards = board?.wards || [];
  const tat = board?.tat ?? 10;

  const wardData = useMemo(() => {
    if (openWard == null) return null;
    return wards.find((w) => Number(w.id) === Number(openWard)) || null;
  }, [wards, openWard]);

  useEffect(() => { onDrillChange?.(!!wardData); }, [wardData, onDrillChange]);

  const q = search.trim().toLowerCase();
  const searchedWards = wards.filter((w) => !q
    || w.name.toLowerCase().includes(q)
    || w.beds.some((b) => b.bed_name.toLowerCase().includes(q)));

  const wardCounts = {
    all: wards.length,
    overdue: wards.filter((w) => hkCounts(w.beds, tat).overdue > 0).length,
    active:  wards.filter((w) => hkCounts(w.beds, tat).total > 0).length,
    clear:   wards.filter((w) => hkCounts(w.beds, tat).total === 0).length,
  };
  const visibleWards = searchedWards.filter((w) => {
    const c = hkCounts(w.beds, tat);
    if (wardFilter === "overdue") return c.overdue > 0;
    if (wardFilter === "active")  return c.total > 0;
    if (wardFilter === "clear")   return c.total === 0;
    return true;
  });

  return (
    <>
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginBottom: 10 }}>{err}</div>}

      {board && wards.length === 0 && (
        <div className="card empty" style={{ padding: 32 }}>
          <Ic d={icons.bed} s={28} />
          <div style={{ marginTop: 10, fontWeight: 700, fontSize: 14 }}>No wards assigned</div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            Ask your administrator to assign wards to your account.
          </div>
        </div>
      )}

      {wards.length > 0 && (
        wardData ? (
          <BedsPage
            ward={wardData}
            tat={tat}
            busyBed={busyBed}
            onStart={start}
            onComplete={complete}
            initialSearch={q && wardData.beds.some((b) => b.bed_name.toLowerCase().includes(q)) ? search : ""}
            onBack={() => setOpenWard(null)}
          />
        ) : (
          <div>
            <div className="pill-search entry-tools">
              <div className="entry-search">
                <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex" }}>
                  <Ic d={icons.search} s={15} />
                </span>
                <input className="field" value={search} placeholder="Search ward or bed..."
                  style={{ paddingLeft: 38, paddingRight: search ? 36 : 15 }}
                  onChange={(e) => setSearch(e.target.value)} />
                {search && (
                  <button onClick={() => setSearch("")} aria-label="Clear search"
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex", padding: 4, background: "none", border: "none", cursor: "pointer" }}>
                    <Ic d={icons.x} s={14} />
                  </button>
                )}
              </div>
              <div className="hkc-filters hkc-filters-inline">
                {WARD_FILTERS.map(({ key, label }) => (
                  <button key={key} className={"hkc-pill" + (wardFilter === key ? " on" : "")}
                    onClick={() => setWardFilter(key)}>
                    {label}<span className="pill-n">{wardCounts[key]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="card-grid">
              {visibleWards.map((w) => (
                <WardCard key={w.id} ward={w} tat={tat} onClick={() => setOpenWard(w.id)} />
              ))}
            </div>
          </div>
        )
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

// ── Manager analytics — a new, separate tab. Org-wide, not scoped to the
// manager's own ward assignments — the manager oversees every housekeeping
// ward, not just the ones they personally clean. Staff are ward-assigned, not
// task-assigned (see housekeepingService.managerAnalytics on the backend for
// why per-person "assigned/remaining" isn't a fact the schema supports), so
// the table reports what's actually true per person: their current activity
// state, which wards they cover, and what they've completed. Backlog
// (pending/overdue) stays per ward, since a ward's queue is shared by
// everyone assigned to it. ──────────────────────────────────────────────
const RANGES = [
  { key: 1,  label: "Today" },
  { key: 7,  label: "7 days" },
  { key: 30, label: "30 days" },
];

// Local to this page — mirrors ConsultantApp's ward-avatar hashing so staff
// initials read as part of the same visual language as the rest of BedFlow,
// without reaching into another page's private helpers. Used for both staff
// and ward rows below.
const HKA_AVATAR_COLORS = ["#0d9488", "#2563eb", "#7c3aed", "#d97706", "#dc2626", "#0891b2"];
function hkaAvatarColor(key) {
  const s = String(key);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HKA_AVATAR_COLORS[h % HKA_AVATAR_COLORS.length];
}
function hkaInitials(name) {
  const words = (name || "?").trim().split(/\s+/);
  return words.length > 1 ? (words[0][0] + words[1][0]).toUpperCase() : (name || "?").slice(0, 2).toUpperCase();
}

// A person's status is a real, honest read of two facts already on the row —
// whether they hold an active task right now, and whether they've completed
// anything in the selected range — not a fabricated field.
function staffStatus(s) {
  if (s.activeNow > 0) return { tone: "clean", label: "Working" };
  if (s.completedInRange > 0) return { tone: "v", label: "Completed" };
  return { tone: "o", label: "No activity" };
}

// Completed / in progress / pending are the only three states that are
// mutually exclusive and additive to a real total — overdue is a subset of
// pending+in-progress (a task past its TAT is still either pending or in
// progress), not a fourth bucket, so it never gets a ring slice of its own.
// Giving it one would double-count against whichever slice it actually
// belongs to. Overdue stays visible as its own KPI card and in "Team status"
// instead.
function Donut({ segments, size, thickness }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-2)" strokeWidth={thickness} />
      {total > 0 && segments.filter((s) => s.value > 0).map((s) => {
        const len = (s.value / total) * c;
        const dashoffset = -offset;
        offset += len;
        return (
          <circle key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
            strokeWidth={thickness} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={dashoffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeLinecap="butt" />
        );
      })}
    </svg>
  );
}

function ManagerAnalytics() {
  const [range, setRange] = useState(1);
  const [search, setSearch] = useState("");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    api.hkManagerAnalytics(range)
      .then((d) => { if (live) { setData(d); setErr(""); } })
      .catch((e) => { if (live) setErr(toastErr(e)); });
    return () => { live = false; };
  }, [range]);

  const rangeLabel = RANGES.find((r) => r.key === range)?.label || "Today";

  if (err) return <div style={{ color: "var(--red)", fontSize: 12 }}>{err}</div>;
  if (!data) return null;

  const { summary, staff, wards } = data;

  const kpis = [
    { key: "pending", label: "Pending", tone: "o",     icon: icons.clock, value: summary.pendingNow },
    { key: "doing",   label: "In Progress", tone: "clean", icon: icons.bed, value: summary.inProgressNow },
    { key: "overdue", label: "Overdue", tone: "red",   icon: icons.alert, value: summary.overdueNow },
    { key: "done",    label: "Completed", tag: rangeLabel, tone: "v", icon: icons.check, value: summary.completedInRange },
  ];

  const ringTotal = summary.completedInRange + summary.inProgressNow + summary.pendingNow;
  const pct = (n) => ringTotal > 0 ? Math.round((n / ringTotal) * 1000) / 10 : 0;
  const ringLegend = [
    { key: "done",    label: "Completed",   value: summary.completedInRange, pct: pct(summary.completedInRange), color: "var(--st-v)" },
    { key: "doing",   label: "In Progress", value: summary.inProgressNow,    pct: pct(summary.inProgressNow),    color: "var(--st-clean)" },
    { key: "pending", label: "Pending",     value: summary.pendingNow,       pct: pct(summary.pendingNow),       color: "var(--st-o)" },
  ];

  const working = staff.filter((s) => s.activeNow > 0);
  const idle = staff.filter((s) => s.activeNow === 0 && s.completedInRange === 0);
  const maxCompleted = Math.max(1, ...staff.map((s) => s.completedInRange));

  const q = search.trim().toLowerCase();
  const visibleStaff = staff.filter((s) => !q
    || s.name.toLowerCase().includes(q)
    || s.wards.some((w) => w.toLowerCase().includes(q)));

  const urgentWards = wards.filter((w) => w.overdue > 0).length;

  return (
    <div className="hka">
      <div className="hka-toolbar">
        <div className="hka-rangewrap">
          <Ic d={icons.clock} s={14} />
          <select value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Time range">
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        <div className="pill-search hka-search-wrap">
          <div className="field-search hka-search">
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex" }}>
              <Ic d={icons.search} s={14} />
            </span>
            <input className="field" value={search} placeholder="Search staff or ward…"
              style={{ paddingLeft: 36, paddingRight: search ? 34 : 14 }}
              onChange={(e) => setSearch(e.target.value)} />
            {search && (
              <button onClick={() => setSearch("")} aria-label="Clear search"
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex", padding: 4, background: "none", border: "none", cursor: "pointer" }}>
                <Ic d={icons.x} s={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="hka-kpis">
        {kpis.map((k) => (
          <div className={"hka-kpi tone-" + k.tone} key={k.key}>
            <span className="hka-kpi-ico"><Ic d={k.icon} s={16} /></span>
            <div className="hka-kpi-label">{k.label}{k.tag && <span className="hka-kpi-tag">{k.tag}</span>}</div>
            <div className="hka-kpi-val">{k.value}</div>
            <div className="hka-kpi-sub">Tasks</div>
            <div className="hka-kpi-bar" />
          </div>
        ))}
      </div>

      <div className="hka-row2">
        <div className="hka-card">
          <h3>Task completion overview</h3>
          <div className="hka-ring-wrap">
            <div className="hka-ring">
              <Donut size={150} thickness={16} segments={ringLegend.map((s) => ({ key: s.key, value: s.value, color: s.color }))} />
              <div className="hka-ring-center">
                <div className="hka-ring-val">{ringTotal}</div>
                <div className="hka-ring-label">Total tasks</div>
              </div>
            </div>
            <div className="hka-ring-legend">
              {ringLegend.map((s) => (
                <div className="hka-ring-row" key={s.key}>
                  <i style={{ background: s.color }} />
                  <span className="hka-ring-name">{s.label}</span>
                  <span className="hka-ring-num">{s.value} <em>({s.pct}%)</em></span>
                </div>
              ))}
              <div className="hka-ring-row muted">
                <i style={{ background: "var(--red)" }} />
                <span className="hka-ring-name">Overdue</span>
                <span className="hka-ring-num">{summary.overdueNow} <em>of the above</em></span>
              </div>
            </div>
          </div>
        </div>

        <div className="hka-card">
          <h3>Team status</h3>
          <div className="hka-teamrow">
            <span className="hka-team-ico tone-clean"><Ic d={icons.users} s={16} /></span>
            <div>
              <div className="hka-team-val">{working.length}</div>
              <div className="hka-team-label">Active staff · working now</div>
            </div>
          </div>
          <div className="hka-teamrow">
            <span className="hka-team-ico tone-v"><Ic d={icons.check} s={16} /></span>
            <div>
              <div className="hka-team-val">{summary.completedInRange}</div>
              <div className="hka-team-label">Completed · {rangeLabel.toLowerCase()}</div>
            </div>
          </div>
          <div className="hka-teamrow">
            <span className="hka-team-ico tone-red"><Ic d={icons.alert} s={16} /></span>
            <div>
              <div className="hka-team-val">{summary.overdueNow}</div>
              <div className="hka-team-label">Overdue — need attention</div>
            </div>
          </div>
          {idle.length > 0 && (
            <div className="hka-teamrow">
              <span className="hka-team-ico tone-o"><Ic d={icons.clock} s={16} /></span>
              <div>
                <div className="hka-team-val">{idle.length}</div>
                <div className="hka-team-label">No activity yet this range</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="hka-row2">
        <div className="hka-card">
          <h3>Staff performance</h3>
          <div className="hka-cardsub">Performance of housekeeping staff</div>

          {visibleStaff.length === 0 ? (
            <div className="hka-empty">{staff.length === 0 ? "No active housekeeping accounts." : "No staff match your search."}</div>
          ) : (
            <div className="hka-stafflist">
              {visibleStaff.map((s) => {
                const st = staffStatus(s);
                return (
                  <div className="hka-scard" key={s.id}>
                    <span className="hka-avatar" style={{ background: hkaAvatarColor(s.id) }}>{hkaInitials(s.name)}</span>
                    <div className="hka-scard-body">
                      <div className="hka-scard-head">
                        <span className="hka-scard-name">{s.name}</span>
                        {s.role === "HOUSEKEEPING_MANAGER"
                          ? <span className="hka-pill tone-clean">Manager</span>
                          : <span className={"hka-pill tone-" + st.tone}>{st.label}</span>}
                      </div>
                      <div className="hka-scard-wards" title={s.wards.join(", ")}>{s.wards.length ? s.wards.join(", ") : "No wards assigned"}</div>
                      <div className="hka-scard-stats">
                        <div className="hka-scard-stat">
                          <div className="hka-scard-num">{s.activeNow || 0}</div>
                          <div className="hka-scard-statlabel">In progress</div>
                        </div>
                        <div className="hka-scard-progress">
                          <div className="hka-scard-progresstop">
                            <span className="hka-scard-num">{s.completedInRange}</span>
                            <span className="hka-scard-statlabel">Completed</span>
                            <span className="hka-scard-pct">{Math.round((s.completedInRange / maxCompleted) * 100)}%</span>
                          </div>
                          <div className="hka-bar-track"><div className="hka-bar-fill" style={{ width: `${(s.completedInRange / maxCompleted) * 100}%` }} /></div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="hka-card">
          <div className="hka-cardhead">
            <h3>Ward backlog</h3>
            {urgentWards > 0 && <span className="hka-cardnote urgent">{urgentWards} ward{urgentWards !== 1 ? "s" : ""} overdue</span>}
          </div>

          {wards.length === 0 ? (
            <div className="hka-empty">No wards with active or recent housekeeping work.</div>
          ) : (
            <div className="hka-wtbl-wrap">
              <div className="hka-wtbl-head">
                <span>Ward</span><span>Pending</span><span>In progress</span><span>Overdue</span><span>Completed</span>
              </div>
              {wards.map((w) => (
                <div className={"hka-wtbl-row" + (w.overdue > 0 ? " urgent" : "")} key={w.id}>
                  <span className="hka-wtbl-name">{w.name}</span>
                  <span className="hka-cell-num">{w.pending}</span>
                  <span className="hka-cell-num">{w.inProgress}</span>
                  <span className={"hka-cell-num" + (w.overdue > 0 ? " urgent" : "")}>{w.overdue}</span>
                  <span className="hka-cell-num">{w.completedInRange}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HousekeepingApp({ user, onLogout }) {
  const isManager = user.role === "HOUSEKEEPING_MANAGER";
  const [navTab, setNavTab] = useState("board");
  const [drilled, setDrilled] = useState(false);

  const menu = isManager
    ? [
        { key: "board", icon: icons.bed, label: "Housekeeping" },
        { key: "analytics", icon: icons.chart, label: "Analytics" },
      ]
    : [{ key: "board", icon: icons.bed, label: "Housekeeping" }];

  return (
    <AppShell
      menu={menu}
      active={navTab}
      onSelect={setNavTab}
      title={navTab === "analytics" ? "Analytics" : "Housekeeping"}
      user={{ name: user.name || user.username || "Housekeeping",
              role: isManager ? "HK MANAGER" : "HOUSEKEEPING" }}
      onLogout={onLogout}
      hideAppbar={navTab === "board" && drilled}
    >
      {navTab === "analytics"
        ? <ManagerAnalytics />
        : <HousekeepingBoard isManager={isManager} onDrillChange={setDrilled} />}
    </AppShell>
  );
}
