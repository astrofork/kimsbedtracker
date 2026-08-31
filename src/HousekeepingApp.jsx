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
// this reports what's actually true per person: currently-active tasks and
// tasks they personally completed. Backlog (pending/overdue) is reported per
// ward, since a ward's queue is shared by everyone assigned to it.
//
// The composition follows the manager's actual order of concern rather than
// a KPI-row-then-tables template:
//   1. Is anything overdue right now? — a status line that changes character
//      depending on the real answer (urgent vs calm), not a stat box.
//   2. How is completion trending in the selected range? — one segmented bar
//      built from the three real counts, no invented percentage.
//   3. Who needs attention? — staff split into three real, mutually exclusive
//      groups (no activity / working now / completed something), because
//      "who hasn't done anything" is the one question a ranked list buries.
//   4. Where is work piling up? — wards as a severity-ordered list, not a
//      table, with fully-clear wards visually receding instead of taking the
//      same weight as the ones that need eyes on them. ─────────────────────
const RANGES = [
  { key: 1,  label: "Today" },
  { key: 7,  label: "7 days" },
  { key: 30, label: "30 days" },
];

// Local to this page — mirrors ConsultantApp's ward-avatar hashing so staff
// initials read as part of the same visual language as the rest of BedFlow,
// without reaching into another page's private helpers.
const HKA_AVATAR_COLORS = ["#0d9488", "#2563eb", "#7c3aed", "#d97706", "#dc2626", "#0891b2"];
function staffAvatarColor(key) {
  const s = String(key);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HKA_AVATAR_COLORS[h % HKA_AVATAR_COLORS.length];
}
function staffInitials(name) {
  const words = (name || "?").trim().split(/\s+/);
  return words.length > 1 ? (words[0][0] + words[1][0]).toUpperCase() : (name || "?").slice(0, 2).toUpperCase();
}

function ManagerAnalytics() {
  const [range, setRange] = useState(1);
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

  const overdueWardNames = wards.filter((w) => w.overdue > 0).map((w) => w.name);
  const totalTracked = summary.completedInRange + summary.pendingNow + summary.inProgressNow;
  const maxCompleted = Math.max(1, ...staff.map((s) => s.completedInRange));

  const working = staff.filter((s) => s.activeNow > 0);
  const idle = staff.filter((s) => s.activeNow === 0 && s.completedInRange === 0);
  const finished = staff.filter((s) => s.activeNow === 0 && s.completedInRange > 0);

  const worstWard = wards.length ? wards[0] : null;
  const anyBacklog = wards.some((w) => w.pending > 0 || w.inProgress > 0 || w.overdue > 0);

  return (
    <div className="hka">
      <div className="hka-top">
        <div className={"hka-status" + (summary.overdueNow > 0 ? " urgent" : "")}>
          <div className="hka-status-headline">
            {summary.overdueNow > 0
              ? `${summary.overdueNow} bed${summary.overdueNow !== 1 ? "s" : ""} overdue`
              : "No beds overdue"}
          </div>
          {summary.overdueNow > 0 && (
            <div className="hka-status-sub">{overdueWardNames.join(" · ")}</div>
          )}
        </div>
        <div className="hka-range" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.key} className={range === r.key ? "on" : undefined} onClick={() => setRange(r.key)}>{r.label}</button>
          ))}
        </div>
      </div>

      <div className="hka-progress">
        {totalTracked > 0 ? (
          <div className="hka-pbar">
            {summary.completedInRange > 0 && <span className="seg done" style={{ flexGrow: summary.completedInRange }} />}
            {summary.inProgressNow > 0 && <span className="seg doing" style={{ flexGrow: summary.inProgressNow }} />}
            {summary.pendingNow > 0 && <span className="seg wait" style={{ flexGrow: summary.pendingNow }} />}
          </div>
        ) : (
          <div className="hka-pbar empty" />
        )}
        <div className="hka-legend">
          <span><i className="done" />Completed <b>{summary.completedInRange}</b> · {rangeLabel.toLowerCase()}</span>
          <span><i className="doing" />In progress <b>{summary.inProgressNow}</b></span>
          <span><i className="wait" />Pending <b>{summary.pendingNow}</b></span>
        </div>
      </div>

      <div className="hka-cols">
        {/* Who needs attention */}
        <section className="hka-section">
          <h3>Staff <span className="hka-count">{summary.totalStaff}</span></h3>

          {idle.length > 0 && (
            <div className="hka-group flag">
              <div className="hka-group-head">No activity yet <b>{idle.length}</b></div>
              <div className="hka-namewrap">
                {idle.map((s) => <span className="hka-name-plain" key={s.id}>{s.name}</span>)}
              </div>
            </div>
          )}

          {working.length > 0 && (
            <div className="hka-group">
              <div className="hka-group-head">Working now <b>{working.length}</b></div>
              {working.map((s) => (
                <div className="hka-line" key={s.id}>
                  <span className="hka-line-name">{s.name}</span>
                  <span className="hka-line-meta">{s.wards.join(", ") || "—"}</span>
                </div>
              ))}
            </div>
          )}

          {finished.length > 0 && (
            <div className="hka-group">
              <div className="hka-group-head">Completed <b>{finished.length}</b></div>
              {finished.map((s) => (
                <div className="hka-line" key={s.id}>
                  <span className="hka-line-name">
                    {s.name}
                    {s.role === "HOUSEKEEPING_MANAGER" && <span className="role-badge">Manager</span>}
                  </span>
                  <div className="hka-bar-wrap">
                    <div className="hka-bar-track"><div className="hka-bar-fill" style={{ width: `${(s.completedInRange / maxCompleted) * 100}%` }} /></div>
                    <span className="hka-bar-num">{s.completedInRange}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {staff.length === 0 && <div className="hka-empty">No active housekeeping accounts.</div>}
        </section>

        {/* Where work is accumulating */}
        <section className="hka-section">
          <h3>Wards</h3>
          <div className="hka-section-note">
            {anyBacklog && worstWard && (worstWard.pending > 0 || worstWard.inProgress > 0 || worstWard.overdue > 0)
              ? <>Most backlog: <b>{worstWard.name}</b></>
              : "All wards clear"}
          </div>

          {wards.length === 0 ? (
            <div className="hka-empty">No wards with active or recent housekeeping work.</div>
          ) : (
            <div className="hka-wardlist">
              {wards.map((w) => {
                const clear = w.pending === 0 && w.inProgress === 0 && w.overdue === 0;
                return (
                  <div className={"hka-wrow" + (clear ? " clear" : "")} key={w.id}>
                    <span className="hka-wrow-name">{w.name}</span>
                    <span className="hka-wrow-detail">
                      {clear ? (
                        "No pending work"
                      ) : (
                        <>
                          {w.pending > 0 && <>{w.pending} pending</>}
                          {w.inProgress > 0 && <>{w.pending > 0 ? " · " : ""}{w.inProgress} in progress</>}
                          {w.overdue > 0 && <>{(w.pending > 0 || w.inProgress > 0) ? " · " : ""}<b className="urgent">{w.overdue} overdue</b></>}
                        </>
                      )}
                      {w.completedInRange > 0 && <span className="hka-wrow-done"> · {w.completedInRange} completed</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
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
