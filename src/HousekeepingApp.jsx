import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PieChart, Pie, Cell } from "recharts";
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
function HousekeepingBoard({ isManager, onDrillChange, pendingWard, onWardOpened }) {
  const [board, setBoard] = useState(null);
  const [err, setErr] = useState("");
  const [busyBed, setBusyBed] = useState(null);
  const [toast, setToast] = useState("");
  const [openWard, setOpenWard] = useState(null);
  const [search, setSearch] = useState("");
  const [wardFilter, setWardFilter] = useState("all");

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2200); }, []);

  // A ward clicked from the Dashboard's Ward backlog table arrives here as
  // pendingWard — a fresh { id, seq } object each time (seq guarantees the
  // effect fires even for the same ward clicked twice in a row, since object
  // identity, not just the id, changes). If the manager isn't personally
  // assigned to that ward, it simply won't be found in their own board data
  // and this quietly does nothing — there's no bed-level view to jump to for
  // a ward outside their assignment.
  //
  // onWardOpened tells the parent to clear pendingWard once it's consumed.
  // Without that, the parent's pendingWard stays set forever after the first
  // ward click, and since this component unmounts/remounts every time the
  // user leaves and returns to this tab (only one of Board/Dashboard is
  // mounted at a time), the very next plain visit to Housekeeping would
  // replay the same stale "jump to that ward" on mount instead of showing
  // the ward grid.
  useEffect(() => {
    if (pendingWard) {
      setOpenWard(pendingWard.id);
      onWardOpened?.();
    }
  }, [pendingWard]);

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

  if (!board && !err) {
    return (
      <div className="hka-spinner-wrap">
        <div className="hka-spinner" />
      </div>
    );
  }

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
            <div className="card-grid hk-ward-grid hka-content-in">
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
  { key: 1,  label: "Today (24h)", short: "Today" },
  { key: 7,  label: "Last 7 Days", short: "7 Days" },
  { key: 30, label: "Last 30 Days", short: "30 Days" },
];

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

function staffStatus(s) {
  if (s.activeNow > 0) return { tone: "clean", label: "Working Now", sortOrder: 1 };
  if (s.completedInRange > 0) return { tone: "v", label: "Completed", sortOrder: 2 };
  return { tone: "o", label: "Available", sortOrder: 3 };
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// A plain vertical mouse wheel does nothing over a horizontally-scrolling
// row unless something remaps it — trackpads and touch already scroll it
// natively, but a normal mouse wheel needs this to reach it at all.
function scrollHorizontally(e) {
  if (e.deltaY === 0) return;
  e.currentTarget.scrollLeft += e.deltaY;
  e.preventDefault();
}

// Rendered with Recharts rather than hand-rolled SVG — real grow-in
// animation, gapped rounded segments instead of one continuous band, and
// anti-aliased arcs a plain stroke-dasharray circle can't match. Segments
// always stay mounted, including ones at 0 (e.g. "Pending" on a day nothing
// is waiting): that's what lets the ring animate smoothly to its new shape
// when the range switches between Today / 7 days / 30 days instead of a
// segment just popping in or vanishing.
function EnhancedDonut({ segments, size = 150, thickness = 16, hoveredKey, onHover, centerTotal, completionPct }) {
  const outerR = size / 2;
  const innerR = outerR - thickness;
  const total = segments.reduce((sum, s) => sum + (s.value || 0), 0);
  const hoveredSeg = segments.find((s) => s.key === hoveredKey);
  const chartData = segments.map((s) => ({ ...s, value: s.value || 0 }));

  return (
    <div className="hka-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="hka-ring-track">
        <circle cx={size / 2} cy={size / 2} r={(outerR + innerR) / 2} fill="none" stroke="var(--panel-2)" strokeWidth={thickness} />
      </svg>
      <PieChart width={size} height={size} className="hka-ring-chart">
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={innerR}
          outerRadius={outerR}
          startAngle={90}
          endAngle={-270}
          paddingAngle={total > 0 ? 3 : 0}
          cornerRadius={8}
          stroke="none"
          isAnimationActive
          animationDuration={700}
          animationEasing="ease-out"
          onMouseEnter={(_entry, index) => onHover?.(chartData[index]?.key)}
          onMouseLeave={() => onHover?.(null)}
        >
          {chartData.map((s) => (
            <Cell
              key={s.key}
              fill={s.color}
              className="hka-ring-cell"
              style={{ opacity: hoveredKey && hoveredKey !== s.key ? 0.4 : 1, cursor: "pointer" }}
            />
          ))}
        </Pie>
      </PieChart>
      <div className="hka-ring-center">
        {hoveredSeg ? (
          <>
            <div className="hka-ring-val" style={{ color: hoveredSeg.color }}>{hoveredSeg.value}</div>
            <div className="hka-ring-label">{hoveredSeg.label}</div>
            <div className="hka-ring-subrate" style={{ color: hoveredSeg.color, background: `color-mix(in srgb, ${hoveredSeg.color} 15%, transparent)` }}>{hoveredSeg.pct}%</div>
          </>
        ) : (
          <>
            <div className="hka-ring-val">{centerTotal}</div>
            <div className="hka-ring-label">Total Workload</div>
            <div className="hka-ring-subrate">{completionPct}% Cleared</div>
          </>
        )}
      </div>
    </div>
  );
}

function ManagerAnalytics({ isManager = true, onOpenWard }) {
  const [range, setRange] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [hoveredSeg, setHoveredSeg] = useState(null);

  const [staffSearch, setStaffSearch] = useState("");
  const [staffFilter, setStaffFilter] = useState("all"); // "all" | "working" | "completed" | "idle"
  const [staffSort, setStaffSort] = useState("completed"); // "completed" | "active" | "name"
  const [wardSearch, setWardSearch] = useState("");
  const [wardFilter, setWardFilter] = useState("all"); // "all" | "overdue" | "active" | "clear"
  const [wardSort, setWardSort] = useState("overdue"); // "overdue" | "pending" | "completed" | "name"

  // The staff panel's height is set directly from the command card's real
  // measured height — not from CSS grid/flex auto-sizing, which cannot be
  // trusted to cap a variable-length list's contribution here (tried twice:
  // it kept leaking the full unclipped row count into the row's intrinsic
  // height before any cap applied, dragging the left card down with it).
  // commandEl is state, not a plain ref, because this component returns
  // early for loading/error before the ref'd element exists — a callback
  // ref re-fires when it actually mounts, where a one-shot effect on a
  // plain ref would miss it.
  const [commandEl, setCommandEl] = useState(null);
  const [matchedHeight, setMatchedHeight] = useState(null);
  useEffect(() => {
    if (!commandEl || typeof ResizeObserver === "undefined") return;
    const apply = () => setMatchedHeight(window.innerWidth > 1080 ? commandEl.getBoundingClientRect().height : null);
    const ro = new ResizeObserver(apply);
    ro.observe(commandEl);
    window.addEventListener("resize", apply);
    apply();
    return () => { ro.disconnect(); window.removeEventListener("resize", apply); };
  }, [commandEl]);

  const loadData = useCallback((showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    return api.hkManagerAnalytics(range)
      .then((d) => {
        setData(d);
        setErr("");
        setLastUpdated(Date.now());
      })
      .catch((e) => {
        setErr(toastErr(e));
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [range]);

  useEffect(() => {
    setLoading(!data);
    // Switching ranges after the first load already has data on screen, so
    // there's nothing to skeleton over — reuse the same "Syncing…" spinner
    // the manual refresh button shows instead of silently swapping numbers.
    loadData(!!data);
  }, [loadData, range]);

  // Real-time live updates via socket
  useEffect(() => {
    const socket = getSocket();
    let timer = null;
    const onBedChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { loadData(false); }, 600);
    };
    socket.on("hk:bed", onBedChange);
    const offReconnect = onReconnect(socket, () => loadData(false));
    return () => {
      socket.off("hk:bed", onBedChange);
      offReconnect();
      clearTimeout(timer);
    };
  }, [loadData]);

  const rangeObj = RANGES.find((r) => r.key === range) || RANGES[0];
  const rangeLabel = rangeObj.short;

  if (err && !data) {
    return (
      <div className="hka-empty-state card" style={{ padding: 40, borderColor: "var(--red)" }}>
        <span style={{ color: "var(--red)" }}><Ic d={icons.alert} s={32} /></span>
        <div className="hka-empty-title" style={{ color: "var(--red)" }}>Unable to load analytics</div>
        <div className="hka-empty-desc">{err}</div>
        <button className="btn btn-primary" onClick={() => loadData(true)} style={{ marginTop: 10 }}>
          <Ic d={icons.refresh} s={14} /> Retry
        </button>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="hka-spinner-wrap">
        <div className="hka-spinner" />
      </div>
    );
  }

  const { summary, staff = [], wards = [] } = data || {
    summary: { pendingNow: 0, inProgressNow: 0, overdueNow: 0, completedInRange: 0 },
    staff: [],
    wards: [],
  };

  const totalWorkload = summary.completedInRange + summary.inProgressNow + summary.pendingNow;
  const completionPct = totalWorkload > 0 ? Math.round((summary.completedInRange / totalWorkload) * 1000) / 10 : 0;
  const inProgressPct = totalWorkload > 0 ? Math.round((summary.inProgressNow / totalWorkload) * 1000) / 10 : 0;
  const pendingPct    = totalWorkload > 0 ? Math.round((summary.pendingNow / totalWorkload) * 1000) / 10 : 0;

  const ringLegend = [
    { key: "done",    label: "Completed",   value: summary.completedInRange, pct: completionPct, color: "var(--st-v)" },
    { key: "doing",   label: "In Progress", value: summary.inProgressNow,    pct: inProgressPct,  color: "var(--st-clean)" },
    { key: "pending", label: "Pending",     value: summary.pendingNow,       pct: pendingPct,     color: "var(--st-o)" },
  ];

  const workingStaff = staff.filter((s) => s.activeNow > 0);
  const completedStaff = staff.filter((s) => s.activeNow === 0 && s.completedInRange > 0);
  const idleStaff = staff.filter((s) => s.activeNow === 0 && s.completedInRange === 0);
  const totalOpenNow = summary.pendingNow + summary.inProgressNow;
  const completionState = summary.overdueNow > 0 ? "Needs attention" : totalOpenNow > 0 ? "In progress" : "All clear";
  const statTiles = [
    { key: "completed", label: "Completed", value: summary.completedInRange, note: rangeLabel, tone: "v" },
    { key: "active", label: "In Progress", value: summary.inProgressNow, note: "Live work", tone: "clean" },
    { key: "pending", label: "Pending", value: summary.pendingNow, note: "Awaiting start", tone: "o" },
    { key: "overdue", label: "Overdue", value: summary.overdueNow, note: "Needs triage", tone: "red" },
  ];

  // Filtered & Sorted Staff
  const staffQuery = staffSearch.trim().toLowerCase();
  const filteredStaff = staff.filter((s) => {
    if (staffQuery) {
      const nameHit = (s.name || "").toLowerCase().includes(staffQuery);
      const wardHit = (s.wards || []).some((w) => w.toLowerCase().includes(staffQuery));
      if (!nameHit && !wardHit) return false;
    }
    if (staffFilter === "working") return s.activeNow > 0;
    if (staffFilter === "completed") return s.completedInRange > 0;
    if (staffFilter === "idle") return s.activeNow === 0 && s.completedInRange === 0;
    return true;
  }).sort((a, b) => {
    if (staffSort === "completed") return (b.completedInRange || 0) - (a.completedInRange || 0);
    if (staffSort === "active") return (b.activeNow || 0) - (a.activeNow || 0);
    if (staffSort === "name") return (a.name || "").localeCompare(b.name || "");
    return 0;
  });

  // Filtered & Sorted Wards
  const urgentWardsCount = wards.filter((w) => w.overdue > 0).length;
  const wardQuery = wardSearch.trim().toLowerCase();
  const filteredWards = wards.filter((w) => {
    if (wardQuery && !(w.name || "").toLowerCase().includes(wardQuery)) return false;
    if (wardFilter === "overdue") return w.overdue > 0;
    if (wardFilter === "active") return (w.pending > 0 || w.inProgress > 0);
    if (wardFilter === "clear") return (w.pending === 0 && w.inProgress === 0 && w.overdue === 0);
    return true;
  }).sort((a, b) => {
    if (wardSort === "overdue") return (b.overdue || 0) - (a.overdue || 0) || (b.pending || 0) - (a.pending || 0);
    if (wardSort === "pending") return (b.pending || 0) - (a.pending || 0);
    if (wardSort === "completed") return (b.completedInRange || 0) - (a.completedInRange || 0);
    if (wardSort === "name") return (a.name || "").localeCompare(b.name || "");
    return 0;
  });
  return (
    <div className="hka slide-up">
      <div className={"hka-shell" + (refreshing ? " is-refreshing" : "")}>
        <div className="hka-toolbar">
          <div className="hka-title-wrap">
            <div className="hka-title-row">
              <span className="hka-title">Housekeeping Analytics</span>
            </div>
          </div>

          <div className="hka-controls">
            <div className="hka-range-pills" role="tablist" aria-label="Time range">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={"hka-range-btn" + (range === r.key ? " active" : "")}
                  onClick={() => setRange(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="hka-refresh-btn"
              onClick={() => loadData(true)}
              disabled={refreshing}
              title={`Last updated at ${fmtTime(lastUpdated)}`}
            >
              <span className={refreshing ? "spin" : ""}>
                <Ic d={icons.refresh} s={13} />
              </span>
              <span>{refreshing ? "Syncing…" : "Refresh"}</span>
            </button>
          </div>
        </div>

        <div className={"hka-top-split" + (isManager ? "" : " hka-top-split-solo")}>
        <div className="hka-command" ref={setCommandEl}>
          <div className="hka-stats-strip" onWheel={scrollHorizontally}>
            {statTiles.map((tile) => (
              <div key={tile.key} className={"hka-stat-tile tone-" + tile.tone}>
                <div className="hka-stat-tile-label">{tile.label}</div>
                <div className="hka-stat-tile-value mono">{tile.value}</div>
                <div className="hka-stat-tile-note">{tile.note}</div>
              </div>
            ))}
          </div>

          <div className={"hka-attention-chip" + (urgentWardsCount > 0 ? " urgent" : "")}>
            <Ic d={icons.alert} s={13} />
            <span className="hka-attention-label">Wards needing attention</span>
            <span className="hka-attention-value mono">{urgentWardsCount}</span>
          </div>

          <div className="hka-command-grid">
            <section className="hka-command-main">
              <div className="hka-command-heading">
                <div>
                  <div className="hka-eyebrow">Team status</div>
                  <div className="hka-command-title">{completionState}</div>
                </div>
                <div className="hka-updated">Updated {fmtTime(lastUpdated)}</div>
              </div>

              <div className="hka-command-body">
                <div className="hka-completion-hero">
                  <EnhancedDonut
                    size={176}
                    thickness={18}
                    segments={ringLegend}
                    hoveredKey={hoveredSeg}
                    onHover={setHoveredSeg}
                    centerTotal={totalWorkload}
                    completionPct={completionPct}
                  />
                  <div className="hka-completion-copy">
                    <div className="hka-hero-metric">
                      <span className="hka-hero-value">{summary.completedInRange}</span>
                      <span className="hka-hero-unit">completed</span>
                    </div>
                    <div className="hka-hero-context">
                      out of <span className="mono">{totalWorkload}</span> total requests in the selected window
                    </div>
                    <div className="hka-hero-ledger" onWheel={scrollHorizontally}>
                      {ringLegend.map((s) => (
                        <button
                          key={s.key}
                          type="button"
                          className={"hka-hero-ledger-row" + (hoveredSeg === s.key ? " active" : "")}
                          onMouseEnter={() => setHoveredSeg(s.key)}
                          onMouseLeave={() => setHoveredSeg(null)}
                        >
                          <span className="hka-hero-ledger-label">
                            <span className="hka-ring-dot" style={{ background: s.color }} />
                            {s.label}
                          </span>
                          <span className="hka-hero-ledger-values">
                            <span className="mono">{s.value}</span>
                            <span>{s.pct}%</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {summary.overdueNow > 0 && (
                <div className="hka-alertline">
                  <span className="hka-alertline-label">Attention</span>
                  <span>{summary.overdueNow} task{summary.overdueNow !== 1 ? "s are" : " is"} past turnaround target and {urgentWardsCount} ward{urgentWardsCount !== 1 ? "s need" : " needs"} supervisor follow-up.</span>
                </div>
              )}
            </section>
          </div>
        </div>

        {isManager && (
        <section className="hka-panel" style={matchedHeight ? { height: matchedHeight, maxHeight: matchedHeight } : undefined}>
            <div className="hka-panel-head">
              <div className="hka-panel-head-title">
                <h3 className="hka-panel-title">Live status and completion, per staff member</h3>
              </div>
              <div className="hka-panel-meta">{filteredStaff.length} shown</div>
            </div>

            <div className="hka-search-sort-row">
              <div className="hka-panel-search-wrap">
                <span className="hka-panel-search-ico"><Ic d={icons.search} s={14} /></span>
                <input
                  className="hka-panel-search-input"
                  value={staffSearch}
                  placeholder="Search by name or ward…"
                  onChange={(e) => setStaffSearch(e.target.value)}
                />
                {staffSearch && (
                  <button className="hka-panel-search-clear" onClick={() => setStaffSearch("")} aria-label="Clear search">
                    <Ic d={icons.x} s={13} />
                  </button>
                )}
              </div>

              <select
                className="hka-sort-select"
                value={staffSort}
                onChange={(e) => setStaffSort(e.target.value)}
                aria-label="Sort staff"
              >
                <option value="completed">Sort: Most completed</option>
                <option value="active">Sort: Active now</option>
                <option value="name">Sort: Name (A-Z)</option>
              </select>
            </div>

            <div className="hka-section-bar">
              <div className="hka-filter-chips" onWheel={scrollHorizontally}>
                {[
                  { key: "all", label: "All staff", count: staff.length },
                  { key: "working", label: "Working now", count: workingStaff.length },
                  { key: "completed", label: "Completed", count: completedStaff.length + workingStaff.filter((s) => s.completedInRange > 0).length },
                  { key: "idle", label: "No activity", count: idleStaff.length },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={"hka-chip-btn" + (staffFilter === f.key ? " active" : "")}
                    onClick={() => setStaffFilter(f.key)}
                  >
                    <span>{f.label}</span>
                    <span className="hka-chip-count">{f.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {filteredStaff.length === 0 ? (
              <div className="hka-empty-state hka-empty-state-fixed">
                <div className="hka-empty-ico"><Ic d={icons.users} s={22} /></div>
                <div className="hka-empty-title">No staff found</div>
                <div className="hka-empty-desc">
                  {staffQuery ? `No staff or wards match "${staffSearch.trim()}".` : "No staff match the selected filter."}
                </div>
              </div>
            ) : (
              <div className="hka-staffledger">
                <div className="hka-ledger-head">
                  <span>Staff member</span>
                  <span>Status</span>
                  <span className="ta-c">Completed</span>
                </div>

                {filteredStaff.map((s) => {
                  const st = staffStatus(s);
                  const isWorking = s.activeNow > 0;
                  return (
                    <div className={"hka-ledger-row" + (isWorking ? " is-working" : "")} key={s.id}>
                      <div className="hka-ledger-person">
                        <span className="hka-avatar" style={{ background: hkaAvatarColor(s.id) }}>
                          {hkaInitials(s.name)}
                        </span>
                        <div className="hka-ledger-person-copy">
                          <span className="hka-ledger-name" title={s.name}>{s.name}</span>
                          <span className="hka-ledger-sub">
                            {s.role === "HOUSEKEEPING_MANAGER" ? "Housekeeping manager" : "Housekeeping staff"}
                          </span>
                        </div>
                      </div>

                      <div className="hka-ledger-status">
                        {s.role === "HOUSEKEEPING_MANAGER" ? (
                          <span className="hka-pill tone-clean">Manager</span>
                        ) : (
                          <span className={"hka-pill tone-" + st.tone}>{st.label}</span>
                        )}
                      </div>

                      <div className="hka-ledger-num ta-c mono">{s.completedInRange || 0}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
        </div>

        <section className="hka-panel">
            <div className="hka-panel-head">
              <div className="hka-panel-head-title">
                <div className="hka-eyebrow">Ward backlog</div>
                <h3 className="hka-panel-title">Backlog by ward and operational state</h3>
              </div>
              <div className={"hka-panel-meta" + (urgentWardsCount > 0 ? " urgent" : "")}>
                {urgentWardsCount > 0
                  ? `${urgentWardsCount} ward${urgentWardsCount !== 1 ? "s" : ""} overdue`
                  : "All wards within target"}
              </div>
            </div>
            <div className="hka-search-sort-row">
              <div className="hka-panel-search-wrap">
                <span className="hka-panel-search-ico"><Ic d={icons.search} s={14} /></span>
                <input
                  className="hka-panel-search-input"
                  value={wardSearch}
                  placeholder="Search by ward name…"
                  onChange={(e) => setWardSearch(e.target.value)}
                />
                {wardSearch && (
                  <button className="hka-panel-search-clear" onClick={() => setWardSearch("")} aria-label="Clear search">
                    <Ic d={icons.x} s={13} />
                  </button>
                )}
              </div>

              <select
                className="hka-sort-select"
                value={wardSort}
                onChange={(e) => setWardSort(e.target.value)}
                aria-label="Sort wards"
              >
                <option value="overdue">Sort: Most overdue</option>
                <option value="pending">Sort: Most pending</option>
                <option value="completed">Sort: Most completed</option>
                <option value="name">Sort: Ward name (A-Z)</option>
              </select>
            </div>

            <div className="hka-section-bar">
              <div className="hka-filter-chips" onWheel={scrollHorizontally}>
                {[
                  { key: "all", label: "All wards", count: wards.length },
                  { key: "overdue", label: "Overdue", count: urgentWardsCount },
                  { key: "active", label: "Active queue", count: wards.filter((w) => w.pending > 0 || w.inProgress > 0).length },
                  { key: "clear", label: "All clear", count: wards.filter((w) => w.pending === 0 && w.inProgress === 0 && w.overdue === 0).length },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={"hka-chip-btn" + (wardFilter === f.key ? " active" : "")}
                    onClick={() => setWardFilter(f.key)}
                  >
                    <span>{f.label}</span>
                    <span className="hka-chip-count">{f.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {filteredWards.length === 0 ? (
              <div className="hka-empty-state">
                <div className="hka-empty-ico"><Ic d={icons.bed} s={22} /></div>
                <div className="hka-empty-title">No wards found</div>
                <div className="hka-empty-desc">
                  {wardQuery ? `No wards match "${wardSearch.trim()}".` : "No wards found for the selected filter."}
                </div>
              </div>
            ) : (
              <div className="hka-wtbl-wrap">
                <div className="hka-wtbl-head">
                  <span>Ward</span>
                  <span>Status</span>
                  <span className="ta-c">Pending</span>
                  <span className="ta-c">In progress</span>
                  <span className="ta-c">Overdue</span>
                  <span className="ta-c">Completed</span>
                </div>

                {filteredWards.map((w) => {
                  const isOverdue = (w.overdue || 0) > 0;

                  return (
                    <div
                      className={"hka-wtbl-row" + (isOverdue ? " urgent" : "")}
                      key={w.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenWard?.(w.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenWard?.(w.id); } }}
                      title={`Open ${w.name}`}
                    >
                      <div className="hka-wtbl-name-col">
                        <span className="hka-wtbl-name">{w.name}</span>
                      </div>

                      <div className="hka-wtbl-state-col">
                        <span className={`hka-wtbl-status-tag ${isOverdue ? "urgent" : (w.inProgress > 0 || w.pending > 0) ? "active" : "clear"}`}>
                          {isOverdue ? "Overdue" : (w.inProgress > 0 || w.pending > 0) ? "Active" : "Clear"}
                        </span>
                      </div>

                      <div className="hka-cell-num ta-c">
                        <span className="hka-cell-mlabel">Pending</span>
                        <span className={"hka-cell-badge " + (w.pending > 0 ? "pending" : "zero")}>{w.pending || 0}</span>
                      </div>
                      <div className="hka-cell-num ta-c">
                        <span className="hka-cell-mlabel">In Progress</span>
                        <span className={"hka-cell-badge " + (w.inProgress > 0 ? "clean" : "zero")}>{w.inProgress || 0}</span>
                      </div>
                      <div className="hka-cell-num ta-c">
                        <span className="hka-cell-mlabel">Overdue</span>
                        <span className={"hka-cell-badge " + (isOverdue ? "urgent" : "zero")}>{w.overdue || 0}</span>
                      </div>
                      <div className="hka-cell-num ta-c">
                        <span className="hka-cell-mlabel">Completed</span>
                        <span className={"hka-cell-badge " + (w.completedInRange > 0 ? "done" : "zero")}>{w.completedInRange || 0}</span>
                      </div>
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
  // Managers land on the Dashboard first — it's the oversight view and the
  // first item in their nav. Staff still land on Board, their working view,
  // but now also get a Dashboard tab scoped to just their own wards (see
  // ManagerAnalytics's isManager prop — it drops the staff ledger and the
  // backend itself scopes the data, this isn't just a hidden UI panel).
  const [navTab, setNavTab] = useState(isManager ? "analytics" : "board");
  const [drilled, setDrilled] = useState(false);
  const [pendingWard, setPendingWard] = useState(null);

  const openWardFromDashboard = (wardId) => {
    setPendingWard({ id: wardId, seq: Date.now() });
    setNavTab("board");
  };
  // One-shot: HousekeepingBoard calls this the moment it consumes
  // pendingWard, so a later plain visit to the tab (no ward click involved)
  // doesn't replay it — see the comment on that effect.
  const clearPendingWard = useCallback(() => setPendingWard(null), []);

  const menu = isManager
    ? [
        { key: "analytics", icon: icons.chart, label: "Dashboard" },
        { key: "board", icon: icons.bed, label: "Housekeeping" },
      ]
    : [
        { key: "analytics", icon: icons.chart, label: "Dashboard" },
        { key: "board", icon: icons.bed, label: "Housekeeping" },
      ];

  return (
    <AppShell
      menu={menu}
      active={navTab}
      onSelect={setNavTab}
      title={navTab === "analytics" ? "Dashboard" : "Housekeeping"}
      user={{ name: user.name || user.username || "Housekeeping",
              role: isManager ? "HK MANAGER" : "HOUSEKEEPING" }}
      onLogout={onLogout}
      hideAppbar={navTab === "board" && drilled}
    >
      {navTab === "analytics"
        ? <ManagerAnalytics isManager={isManager} onOpenWard={openWardFromDashboard} />
        : <HousekeepingBoard isManager={isManager} onDrillChange={setDrilled} pendingWard={pendingWard} onWardOpened={clearPendingWard} />}
    </AppShell>
  );
}
