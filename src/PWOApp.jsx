import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { api, toastErr, getSocket, onReconnect, fmtDateTime } from "./lib.js";
import { RelativeTime } from "./relativeClock.jsx";
import { Ic, icons, ThemeToggle, useConfirm, useModal, useScrollRestore } from "./ui.jsx";
import { AppShell, useProfileMenuSlot } from "./shell.jsx";

/* ═══════════════════════════════════════════════════════════════════════════
   Patient Welfare Officer portal.

   Real-time contract (the important part):
     REST is used for the initial load, pagination and history — nothing else.
     Every live change arrives as a targeted socket payload carrying only what
     changed, and is applied in memory:
       • one row in the queue is patched (or inserted/removed),
       • the dashboard counters are incremented/decremented from
         {fromStatus → status},
       • the chart datasets are bumped in place.
     No socket handler in this file calls an API. If you ever find yourself
     adding `load()` to one, the payload is missing a field instead.
   ═══════════════════════════════════════════════════════════════════════════ */

const STATUS_META = {
  OPEN:         { label: "Open",         color: "#dc2626", key: "open" },
  ACCEPTED:     { label: "Accepted",     color: "#2563eb", key: "accepted" },
  UNDER_REVIEW: { label: "Under Review", color: "#d97706", key: "underReview" },
  RESOLVED:     { label: "Resolved",     color: "#16a34a", key: null },
  CLOSED:       { label: "Closed",       color: "#6b7280", key: null },
};
/** Statuses that still need work — mirrors PENDING_STATUSES in complaintService. */
const PENDING = new Set(["OPEN", "ACCEPTED", "UNDER_REVIEW"]);
const PRIORITY_COLOR = { LOW: "#6b7280", MEDIUM: "#2563eb", HIGH: "#d97706", CRITICAL: "#dc2626" };
/** The one legal next step per status — kept in sync with NEXT_STATUS on the
 *  server, which is the actual enforcer; this only decides what button to show. */
const NEXT_STATUS = { ACCEPTED: "UNDER_REVIEW", UNDER_REVIEW: "RESOLVED", RESOLVED: "CLOSED" };

/** Group filter, not a stored status — matches PENDING above and the server's
 *  PENDING_STATUSES. The queue defaults to it because officers work the live
 *  pile; closed and resolved complaints are history and were burying real work
 *  at the top of the list. Cleared to "" (All) to see everything again. */
const ACTIVE_ONLY = "ACTIVE";
/** True when a row belongs in the list under the current status filter.
 *  Needed because ACTIVE_ONLY covers three statuses — a plain `f.status !== s`
 *  comparison would drop every row the moment its status changed. */
const matchesStatus = (filterVal, status) =>
  !filterVal || (filterVal === ACTIVE_ONLY ? PENDING.has(status) : filterVal === status);

export const DEFAULT_FILTERS = {
  status: ACTIVE_ONLY, categoryId: "", priorityId: "", wardId: "", floorId: "",
  departmentId: "", ownerPwoId: "", search: "", from: "", to: "",
  sort: "newest", page: 1,
};

/* Three icons the shared set doesn't have. Kept local rather than added to
   ui.jsx because nothing outside this module needs a fork or a mop bucket. */
const I_FOOD = <><path d="M6 3v6a2 2 0 0 0 4 0V3" /><path d="M8 9v12" /><path d="M17 3c-1.4 1.9-2 4-2 6 0 1.5.7 2.5 2 2.5s2-1 2-2.5c0-2-.6-4.1-2-6Z" /><path d="M17 11.5V21" /></>;
const I_BUCKET = <><path d="M5 8h14l-1.5 12h-11L5 8Z" /><path d="M9 8V5a3 3 0 0 1 6 0v3" /></>;
const I_DROPLET = <><path d="M12 3.5c3.5 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2.5-6 6-10Z" /></>;

/** One colour + glyph per complaint category, keyed by the DB `code` so a
 *  renamed label never breaks the mapping. Unknown codes fall back to grey. */
const CATEGORY_STYLE = {
  NURSING:         { icon: icons.users,       color: "#7c3aed" },
  FOOD:            { icon: I_FOOD,            color: "#2563eb" },
  HOUSEKEEPING:    { icon: I_BUCKET,          color: "#16a34a" },
  BILLING:         { icon: icons.banknote,    color: "#dc2626" },
  PHARMACY:        { icon: icons.pill,        color: "#0891b2" },
  MAINTENANCE:     { icon: icons.settings,    color: "#d97706" },
  DOCTOR:          { icon: icons.stethoscope, color: "#0d9488" },
  STAFF_BEHAVIOUR: { icon: icons.user,        color: "#db2777" },
  WASHROOM:        { icon: I_DROPLET,         color: "#0ea5e9" },
  OTHER:           { icon: icons.info,        color: "#6b7280" },
};
const catStyle = (code) => CATEGORY_STYLE[code] || { icon: icons.info, color: "#6b7280" };

const fmtDuration = (ms) => {
  if (ms == null) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

// ── Counter math ───────────────────────────────────────────────────────────
/** Apply one status transition to the dashboard counters, with no refetch.
 *  `priorityCode` is needed because the High/Critical cards count *outstanding*
 *  complaints only — resolving a critical one must decrement that card. */
function applyStatusDelta(s, from, to, priorityCode) {
  if (!s) return s;
  const n = { ...s };
  const fk = STATUS_META[from]?.key;
  const tk = STATUS_META[to]?.key;
  if (fk) n[fk] = Math.max(0, (n[fk] || 0) - 1);
  if (tk) n[tk] = (n[tk] || 0) + 1;

  const wasPending = PENDING.has(from);
  const isPending = PENDING.has(to);
  if (wasPending && !isPending) {
    n.pending = Math.max(0, (n.pending || 0) - 1);
    if (priorityCode === "HIGH")     n.highPriority = Math.max(0, (n.highPriority || 0) - 1);
    if (priorityCode === "CRITICAL") n.critical     = Math.max(0, (n.critical || 0) - 1);
  }
  if (to === "RESOLVED") n.resolvedToday = (n.resolvedToday || 0) + 1;
  if (to === "CLOSED")   n.closedToday   = (n.closedToday || 0) + 1;
  return n;
}

/** +1 (or −1) a single bucket of a {key,n}[] chart series, in place. */
function bumpSeries(series, key, delta = 1) {
  if (!series || key == null) return series;
  const i = series.findIndex((d) => String(d.key) === String(key));
  if (i === -1) return delta > 0 ? [...series, { key, n: delta }] : series;
  const next = series.slice();
  next[i] = { ...next[i], n: Math.max(0, next[i].n + delta) };
  return next;
}

// Phones hide the appbar's ThemeToggle (styles.css: `.preui .appbar > .btn.btn-ghost`
// inside the phone media query), and the Profile page that used to carry one is
// gone — so the control moves into the profile dropdown, the same way
// ProfileThemeRow does it for Nurse/Doctor/PRE.
function PwoThemeRow() {
  const slot = useProfileMenuSlot();
  if (!slot) return null;
  return createPortal(
    <div className="row between" style={{ padding: "10px 14px" }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Theme</span>
      <ThemeToggle />
    </div>,
    slot
  );
}

// ── Small presentational pieces ────────────────────────────────────────────
function StatCard({ label, value, color, icon, sub }) {
  return (
    <div className="card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10, flexShrink: 0,
        background: `${color}1a`, color,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Ic d={icon} s={18} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 20, lineHeight: 1.1 }}>{value}</div>
        <div className="dim" style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
        {sub && <div className="dim" style={{ fontSize: 10 }}>{sub}</div>}
      </div>
    </div>
  );
}

function BarChart({ title, data, color = "#2563eb", formatKey }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{title}</div>
      {data.length === 0 ? (
        <div className="dim" style={{ fontSize: 12 }}>No data yet.</div>
      ) : data.slice(0, 8).map((d) => (
        <div key={d.key} style={{ marginBottom: 8 }}>
          <div className="row between" style={{ fontSize: 11, marginBottom: 3 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "75%" }}>
              {formatKey ? formatKey(d.key) : d.key}
            </span>
            <span style={{ fontWeight: 700 }}>{d.n}</span>
          </div>
          <div style={{ height: 6, borderRadius: 4, background: "var(--panel-2)", overflow: "hidden" }}>
            <div style={{ width: `${(d.n / max) * 100}%`, height: "100%", background: color, borderRadius: 4, transition: "width .3s" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LineChart({ title, data, color = "#16a34a", valueKey = "n", suffix = "" }) {
  const pts = data.slice(-30);
  const max = Math.max(1, ...pts.map((d) => d[valueKey] ?? 0));
  const w = 100, h = 34;
  const path = pts.length < 2 ? "" : pts.map((d, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((d[valueKey] ?? 0) / max) * (h - 4) - 2;
    return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const last = pts[pts.length - 1];
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
        {last && <span className="chip" style={{ color }}>{last[valueKey]}{suffix}</span>}
      </div>
      {pts.length < 2 ? (
        <div className="dim" style={{ fontSize: 12 }}>Not enough data yet.</div>
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 44, display: "block" }}>
          <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const m = STATUS_META[status] || { label: status, color: "#6b7280" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
      fontSize: 10.5, fontWeight: 800, padding: "3px 9px", borderRadius: 99,
      background: `${m.color}1a`, color: m.color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: m.color }} />
      {m.label}
    </span>
  );
}

function PriorityPill({ code, label }) {
  const c = PRIORITY_COLOR[code] || "#6b7280";
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 5,
      background: `${c}1a`, color: c, whiteSpace: "nowrap",
    }}>{label || code}</span>
  );
}

// ── Complaint detail ───────────────────────────────────────────────────────
/** The five lifecycle stages, in order — drives both the stepper and the
 *  timeline so they can never disagree about what comes next. */
const STAGES = ["OPEN", "ACCEPTED", "UNDER_REVIEW", "RESOLVED", "CLOSED"];

function ComplaintDetail({ id, meId, onBack, onPatched, showToast }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [shareNote, setShareNote] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    try { setC((await api.pwoComplaint(id)).complaint); }
    catch (e) { setErr(toastErr(e)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // The queue owns the socket; it forwards events for this complaint down here
  // so the panel stays live without a second subscription or a refetch.
  useEffect(() => {
    onPatched.current = (evt, payload) => {
      if (Number(payload.complaintId) !== Number(id)) return;
      if (evt === "complaint:note_added") {
        setC((p) => (p ? { ...p, notes: [...p.notes, payload.note] } : p));
      } else {
        setC((p) => (p ? { ...p, status: payload.status ?? p.status, ownerName: payload.ownerName ?? p.ownerName } : p));
      }
    };
    return () => { onPatched.current = null; };
  }, [id, onPatched]);

  if (err) return (
    <div className="card empty" style={{ padding: 24 }}>
      <Ic d={icons.alert} s={26} /><div style={{ marginTop: 8 }}>{err}</div>
      <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={onBack}>Back</button>
    </div>
  );
  if (!c) return <div className="empty" style={{ paddingTop: 60 }}><span className="spin"><Ic d={icons.refresh} s={24} /></span></div>;

  const cs = catStyle(c.category.code);
  const isMine = c.ownerPwoId === meId;
  const stageIdx = STAGES.indexOf(c.status);
  const next = NEXT_STATUS[c.status];
  // When a stage was reached, keyed by status — drives the timeline stamps.
  const reachedAt = Object.fromEntries(c.timeline.map((t) => [t.to, t]));

  const act = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); showToast(okMsg); await load(); }
    catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  const advance = async (to) => {
    if (to === "CLOSED") {
      const ok = await confirm({
        title: "Close this complaint?",
        message: "Closed complaints are final — they cannot be reopened.",
        confirmLabel: "Close complaint", danger: true,
      });
      if (!ok) return;
    }
    act(() => api.pwoSetStatus(c.id, to), `Moved to ${STATUS_META[to].label}`);
  };

  const submitNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.pwoAddNote(c.id, note.trim(), shareNote);
      setNote(""); setShareNote(false);
      showToast(shareNote ? "Note added and shared with patient" : "Internal note added");
      await load();
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusy(false); }
  };

  // Every action is always visible so the workflow is legible at a glance, but
  // only the one legal next step is enabled — the server enforces the same
  // order, so an enabled-looking shortcut would just 409.
  const ACTIONS = [
    { to: "ACCEPTED",     label: "Accept Complaint",  icon: icons.check,  enabled: c.status === "OPEN" },
    { to: "UNDER_REVIEW", label: "Mark Under Review", icon: icons.clock,  enabled: isMine && c.status === "ACCEPTED" },
    { to: "RESOLVED",     label: "Mark Resolved",     icon: icons.check,  enabled: isMine && c.status === "UNDER_REVIEW" },
    { to: "CLOSED",       label: "Close Complaint",   icon: icons.ban,    enabled: isMine && c.status === "RESOLVED", danger: true },
  ];

  // Strictly the complaint's frozen snapshot — where the patient was standing
  // when they raised it. Department and Admitted used to sit here too, and both
  // were re-printed verbatim by the Patient & Admission card below: admitted_at
  // is immutable, so the snapshot copy and the live value can never disagree,
  // and department almost never changes mid-stay. IP was the worst of the
  // three — both cards rendered the very same `c.ipLast6`. Those three now
  // live once each, in the card they belong to.
  const META = [
    { label: "Patient (IP)", value: c.ipLast6,            icon: icons.user },
    { label: "Ward",         value: c.location.wardName,  icon: icons.building },
    { label: "Bed",          value: c.location.bedName,   icon: icons.bed },
    { label: "Floor",        value: c.location.floorName, icon: icons.layers },
    { label: "Room Type",    value: c.location.roomType,  icon: icons.grid },
  ];

  // The one overlap worth keeping: the snapshot ward/bed above vs where the
  // patient is right now. Identical for most complaints (which is why it read
  // as a third copy), so it's only worth calling out when they diverge.
  const snapshotLoc = [c.location.wardName, c.location.bedName].filter(Boolean).join(" · ");
  const liveLoc = [c.admission?.currentWard, c.admission?.currentBed && `Bed ${c.admission.currentBed}`]
    .filter(Boolean).join(" · ");
  const movedSince = c.admission?.status === "ACTIVE" && snapshotLoc && liveLoc
    && snapshotLoc.replace(/Bed /g, "") !== liveLoc.replace(/Bed /g, "");

  return (
    <div className="slide-up">
      <button className="cd-back" onClick={onBack}>
        <Ic d={icons.chevron} s={15} style={{ transform: "rotate(180deg)" }} /> Back to queue
      </button>

      <div className="cd-grid">
        {/* ── Main column ─────────────────────────────────────────────── */}
        <div>
          <div className="card cd-head">
            <div className="cd-head-top">
              <div className="cd-head-ids">
                <span className="cd-code">{c.complaintCode}</span>
                <StatusPill status={c.status} />
                <PriorityPill code={c.priority.code} label={c.priority.label} />
                <span className="cd-cat" style={{ background: `${cs.color}18`, color: cs.color }}>
                  <Ic d={cs.icon} s={13} /> {c.category.label}
                </span>
              </div>
              <div className="cd-submitted">
                <Ic d={icons.clock} s={14} />
                <span>
                  <span className="cd-submitted-at">{fmtDateTime(c.createdAt)}</span>
                  <span className="cd-submitted-by">Submitted by patient</span>
                </span>
              </div>
            </div>

            {/* The patient's own words. Immutable — no edit path exists. */}
            <div className="cd-quote">{c.description}</div>

            <div className="cd-meta">
              {META.map((m) => (
                <div className="cd-meta-item" key={m.label}>
                  <Ic d={m.icon} s={15} />
                  <div style={{ minWidth: 0 }}>
                    <div className="cd-meta-label">{m.label}</div>
                    <div className="cd-meta-value">{m.value || "—"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Ownership banner */}
          {c.status === "OPEN" ? (
            <div className="card cd-banner">
              <span className="cd-banner-ic" style={{ background: "var(--primary-bg,#EFF6FF)", color: "var(--primary)" }}>
                <Ic d={icons.shield} s={19} />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="cd-banner-title">This complaint is unassigned. Accept to start working on it.</div>
                <div className="cd-banner-sub">Once accepted, only you will be able to update and resolve this complaint.</div>
              </div>
              <button className="cd-btn cd-btn-primary" disabled={busy} onClick={() => act(() => api.pwoAccept(c.id), "Accepted — it's yours now")}>
                <Ic d={icons.check} s={15} /> Accept Complaint
              </button>
            </div>
          ) : !isMine ? (
            <div className="card cd-banner">
              <span className="cd-banner-ic" style={{ background: "var(--panel-2)", color: "var(--ink-3)" }}>
                <Ic d={icons.info} s={19} />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="cd-banner-title">Assigned to {c.ownerName}</div>
                <div className="cd-banner-sub">You can follow this complaint, but only {c.ownerName} can update it.</div>
              </div>
            </div>
          ) : null}

          {/* Notes */}
          <div className="card cd-section">
            <div className="cd-section-head"><Ic d={icons.fileText} s={15} /> Notes</div>

            {isMine && c.status !== "CLOSED" && (
              <div className="cd-noteform">
                <textarea className="cd-textarea" rows={3} value={note} maxLength={4000}
                  placeholder="Add a note…" onChange={(e) => setNote(e.target.value)} />
                <div className="cd-noteform-foot">
                  {/* Off by default: the patient portal is unauthenticated, so
                      sharing is always a deliberate act, never the fallback. */}
                  <label className="cd-share">
                    <input type="checkbox" checked={shareNote} onChange={(e) => setShareNote(e.target.checked)} />
                    Share this note with the patient
                  </label>
                  <button className="cd-btn cd-btn-primary" disabled={busy || !note.trim()} onClick={submitNote}>
                    <Ic d={icons.share} s={14} /> Add Note
                  </button>
                </div>
              </div>
            )}

            {c.notes.length === 0 ? (
              <div className="cd-empty">
                <Ic d={icons.fileText} s={30} />
                <div className="cd-empty-title">No notes added yet.</div>
                <div className="cd-empty-sub">Add a note to record actions or updates.</div>
              </div>
            ) : c.notes.map((n) => (
              <div className="cd-note" key={n.id} style={{ borderLeftColor: n.visibleToPatient ? "var(--st-v)" : "var(--line)" }}>
                <div className="cd-note-head">
                  <span style={{ fontWeight: 700, fontSize: 12 }}>{n.authorName || "—"}</span>
                  <span className="dim" style={{ fontSize: 10.5 }}><RelativeTime ts={n.createdAt} /></span>
                  <span className="cd-note-tag" style={{
                    background: n.visibleToPatient ? "var(--st-v-bg)" : "var(--panel-2)",
                    color: n.visibleToPatient ? "var(--st-v)" : "var(--ink-3)",
                  }}>{n.visibleToPatient ? "SHARED WITH PATIENT" : "INTERNAL"}</span>
                </div>
                <div className="cd-note-body">{n.note}</div>
              </div>
            ))}
          </div>

          {/* Patient / admission context.
              NOTE: BedFlow stores no patient name, age, gender, mobile or UHID
              anywhere — only the 6-digit IP number. Rather than show blank or
              invented fields, this card carries the admission facts that do
              exist and that an officer actually needs while working a case. */}
          {c.admission && (
            <div className="card cd-section">
              <div className="cd-section-head"><Ic d={icons.user} s={15} /> Patient &amp; Admission</div>
              <div className="cd-pinfo">
                {/* IP Number is deliberately absent — it's already the first
                    field of the meta strip above, and both read the same
                    `c.ipLast6`. */}
                {[
                  ["Admission Type", c.admission.admissionType],
                  ["Consultant", c.admission.consultantName],
                  ["Department", c.admission.departmentName],
                  ["Admitted On", c.admission.admittedAt ? fmtDateTime(c.admission.admittedAt) : null],
                  ["Currently In", c.admission.status === "ACTIVE" ? liveLoc : "Discharged", movedSince],
                ].map(([k, v, flag]) => (
                  <div key={k}>
                    <div className="cd-pinfo-label">{k}</div>
                    <div className="cd-pinfo-value">
                      {v || "—"}
                      {flag && <span className="cd-moved">moved since raised</span>}
                    </div>
                  </div>
                ))}
              </div>
              {c.admission.status !== "ACTIVE" && (
                <div className="cd-discharged">
                  <Ic d={icons.info} s={13} /> This patient has been discharged. The complaint stays open for follow-up.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <div className="cd-side">
          <div className="card cd-section">
            <div className="cd-section-head"><Ic d={icons.clock} s={15} /> Status &amp; Actions</div>

            <div className="cd-stepper">
              {STAGES.map((s, i) => (
                <div className="cd-step" key={s}>
                  <div className="cd-step-line" style={{ visibility: i === 0 ? "hidden" : "visible",
                    background: i <= stageIdx ? STATUS_META[c.status].color : "var(--line)" }} />
                  <span className={"cd-step-dot" + (i === stageIdx ? " on" : "") + (i < stageIdx ? " done" : "")}
                    style={i <= stageIdx ? { borderColor: STATUS_META[c.status].color, background: i < stageIdx ? STATUS_META[c.status].color : "transparent" } : undefined} />
                  <div className={"cd-step-label" + (i === stageIdx ? " on" : "")}
                    style={i === stageIdx ? { color: STATUS_META[c.status].color } : undefined}>
                    {STATUS_META[s].label}
                  </div>
                  {i === stageIdx && <div className="cd-step-current">Current</div>}
                </div>
              ))}
            </div>

            <div className="cd-actions">
              {ACTIONS.map((a) => (
                <button key={a.to} disabled={busy || !a.enabled}
                  className={"cd-action" + (a.enabled && a.to === (c.status === "OPEN" ? "ACCEPTED" : next) ? " primary" : "") + (a.danger ? " danger" : "")}
                  onClick={() => (a.to === "ACCEPTED" ? act(() => api.pwoAccept(c.id), "Accepted — it's yours now") : advance(a.to))}>
                  <Ic d={a.icon} s={15} /> {a.label}
                </button>
              ))}
            </div>

            {isMine && c.status !== "CLOSED" && (
              <div className="cd-prio">
                <span className="cd-pinfo-label">Priority</span>
                <select className="field" value={c.priority.code} disabled={busy}
                  onChange={(e) => act(() => api.pwoSetPriority(c.id, e.target.value), "Priority updated")}
                  style={{ width: "auto", height: 32, fontSize: 12, paddingTop: 0, paddingBottom: 0, paddingLeft: 9, paddingRight: 9 }}>
                  {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => (
                    <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="card cd-section">
            <div className="cd-section-head"><Ic d={icons.layers} s={15} /> Timeline</div>
            {/* All five stages always render — reached ones carry their real
                stamp, the rest stay greyed so the remaining path is visible. */}
            {STAGES.map((s, i) => {
              const hit = reachedAt[s];
              return (
                <div className={"cd-tl" + (hit ? "" : " future")} key={s}>
                  <span className="cd-tl-dot" style={hit ? { background: STATUS_META[s].color } : undefined} />
                  {i < STAGES.length - 1 && <span className="cd-tl-line" />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="cd-tl-head">
                      <span className="cd-tl-title">{STATUS_META[s].label}</span>
                      {i === stageIdx && <span className="cd-tl-current">Current</span>}
                    </div>
                    <div className="cd-tl-sub">
                      {hit ? fmtDateTime(hit.at) : "—"}
                      {hit?.by ? ` · ${hit.by}` : (hit && s === "OPEN" ? " · Submitted by patient" : "")}
                    </div>
                    {hit?.note && <div className="cd-tl-note">{hit.note}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {confirmDialog}
    </div>
  );
}

// ── Complaints queue ───────────────────────────────────────────────────────
/** Windowed pager: 1 … 4 5 [6] 7 8 … 20 — keeps the control a fixed width
 *  however many pages there are. */
function pageWindow(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out = [1];
  const lo = Math.max(2, page - 1), hi = Math.min(pages - 1, page + 1);
  if (lo > 2) out.push("…");
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < pages - 1) out.push("…");
  out.push(pages);
  return out;
}

const toEpoch = (d, endOfDay = false) =>
  d ? new Date(`${d}T${endOfDay ? "23:59:59.999" : "00:00:00"}+05:30`).getTime() : "";

/* Every complaint filter in one place — what the toolbar's "Filters" button
   opens. The chip strip stays for quick single changes; this is for seeing and
   setting everything at once, and it's the only view that surfaces the date
   range alongside the rest instead of behind its own toggle.

   Changes apply live (onFilter fires per change and the list re-queries behind
   the sheet), so the footer button only dismisses — hence "Done", not "Apply".

   The caller renders this through a portal deliberately: ComplaintsQueue sits
   inside <div className="slide-up">, whose animation keeps a transform applied
   via fill-mode:both, and a transformed ancestor becomes the containing block
   for position:fixed — so an inline .overlay would size itself to the page
   block instead of the viewport (the bug fixed in ConsultantApp). */
function FilterSheet({ chips, filters, onFilter, fromDate, toDate, applyDates, activeCount, onReset, onClose }) {
  useModal(onClose);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Filter complaints"
        style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ padding: "16px 20px 20px" }}>
          <div className="row between" style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 17 }}>
              Filters{activeCount > 0 && <span className="cq-badge" style={{ marginLeft: 8 }}>{activeCount}</span>}
            </div>
            {activeCount > 0 && (
              <button className="cq-reset" style={{ padding: 0, height: "auto" }} onClick={onReset}>Reset all</button>
            )}
          </div>

          <div className="cq-fs-grid">
            {chips.map(([key, label, opts, allLabel]) => (
              <label className="cq-fs-field" key={key}>
                <span>{label}</span>
                <select className="field" value={filters[key]} onChange={(e) => onFilter(key, e.target.value)}>
                  <option value="">{allLabel || "All"}</option>
                  {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            ))}
            <label className="cq-fs-field">
              <span>Sort</span>
              <select className="field" value={filters.sort} onChange={(e) => onFilter("sort", e.target.value)}>
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="priority">Priority</option>
                <option value="updated">Recently Updated</option>
              </select>
            </label>
            <label className="cq-fs-field">
              <span>From</span>
              <input className="field" type="date" value={fromDate}
                onChange={(e) => applyDates(e.target.value, toDate)} />
            </label>
            <label className="cq-fs-field">
              <span>To</span>
              <input className="field" type="date" value={toDate}
                onChange={(e) => applyDates(fromDate, e.target.value)} />
            </label>
          </div>

          <button className="btn btn-primary" style={{ width: "100%", marginTop: 18 }} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function ComplaintsQueue({ stats, rows, total, loading, lookups, filters, onFilter, onPage, onReset, onOpen }) {
  const [showDates, setShowDates] = useState(false);
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // "Filters (N)" counts only the dropdown/date narrowing — not the search box,
  // which has its own visible input, and not sort, which isn't a filter.
  // The default ACTIVE status filter doesn't count — otherwise a freshly
  // loaded queue would claim "Filters (1)" with nothing narrowed by hand. The
  // chip itself still reads "Status: Active — needs work" and stays
  // highlighted, so the hiding of closed complaints is never invisible.
  const activeCount = ["status", "categoryId", "priorityId", "wardId", "floorId", "departmentId", "ownerPwoId"]
    .filter((k) => filters[k] && !(k === "status" && filters[k] === DEFAULT_FILTERS.status)).length
    + (filters.from || filters.to ? 1 : 0);

  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (filters.page - 1) * pageSize + 1;
  const lastRow = Math.min(filters.page * pageSize, total);

  const applyDates = (f, t) => {
    setFromDate(f); setToDate(t);
    onFilter("from", toEpoch(f));
    onFilter("to", toEpoch(t, true));
  };

  const CHIPS = [
    // 4th slot overrides the generic "<label>: All" empty option — for status,
    // "All" now means "including the closed ones", which is worth spelling out
    // when the default deliberately hides them.
    ["status", "Status",
      [[ACTIVE_ONLY, "Active — needs work"], ...Object.entries(STATUS_META).map(([k, v]) => [k, v.label])],
      "All (incl. closed)"],
    ["categoryId", "Category", (lookups?.categories || []).map((c) => [c.id, c.label])],
    ["priorityId", "Priority", (lookups?.priorities || []).map((p) => [p.id, p.label])],
    ["wardId", "Ward", (lookups?.wards || []).map((w) => [w.id, w.name])],
    ["floorId", "Floor", (lookups?.floors || []).map((f) => [f.id, f.name])],
    ["departmentId", "Department", (lookups?.departments || []).map((d) => [d.id, d.name])],
    ["ownerPwoId", "Officer", (lookups?.pwos || []).map((p) => [p.id, p.name])],
  ];

  // `filter` makes a card a one-tap shortcut into the queue below. The two
  // "Today" cards scope the date range as well, so the list that opens matches
  // the number on the card instead of showing every complaint ever closed.
  const CARDS = stats ? [
    { label: "Open", value: stats.open, sub: "Needs attention", color: "#2563eb", icon: icons.fileText, filter: { status: "OPEN" } },
    { label: "Accepted", value: stats.accepted, sub: "In progress", color: "#d97706", icon: icons.user, filter: { status: "ACCEPTED" } },
    { label: "Under Review", value: stats.underReview, sub: "Being reviewed", color: "#7c3aed", icon: icons.clock, filter: { status: "UNDER_REVIEW" } },
    { label: "Resolved Today", value: stats.resolvedToday, sub: "Completed", color: "#16a34a", icon: icons.check, filter: { status: "RESOLVED", today: true } },
    { label: "Closed Today", value: stats.closedToday, sub: "Total closed", color: "#dc2626", icon: icons.ban, filter: { status: "CLOSED", today: true } },
    { label: "Avg. Resolution", value: fmtDuration(stats.avgResolutionMs), sub: "All time", color: "#0891b2", icon: icons.clock },
  ] : [];

  const applyCardFilter = (f) => {
    if (!f) return;
    onFilter("status", f.status);
    if (f.today) {
      // Via applyDates so the visible From/To inputs stay in step with the
      // filter, and so the IST day boundaries come from toEpoch rather than
      // being recomputed here.
      const d = new Date();
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      applyDates(iso, iso);
    }
  };

  const renderRowMeta = (r) => (
    <>IP {r.ipLast6}{r.location.roomType ? ` · ${r.location.roomType}` : ""}</>
  );

  return (
    <div className="slide-up">
      {/* Stat cards — same live-patched `stats` object the dashboard uses, so
          these move the instant a complaint changes, with no extra request. */}
      {stats && (
        <div className="cq-stats">
          {CARDS.map((c) => (
            <div className={"card cq-stat" + (c.filter ? " cq-stat-click" : "")} key={c.label}
              role={c.filter ? "button" : undefined} tabIndex={c.filter ? 0 : undefined}
              aria-label={c.filter ? `${c.label} — ${c.value}. Show these in the queue.` : undefined}
              aria-pressed={c.filter ? filters.status === c.filter.status : undefined}
              onClick={c.filter ? () => applyCardFilter(c.filter) : undefined}
              onKeyDown={c.filter ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); applyCardFilter(c.filter); } } : undefined}>
              <div className="cq-stat-ic" style={{ background: `${c.color}18`, color: c.color }}>
                <Ic d={c.icon} s={19} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="cq-stat-label">{c.label}</div>
                <div className="cq-stat-val">{c.value}</div>
                <div className="cq-stat-sub">{c.sub}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="card cq-toolbar">
        <div className="cq-searchrow">
          <div className="cq-search">
            <Ic d={icons.search} s={15} />
            <input defaultValue={filters.search}
              placeholder="Search by complaint code, IP number or text…"
              onKeyDown={(e) => { if (e.key === "Enter") onFilter("search", e.target.value); }}
              onBlur={(e) => { if (e.target.value !== filters.search) onFilter("search", e.target.value); }} />
          </div>
          <button className="cq-tbtn" onClick={() => setShowDates((v) => !v)}>
            <Ic d={icons.clock} s={14} /> {filters.from || filters.to ? "Date range set" : "Select date range"}
          </button>
          <button className="cq-tbtn" onClick={() => setShowFilterSheet(true)}
            aria-haspopup="dialog" aria-expanded={showFilterSheet}>
            <Ic d={icons.filter} s={14} /> Filters
            {activeCount > 0 && <span className="cq-badge">{activeCount}</span>}
          </button>
          <button className="cq-reset" onClick={() => { setFromDate(""); setToDate(""); setShowDates(false); onReset(); }}>
            Reset
          </button>
        </div>

        {showDates && (
          <div className="cq-daterow">
            <label>From <input type="date" value={fromDate} onChange={(e) => applyDates(e.target.value, toDate)} /></label>
            <label>To <input type="date" value={toDate} onChange={(e) => applyDates(fromDate, e.target.value)} /></label>
            {(fromDate || toDate) && <button className="cq-reset" onClick={() => applyDates("", "")}>Clear dates</button>}
          </div>
        )}

        <div className="cq-chiprow">
          {CHIPS.map(([key, label, opts, allLabel]) => (
            <span className={"cq-chip" + (filters[key] ? " on" : "")} key={key}>
              <select value={filters[key]} onChange={(e) => onFilter(key, e.target.value)}>
                <option value="">{label}: {allLabel || "All"}</option>
                {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {filters[key] && (
                <button onClick={() => onFilter(key, "")} aria-label={`Clear ${label}`}><Ic d={icons.x} s={11} /></button>
              )}
            </span>
          ))}
          <span className="cq-chip cq-sort">
            <Ic d={icons.sort} s={13} />
            <select value={filters.sort} onChange={(e) => onFilter("sort", e.target.value)}>
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="priority">Priority</option>
              <option value="updated">Recently Updated</option>
            </select>
          </span>
        </div>
      </div>

      {showFilterSheet && createPortal(
        <FilterSheet
          chips={CHIPS} filters={filters} onFilter={onFilter}
          fromDate={fromDate} toDate={toDate} applyDates={applyDates}
          activeCount={activeCount}
          onReset={() => { setFromDate(""); setToDate(""); setShowDates(false); onReset(); }}
          onClose={() => setShowFilterSheet(false)} />,
        document.body
      )}

      {/* Results */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="empty" style={{ padding: 50 }}><span className="spin"><Ic d={icons.refresh} s={22} /></span></div>
        ) : rows.length === 0 ? (
          <div className="empty" style={{ padding: 44 }}>
            <Ic d={icons.clipboard} s={26} />
            <div style={{ marginTop: 10, fontWeight: 700 }}>No complaints match</div>
            <div className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>Try clearing a filter or the search box.</div>
          </div>
        ) : (
          <>
            {/* ≥900px: full table. Below that it would need horizontal scrolling,
                so the same rows render as stacked cards instead. */}
            <div className="tbl-wrap cq-desktop" style={{ border: "none", borderRadius: 0 }}>
              <table className="tbl">
                <thead><tr>
                  <th>COMPLAINT</th><th>CATEGORY</th><th>LOCATION</th>
                  <th>PRIORITY</th><th>STATUS</th><th>CREATED</th><th />
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const cs = catStyle(r.category.code);
                    return (
                      <tr key={r.id} className="cq-row" onClick={() => onOpen(r.id)}>
                        <td>
                          <div className="cq-cmp">
                            <span className="cq-cmp-ic" style={{ background: `${cs.color}18`, color: cs.color }}>
                              <Ic d={cs.icon} s={17} />
                            </span>
                            <span style={{ minWidth: 0 }}>
                              <span className="cq-code">{r.complaintCode}</span>
                              <span className="cq-desc">{r.description}</span>
                              <span className="cq-meta">{renderRowMeta(r)}</span>
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="cq-cat">
                            <span className="cq-cat-ic" style={{ background: `${cs.color}18`, color: cs.color }}>
                              <Ic d={cs.icon} s={14} />
                            </span>
                            {r.category.label}
                          </span>
                        </td>
                        <td>
                          <div className="cq-loc">{r.location.wardName || "—"}</div>
                          <div className="cq-loc-sub">{r.location.bedName ? `Bed ${r.location.bedName}` : (r.location.departmentName || "")}</div>
                        </td>
                        <td>
                          <span className="cq-pri">
                            <span className="cq-dot" style={{ background: PRIORITY_COLOR[r.priority.code] }} />
                            <span style={{ color: PRIORITY_COLOR[r.priority.code] }}>{r.priority.label}</span>
                          </span>
                        </td>
                        <td><StatusPill status={r.status} /></td>
                        <td>
                          <div className="cq-when"><RelativeTime ts={r.createdAt} /></div>
                          <div className="cq-when-sub">{fmtDateTime(r.createdAt)}</div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button className="cq-view" onClick={(e) => { e.stopPropagation(); onOpen(r.id); }}>View Details</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="cq-mobile">
              {rows.map((r) => {
                const cs = catStyle(r.category.code);
                return (
                  <div className="cq-mrow" key={r.id} onClick={() => onOpen(r.id)}>
                    <div className="cq-mhead">
                      <span className="cq-cmp-ic" style={{ background: `${cs.color}18`, color: cs.color }}>
                        <Ic d={cs.icon} s={16} />
                      </span>
                      <span className="cq-code">{r.complaintCode}</span>
                      <StatusPill status={r.status} />
                      <span className="cq-pri" style={{ marginLeft: "auto" }}>
                        <span className="cq-dot" style={{ background: PRIORITY_COLOR[r.priority.code] }} />
                        <span style={{ color: PRIORITY_COLOR[r.priority.code] }}>{r.priority.label}</span>
                      </span>
                    </div>
                    <div className="cq-desc" style={{ margin: "6px 0" }}>{r.description}</div>
                    <div className="cq-meta">
                      {r.category.label} · {r.location.wardName || "—"}
                      {r.location.bedName ? ` · Bed ${r.location.bedName}` : ""} · IP {r.ipLast6}
                    </div>
                    <div className="cq-meta" style={{ marginTop: 3 }}><RelativeTime ts={r.createdAt} /> · {fmtDateTime(r.createdAt)}</div>
                  </div>
                );
              })}
            </div>

            <div className="cq-foot">
              <span className="dim" style={{ fontSize: 12 }}>
                Showing {firstRow} to {lastRow} of {total} complaint{total === 1 ? "" : "s"}
              </span>
              <div className="cq-pager">
                <button disabled={filters.page <= 1} onClick={() => onPage(filters.page - 1)}>
                  <Ic d={icons.chevron} s={12} style={{ transform: "rotate(180deg)" }} /> Previous
                </button>
                {pageWindow(filters.page, pages).map((p, i) =>
                  p === "…"
                    ? <span key={`e${i}`} className="cq-ellipsis">…</span>
                    : <button key={p} className={p === filters.page ? "on" : ""} onClick={() => onPage(p)}>{p}</button>
                )}
                <button disabled={filters.page >= pages} onClick={() => onPage(filters.page + 1)}>
                  Next <Ic d={icons.chevron} s={12} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
export default function PWOApp({ user, meta, onLogout }) {
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState("");
  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2600); }, []);

  const [stats, setStats] = useState(null);
  const [charts, setCharts] = useState(null);
  const [lookups, setLookups] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState(null);
  // Opening a complaint replaces the queue with its detail — save/restore
  // scroll across that swap. saveQueueScroll() must be called wherever
  // detailId is opened, before setDetailId.
  const saveQueueScroll = useScrollRestore(!!detailId);
  const [officers, setOfficers] = useState([]);

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  // Socket handlers close over this instead of `filters` so they never need to
  // be re-subscribed (and never act on a stale filter set).
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const detailPatch = useRef(null);

  // ── Initial load (REST) ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [m, d, ch] = await Promise.all([api.pwoMeta(), api.pwoDashboard(), api.pwoCharts(30)]);
        setLookups(m); setStats(d.stats); setCharts(ch.charts);
      } catch (e) { showToast(toastErr(e)); }
    })();
  }, [showToast]);

  const loadQueue = useCallback(async (f) => {
    setLoading(true);
    try {
      const r = await api.pwoComplaints({ ...f, pageSize: 25 });
      setRows(r.complaints); setTotal(r.total);
    } catch (e) { showToast(toastErr(e)); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { loadQueue(filters); }, [filters, loadQueue]);

  // This screen only ever patches in place — it never refetches on an event.
  // That is right while connected, but it means a disconnect leaves the queue
  // and the stat cards silently stale: socket.io does not replay what was
  // missed, so a complaint raised while offline would simply never appear.
  // Re-pull stats, charts and the current page whenever the socket comes back.
  // Held in a ref so the socket effect below never re-subscribes just because
  // the filters changed. Lookups are deliberately not re-pulled — they are
  // reference data an admin edits, not live queue state.
  const resyncRef = useRef(null);
  resyncRef.current = async () => {
    try {
      const [d, ch] = await Promise.all([api.pwoDashboard(), api.pwoCharts(30)]);
      setStats(d.stats); setCharts(ch.charts);
    } catch { /* transient — a later reconnect will try again */ }
    loadQueue(filtersRef.current);
  };

  useEffect(() => { if (tab === "reports") api.pwoPerOfficer().then(r => setOfficers(r.officers)).catch(() => {}); }, [tab]);

  // ── Live updates: patch in place, never refetch ──────────────────────────
  useEffect(() => {
    const socket = getSocket();

    const patchRow = (id, patch) =>
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    /** A row only belongs in the visible list while it still matches the
     *  active status filter — otherwise it's removed rather than left behind
     *  showing a status the user has filtered out. */
    const reconcile = (id, newStatus) => {
      const f = filtersRef.current;
      // matchesStatus, not `f.status !== newStatus`: under the default ACTIVE
      // group filter a raw comparison is false for every real status, so each
      // transition would have wrongly evicted the row from the queue.
      if (!matchesStatus(f.status, newStatus)) {
        setRows((prev) => prev.filter((r) => r.id !== id));
        setTotal((t) => Math.max(0, t - 1));
      }
    };

    const onCreated = ({ complaint }) => {
      setStats((s) => s && {
        ...s,
        open: s.open + 1,
        pending: s.pending + 1,
        todayTotal: s.todayTotal + 1,
      });
      setCharts((ch) => ch && {
        ...ch,
        byCategory: bumpSeries(ch.byCategory, complaint.category.label),
        byWard: bumpSeries(ch.byWard, complaint.location.wardName ?? "Unspecified"),
        byFloor: bumpSeries(ch.byFloor, complaint.location.floorName ?? "Unspecified"),
        byDepartment: bumpSeries(ch.byDepartment, complaint.location.departmentName ?? "Unspecified"),
      });
      const f = filtersRef.current;
      // Only surface it in the list the user is actually looking at.
      // A new complaint is always OPEN, so it belongs in any view whose status
      // filter admits OPEN — including the default ACTIVE group.
      if (matchesStatus(f.status, "OPEN") && f.page === 1 && !f.search) {
        setRows((prev) => (prev.some((r) => r.id === complaint.id) ? prev : [complaint, ...prev]));
        setTotal((t) => t + 1);
      }
      showToast(`New complaint · ${complaint.category.label}`);
    };

    const onAccepted = (p) => {
      setStats((s) => applyStatusDelta(s, p.fromStatus, p.status));
      patchRow(p.complaintId, {
        status: p.status, ownerPwoId: p.ownerPwoId, ownerName: p.ownerName,
        acceptedAt: p.acceptedAt, updatedAt: p.updatedAt,
      });
      reconcile(p.complaintId, p.status);
      detailPatch.current?.("complaint:accepted", p);
    };

    const onStatusChanged = (p) => {
      setRows((prev) => {
        const row = prev.find((r) => r.id === p.complaintId);
        setStats((s) => applyStatusDelta(s, p.fromStatus, p.status, row?.priority?.code));
        return prev.map((r) => (r.id === p.complaintId
          ? { ...r, status: p.status, updatedAt: p.updatedAt, resolvedAt: p.resolvedAt, closedAt: p.closedAt }
          : r));
      });
      reconcile(p.complaintId, p.status);
      detailPatch.current?.("complaint:status_changed", p);
    };

    const onPriorityChanged = (p) => {
      setRows((prev) => {
        const row = prev.find((r) => r.id === p.complaintId);
        // Keep the High/Critical cards honest when priority changes on a
        // complaint that is still outstanding.
        if (row && PENDING.has(row.status)) {
          setStats((s) => {
            if (!s) return s;
            const n = { ...s };
            if (p.fromPriority === "HIGH")     n.highPriority = Math.max(0, n.highPriority - 1);
            if (p.fromPriority === "CRITICAL") n.critical     = Math.max(0, n.critical - 1);
            if (p.priority.code === "HIGH")     n.highPriority += 1;
            if (p.priority.code === "CRITICAL") n.critical += 1;
            return n;
          });
        }
        return prev.map((r) => (r.id === p.complaintId ? { ...r, priority: p.priority, updatedAt: p.updatedAt } : r));
      });
      detailPatch.current?.("complaint:priority_changed", p);
    };

    const onNoteAdded = (p) => detailPatch.current?.("complaint:note_added", p);

    socket.on("complaint:created", onCreated);
    socket.on("complaint:accepted", onAccepted);
    socket.on("complaint:status_changed", onStatusChanged);
    socket.on("complaint:priority_changed", onPriorityChanged);
    socket.on("complaint:note_added", onNoteAdded);
    // Only a RECONNECT resyncs — the first connect would duplicate the
    // mount-time loads a moment earlier. See resyncRef above for why a
    // patch-only screen needs this at all.
    const offReconnect = onReconnect(socket, () => resyncRef.current?.());

    return () => {
      socket.off("complaint:created", onCreated);
      socket.off("complaint:accepted", onAccepted);
      socket.off("complaint:status_changed", onStatusChanged);
      socket.off("complaint:priority_changed", onPriorityChanged);
      socket.off("complaint:note_added", onNoteAdded);
      offReconnect();
    };
  }, [showToast]);

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v, page: k === "page" ? v : 1 }));

  const menu = [
    { key: "dashboard", icon: icons.home,      label: "Dashboard" },
    { key: "queue",     icon: icons.clipboard, label: "Complaints" },
    { key: "reports",   icon: icons.chart,     label: "Reports" },
  ];
  const TITLES = { dashboard: "Welfare Dashboard", queue: "Complaints", reports: "Reports" };

  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="preui">
      <AppShell
        menu={menu} active={tab} onSelect={(k) => { setTab(k); setDetailId(null); }}
        title={TITLES[tab]}
        user={{ name: user?.name || user?.username, role: "PWO" }}
        onLogout={onLogout}
      >
        {/* ── Dashboard ────────────────────────────────────────────────── */}
        {tab === "dashboard" && (
          <div className="slide-up">
            {!stats ? (
              <div className="empty" style={{ paddingTop: 60 }}><span className="spin"><Ic d={icons.refresh} s={24} /></span></div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
                  <StatCard label="Open"           value={stats.open}          color="#dc2626" icon={icons.alert} />
                  <StatCard label="Accepted"       value={stats.accepted}      color="#2563eb" icon={icons.user} />
                  <StatCard label="Under Review"   value={stats.underReview}   color="#d97706" icon={icons.clock} />
                  <StatCard label="Pending total"  value={stats.pending}       color="#8b5cf6" icon={icons.layers} />
                  <StatCard label="Resolved today" value={stats.resolvedToday} color="#16a34a" icon={icons.check} />
                  <StatCard label="Closed today"   value={stats.closedToday}   color="#6b7280" icon={icons.ban} />
                  <StatCard label="High priority"  value={stats.highPriority}  color="#d97706" icon={icons.target} />
                  <StatCard label="Critical"       value={stats.critical}      color="#dc2626" icon={icons.alert} />
                  <StatCard label="Today's total"  value={stats.todayTotal}    color="#0891b2" icon={icons.chart} />
                  <StatCard label="Avg resolution" value={fmtDuration(stats.avgResolutionMs)} color="#16a34a" icon={icons.clock}
                            sub={`accept ${fmtDuration(stats.avgAcceptanceMs)}`} />
                </div>

                {charts && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 10 }}>
                    <BarChart title="By Category"   data={charts.byCategory}   color="#2563eb" />
                    <BarChart title="By Ward"       data={charts.byWard}       color="#0891b2" />
                    <BarChart title="By Floor"      data={charts.byFloor}      color="#8b5cf6" />
                    <BarChart title="By Department" data={charts.byDepartment} color="#d97706" />
                    <BarChart title="By Hour of Day" data={charts.byHour} color="#16a34a"
                              formatKey={(k) => `${String(k).padStart(2, "0")}:00`} />
                    <LineChart title="Daily Trend"   data={charts.daily}   color="#2563eb" />
                    <LineChart title="Weekly Trend"  data={charts.weekly}  color="#8b5cf6" />
                    <LineChart title="Monthly Trend" data={charts.monthly} color="#0891b2" />
                    <LineChart title="Avg Resolution (hours)" data={charts.resolutionTrend} color="#16a34a" valueKey="hours" suffix="h" />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Queue ────────────────────────────────────────────────────── */}
        {tab === "queue" && (detailId ? (
          <ComplaintDetail
            id={detailId} meId={user?.id} onBack={() => { setDetailId(null); loadQueue(filters); }}
            onPatched={detailPatch} showToast={showToast}
          />
        ) : (
          <ComplaintsQueue
            stats={stats} rows={rows} total={total} loading={loading}
            lookups={lookups} filters={filters}
            onFilter={setFilter} onPage={(p) => setFilters((f) => ({ ...f, page: p }))}
            onReset={() => setFilters(DEFAULT_FILTERS)}
            onOpen={(id) => { saveQueueScroll(); setDetailId(id); }}
          />
        ))}


        {/* ── Reports ──────────────────────────────────────────────────── */}
        {tab === "reports" && (
          <div className="slide-up">
            <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 12 }}>
              <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--line)", fontWeight: 700, fontSize: 14 }}>
                Complaints per Welfare Officer
              </div>
              <div className="tbl-wrap" style={{ border: "none", borderRadius: 0 }}>
                <table className="tbl">
                  <thead><tr>
                    <th>Officer</th>
                    <th style={{ textAlign: "center" }}>Total</th>
                    <th style={{ textAlign: "center" }}>Pending</th>
                    <th style={{ textAlign: "center" }}>Resolved</th>
                    <th style={{ textAlign: "center" }}>Closed</th>
                    <th style={{ textAlign: "center" }}>Avg resolution</th>
                  </tr></thead>
                  <tbody>
                    {officers.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{o.name}</div>
                          <div className="dim" style={{ fontSize: 10.5 }}>
                            @{o.username}{o.status === "inactive" && <span style={{ color: "var(--red)" }}> · inactive</span>}
                          </div>
                        </td>
                        <td style={{ textAlign: "center", fontWeight: 700 }}>{o.total}</td>
                        <td style={{ textAlign: "center", color: "#d97706", fontWeight: 700 }}>{o.pending}</td>
                        <td style={{ textAlign: "center", color: "#16a34a", fontWeight: 700 }}>{o.resolved}</td>
                        <td style={{ textAlign: "center" }}>{o.closed}</td>
                        <td style={{ textAlign: "center" }}>{fmtDuration(o.avgResolutionMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {charts && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 10 }}>
                <BarChart title="Wards with most complaints"       data={charts.byWard}       color="#0891b2" />
                <BarChart title="Departments with most complaints" data={charts.byDepartment} color="#d97706" />
                <BarChart title="Most common categories"           data={charts.byCategory}   color="#2563eb" />
              </div>
            )}
          </div>
        )}


        <PwoThemeRow />

        {toast && <div className="toast show">{toast}</div>}
      </AppShell>
    </div>
  );
}
