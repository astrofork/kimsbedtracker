import React, { useState, useEffect, useRef, useCallback } from "react";
import { api, startAlarm, stopAlarm, fmtTime, fmtClock, toastErr } from "./lib.js";
import { Ic, icons, StatusBar, ThemeToggle, useModal } from "./ui.jsx";

export default function PREApp({ user, meta, onLogout }) {
  const [tab, setTab] = useState("home");
  const [data, setData] = useState(null);
  const [toast, setToast] = useState("");
  const pollRef = useRef(null);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  const load = async () => {
    try { setData(await api.preMe()); }
    catch { /* 401 handled by session:expired event */ }
  };

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 15000);
    return () => clearInterval(pollRef.current);
  }, []);

  const alarmActive = data?.alarm?.alarmActive;
  useEffect(() => {
    if (alarmActive) startAlarm(); else stopAlarm();
    return () => stopAlarm();
  }, [alarmActive]);

  const submitRound = async () => {
    if (!data) return;
    const notReady = data.wards.filter(w => w.vacant === null);
    if (notReady.length > 0) {
      showToast(`Configure beds for ${notReady[0].ward} first`);
      setTab("entry");
      return;
    }
    try {
      await api.submitRound();
      stopAlarm();
      showToast("Round submitted ✓");
      await load();
      setTab("home");
    } catch (e) { showToast(toastErr(e)); }
  };

  if (!data) return (
    <div className="app">
      <div className="empty" style={{ paddingTop: 120 }}>
        <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
        <div style={{ marginTop: 12 }}>Loading…</div>
      </div>
    </div>
  );

  const pre = user.pre;

  return (
    <div className={"app" + (alarmActive ? " alarm-flash" : "")}>
      <div className="topbar">
        <div className="row">
          <div className="logo" style={{ width: 30, height: 30, fontSize: 14 }}>B</div>
          <div>
            <div className="h2">{pre}</div>
            <div className="dim" style={{ fontSize: 11 }}>{data.floor}</div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="pre-pill" style={{ flexDirection: "column", gap: 1, lineHeight: 1.2, padding: "5px 9px" }}>
            <span style={{ fontSize: 11 }}><Ic d={icons.clock} s={11} /> {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })}</span>
            <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{new Date().toLocaleDateString("en-GB")}</span>
          </span>
          <ThemeToggle />
          <button className="btn btn-ghost" style={{ padding: 9 }} onClick={onLogout}>
            <Ic d={icons.logout} s={17} />
          </button>
        </div>
      </div>

      <div className="pad" style={{ paddingBottom: 90 }}>
        {tab === "home"  && <Home {...{ data, meta, setTab, alarmActive }} />}
        {tab === "entry" && <Entry data={data} submitRound={submitRound} alarmActive={alarmActive} onRefresh={load} />}
        {tab === "map"   && <MyMap data={data} />}
      </div>

      <div className="navbar">
        <NavBtn on={tab === "home"}  ic={icons.home} label="Home"  onClick={() => setTab("home")} />
        <NavBtn on={tab === "entry"} ic={icons.bed}  label="Entry" dot={alarmActive} onClick={() => setTab("entry")} />
        <NavBtn on={tab === "map"}   ic={icons.map}  label="Map"   onClick={() => setTab("map")} />
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function NavBtn({ on, ic, label, dot, onClick }) {
  return (
    <button className={on ? "on" : ""} onClick={onClick}>
      <span style={{ position: "relative", lineHeight: 1 }}>
        <Ic d={ic} s={20} />
        {dot && <span style={{ position: "absolute", top: -3, right: -6, width: 8, height: 8, borderRadius: 99, background: "var(--red)" }} />}
      </span>
      {label}
    </button>
  );
}

function Home({ data, setTab, alarmActive }) {
  const s = data.summary;
  const round = data.alarm.round;
  const pct = s.wards > 0 ? Math.round((s.wardsDone / s.wards) * 100) : 0;
  const reported = s.wardsDone > 0;

  return (
    <div>
      {alarmActive && (
        <div className="alarm-banner slide-up">
          <div className="row">
            <span className="pulse" style={{ color: "var(--red)" }}><Ic d={icons.bell} s={24} /></span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--red)" }}>Round update due</div>
              <div style={{ fontSize: 12, color: "#DC2626" }}>Alarm rings until you submit this round</div>
            </div>
          </div>
          <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={() => setTab("entry")}>
            Enter bed status now
          </button>
          <div style={{ fontSize: 11, color: "#DC2626", marginTop: 9, textAlign: "center" }}>
            Window {fmtClock(round.startMin)} – {fmtClock(round.endMin)}
          </div>
        </div>
      )}

      {!alarmActive && data.alarm.submitted && (
        <div className="card slide-up" style={{ padding: 16, borderColor: "var(--teal-deep)", background: "var(--green-bg)" }}>
          <div className="row"><span style={{ color: "var(--green)" }}><Ic d={icons.check} s={22} /></span>
            <div><div style={{ fontWeight: 700, color: "var(--green)" }}>This round submitted</div>
              <div style={{ fontSize: 12, color: "var(--green)" }}>Next round at {fmtClock(round.endMin)}</div></div></div>
        </div>
      )}

      {!data.alarm.onDuty && (
        <div className="card slide-up" style={{ padding: 16 }}>
          <div className="row"><span className="dim"><Ic d={icons.clock} s={22} /></span>
            <div><div style={{ fontWeight: 700 }}>Off shift</div>
              <div className="dim" style={{ fontSize: 12 }}>No alarms outside your shift hours</div></div></div>
        </div>
      )}

      <div className="floor-head">My assigned shift</div>
      <ShiftDisplay shift={data.alarm.shift} />

      <div className="floor-head">Live snapshot</div>
      <div className="stat-grid">
        <div className="stat"><div className="n" style={{ color: "var(--green)" }}>{reported ? s.v : "–"}</div><div className="l">VACANT</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--amber)" }}>{reported ? s.r : "–"}</div><div className="l">VAC+RES</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--red)" }}>{reported ? s.o : "–"}</div><div className="l">OCCUPIED</div></div>
        <div className="stat"><div className="n" style={{ color: "#8B5CF6" }}>{reported ? s.or : "–"}</div><div className="l">OCC+RES</div></div>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 14 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="h2">Round completion</span>
          <span className="chip">{s.wardsDone}/{s.wards} wards</span>
        </div>
        <div className="bar"><span style={{ flex: pct, background: "var(--teal)" }} /><span style={{ flex: 100 - pct, background: "var(--panel-2)" }} /></div>
        <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>{s.total} beds across {s.wards} ward types</div>
      </div>

      {s.wards === 0 && (
        <div className="card empty" style={{ marginTop: 14 }}>
          <Ic d={icons.bed} s={28} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>No wards assigned yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{data.pre} has no beds mapped.</div>
        </div>
      )}
    </div>
  );
}

// Shift is assigned by the Manager — PRE sees it read-only, cannot change it.
function ShiftDisplay({ shift }) {
  const isMorning = shift === "morning";
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row between">
        <div className="row" style={{ gap: 10 }}>
          <span style={{ color: isMorning ? "var(--amber)" : "var(--blue)" }}>
            <Ic d={isMorning ? icons.sun : icons.moon} s={20} />
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{isMorning ? "Morning / General" : "Night"}</div>
            <div className="dim" style={{ fontSize: 11 }}>{isMorning ? "9:00 AM – 6:30 PM" : "8:00 PM – 8:00 AM"}</div>
          </div>
        </div>
        <span className="chip">assigned</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  ENTRY TAB  — new card-based design (Image #8)
// ══════════════════════════════════════════════════════════════════════════════
function Entry({ data, submitRound, alarmActive, onRefresh }) {
  const [bedModal, setBedModal] = useState(null); // { ward, tab } | null

  if (data.wards.length === 0)
    return (
      <div className="card empty">
        <Ic d={icons.bed} s={28} />
        <div style={{ marginTop: 10, fontWeight: 600 }}>No wards to enter</div>
      </div>
    );

  const round = data.alarm.round;
  const allDone = data.wards.every(w => w.vacant !== null);
  const doneCount = data.wards.filter(w => w.vacant !== null).length;

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="h1" style={{ fontSize: 18 }}>Bed entry</div>
        <span className="chip">{fmtClock(round.startMin)}–{fmtClock(round.endMin)}</span>
      </div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        Open each ward to manage individual bed status, then submit.
      </div>

      {data.wards.map((w, i) => {
        const entered = w.vacant !== null;
        return (
          <div className="ward-card slide-up" key={w.id}
            style={{
              animationDelay: i * 0.03 + "s",
              borderColor: entered ? "var(--teal-deep)" : "var(--line)",
              padding: 16, marginBottom: 12,
            }}>
            {/* Header */}
            <div className="row between" style={{ marginBottom: entered ? 14 : 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{w.ward}</div>
                <div className="dim" style={{ fontSize: 12 }}>
                  {w.total} beds
                  {entered && <span style={{ color: "var(--green)" }}> · complete</span>}
                </div>
              </div>
              {entered
                ? <span className="tag v"><Ic d={icons.check} s={12} /> ok</span>
                : <span className="tag b">no data</span>}
            </div>

            {/* Stats block */}
            {entered && (
              <div style={{
                display: "flex",
                background: "var(--panel-2)",
                borderRadius: 12,
                overflow: "hidden",
                marginBottom: 14,
              }}>
                {[
                  { label: "Vacant",   val: w.vacant,                 color: "var(--green)" },
                  { label: "Vac+Res",  val: w.reserved ?? 0,          color: "var(--amber)" },
                  { label: "Occupied", val: w.occupied ?? 0,          color: "var(--red)"   },
                  { label: "Occ+Res",  val: w.occupied_reserved ?? 0, color: "#8B5CF6"      },
                ].map(({ label, val, color }, idx) => (
                  <div key={label} style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "12px 6px",
                    borderLeft: idx > 0 ? "1px solid var(--line)" : "none",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-2)" }}>{label}</span>
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{val}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div className="row" style={{ gap: 8 }}>
              <button className="chip" style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setBedModal({ ward: w, tab: "view" })}>
                <Ic d={icons.grid} s={13} /> View beds
              </button>
              <button className="chip" style={{ flex: 1, justifyContent: "center", color: "var(--teal)" }}
                onClick={() => setBedModal({ ward: w, tab: "manage" })}>
                <Ic d={icons.bed} s={13} /> Manage beds
              </button>
            </div>
          </div>
        );
      })}

      <button
        className={"btn btn-primary btn-block" + (alarmActive ? " pulse" : "")}
        style={{ marginTop: 6 }}
        onClick={submitRound}>
        <Ic d={icons.check} s={18} /> Submit this round
      </button>
      {!allDone && (
        <div className="dim" style={{ fontSize: 11, textAlign: "center", marginTop: 6 }}>
          {doneCount}/{data.wards.length} wards ready
        </div>
      )}
      <div style={{ height: 14 }} />

      {bedModal && (
        <PreBedModal
          ward={bedModal.ward}
          initialTab={bedModal.tab}
          onClose={() => { setBedModal(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

function MyMap({ data }) {
  const s = data.summary;
  const enteredBeds = s.v + s.r + s.o + (s.or || 0);
  const occPct = enteredBeds > 0 ? Math.round(((s.o + (s.or || 0)) / enteredBeds) * 100) : 0;

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>My ward map</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>{data.floor} · {data.pre} · {s.wards} wards · {s.total} beds</div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="h2">My occupancy</span>
          <span className="chip mono">{occPct}% full</span>
        </div>
        <StatusBar v={s.v} r={s.r} o={s.o} or={s.or || 0} total={s.total} />
        <div className="row" style={{ gap: 12, marginTop: 10 }}>
          <span className="tag v">{s.v} vacant</span>
          <span className="tag r">{s.r} vac+res</span>
          <span className="tag o">{s.o} occupied</span>
          {(s.or || 0) > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#8B5CF6", background: "#8B5CF620", borderRadius: 8, padding: "2px 6px" }}>{s.or} occ+res</span>}
        </div>
      </div>

      <div className="floor-head">Wards ({s.wardsDone}/{s.wards} updated)</div>
      {data.wards.map((w) => {
        const entered = w.vacant !== null;
        const wEntered = entered ? w.vacant + (w.occupied || 0) + (w.reserved || 0) + (w.occupied_reserved || 0) : 0;
        const wPct = wEntered > 0 ? Math.round(((w.occupied || 0) + (w.occupied_reserved || 0)) / wEntered * 100) : 0;
        const full = entered && (w.occupied || 0) + (w.occupied_reserved || 0) === w.total;
        return (
          <div className="ward-card" key={w.ward} style={{ borderColor: full ? "var(--red)" : entered ? "var(--teal-deep)" : "var(--line)" }}>
            <div className="row between" style={{ marginBottom: entered ? 10 : 0 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{w.ward}</div>
                <div className="dim" style={{ fontSize: 11 }}>
                  {w.total} beds{entered && w.updatedAt
                    ? ` · updated ${new Date(w.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })}`
                    : ""}
                </div>
              </div>
              {entered
                ? <span className="tag" style={{ background: full ? "var(--red-bg)" : "var(--panel-2)", color: full ? "var(--red)" : "var(--ink-2)" }}>
                    {full ? "FULL" : wPct + "% full"}
                  </span>
                : <span className="tag b">not entered</span>}
            </div>
            {entered && (
              <>
                <StatusBar v={w.vacant} r={w.reserved} o={w.occupied} or={w.occupied_reserved} total={w.total} />
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <span className="tag v">{w.vacant} vacant</span>
                  <span className="tag r">{w.reserved} vac+res</span>
                  <span className="tag o">{w.occupied} occupied</span>
                  {(w.occupied_reserved || 0) > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#8B5CF6", background: "#8B5CF620", borderRadius: 8, padding: "2px 6px" }}>{w.occupied_reserved} occ+res</span>}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── dual-state bed color/label helpers ────────────────────────────────────────
function bedStateColor(physical, reservation) {
  if (physical === "VACANT"   && reservation === "NONE")     return "var(--green)";
  if (physical === "VACANT"   && reservation === "RESERVED") return "var(--amber)";
  if (physical === "OCCUPIED" && reservation === "NONE")     return "var(--red)";
  if (physical === "OCCUPIED" && reservation === "RESERVED") return "#8B5CF6";
  return "var(--ink-3)";
}
function bedStateLabel(physical, reservation) {
  if (physical === "VACANT"   && reservation === "NONE")     return "Vacant";
  if (physical === "VACANT"   && reservation === "RESERVED") return "Vacant · Reserved";
  if (physical === "OCCUPIED" && reservation === "NONE")     return "Occupied";
  if (physical === "OCCUPIED" && reservation === "RESERVED") return "Occupied · Reserved";
  return "Unknown";
}
function bedStateCode(physical, reservation) {
  if (physical === "VACANT"   && reservation === "NONE")     return "V";
  if (physical === "VACANT"   && reservation === "RESERVED") return "V+R";
  if (physical === "OCCUPIED" && reservation === "NONE")     return "O";
  if (physical === "OCCUPIED" && reservation === "RESERVED") return "O+R";
  return "?";
}

// ── Compact bed card — used in both View and Manage grids ─────────────────────
const BedGridCard = React.memo(function BedGridCard({ bed, onClick }) {
  const p = bed.physical_status, r = bed.reservation_status;
  const color = bedStateColor(p, r);
  const code  = bedStateCode(p, r);
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      style={{
        background: "var(--panel-2)",
        border: `2px solid ${color}`,
        borderRadius: 10,
        padding: "7px 4px 8px",
        textAlign: "center",
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.1s, opacity 0.1s",
        userSelect: "none",
        minWidth: 0,
      }}
      onMouseEnter={onClick ? (e) => { e.currentTarget.style.transform = "scale(1.05)"; } : undefined}
      onMouseLeave={onClick ? (e) => { e.currentTarget.style.transform = "scale(1)"; } : undefined}
      onMouseDown={onClick ? (e) => { e.currentTarget.style.opacity = "0.75"; } : undefined}
      onMouseUp={onClick ? (e) => { e.currentTarget.style.opacity = "1"; } : undefined}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)", marginBottom: 3, lineHeight: 1.2 }}>
        {bed.bed_number}
      </div>
      <div style={{ fontSize: 12, fontWeight: 900, color, lineHeight: 1 }}>{code}</div>
    </div>
  );
});

// ── Edit dialog — opens when a bed card is clicked in Manage mode ─────────────
function BedEditDialog({ bed, onSave, onClose }) {
  const [physical,    setPhysical]    = useState(bed.physical_status);
  const [reservation, setReservation] = useState(bed.reservation_status);
  const [saving,      setSaving]      = useState(false);

  const color = bedStateColor(physical, reservation);
  const code  = bedStateCode(physical, reservation);

  async function handleSave() {
    setSaving(true);
    await onSave(bed.id, physical, reservation);
    setSaving(false);
    onClose();
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1100, padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--panel)", borderRadius: 18, padding: "22px 20px 18px",
          width: "100%", maxWidth: 300, boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
          animation: "slideUp .18s both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="row between" style={{ marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>Bed {bed.bed_number}</div>
            <div style={{ fontSize: 12, color, fontWeight: 700, marginTop: 2 }}>{code} · {bedStateLabel(physical, reservation)}</div>
          </div>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: color + "22", border: `2px solid ${color}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 900, fontSize: 12, color,
          }}>{code}</div>
        </div>

        {/* Physical Status */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
            Physical Status
          </div>
          <div className="row" style={{ gap: 8 }}>
            {[["VACANT","var(--green)","Vacant"],["OCCUPIED","var(--red)","Occupied"]].map(([val, c, lbl]) => (
              <button key={val} onClick={() => setPhysical(val)} style={{
                flex: 1, padding: "9px 0", borderRadius: 10, fontSize: 13, fontWeight: 700,
                border: `2px solid ${c}`,
                background: physical === val ? c : "transparent",
                color: physical === val ? "#fff" : c,
                cursor: "pointer", transition: "all 0.15s",
              }}>{lbl}</button>
            ))}
          </div>
        </div>

        {/* Reservation Status */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
            Reservation
          </div>
          <div className="row" style={{ gap: 8 }}>
            {[["NONE","var(--ink-3)","None"],["RESERVED","var(--amber)","Reserved"]].map(([val, c, lbl]) => (
              <button key={val} onClick={() => setReservation(val)} style={{
                flex: 1, padding: "9px 0", borderRadius: 10, fontSize: 13, fontWeight: 700,
                border: `2px solid ${c}`,
                background: reservation === val ? c : "transparent",
                color: reservation === val ? "#fff" : c,
                cursor: "pointer", transition: "all 0.15s",
              }}>{lbl}</button>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="row" style={{ gap: 8 }}>
          <button className="chip" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 1, padding: "10px 0", borderRadius: 10, fontWeight: 700,
            fontSize: 14, background: "var(--teal)", color: "#fff",
            border: "none", cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.7 : 1, transition: "opacity 0.15s",
          }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRE BED MODAL  (View + Manage tabs — compact grid layout)
// ══════════════════════════════════════════════════════════════════════════════
function PreBedModal({ ward, initialTab, onClose }) {
  useModal(onClose);
  const [tab,        setTab]        = useState(initialTab || "view");
  const [beds,       setBeds]       = useState([]);
  const [filter,     setFilter]     = useState("ALL");
  const [editingBed, setEditingBed] = useState(null);  // bed object | null
  const [loading,    setLoading]    = useState(false);
  const [toast,      setToast]      = useState("");

  const showToast = useCallback((m) => {
    setToast(m); setTimeout(() => setToast(""), 2000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setBeds((await api.preBeds(ward.id)).beds || []); }
    catch (e) { showToast(toastErr(e)); }
    finally { setLoading(false); }
  }, [ward.id, showToast]);

  useEffect(() => { load(); }, [load]);

  const sortedBeds = [...beds].sort((a, b) => {
    const na = parseInt(a.bed_number, 10), nb = parseInt(b.bed_number, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.bed_number.localeCompare(b.bed_number);
  });

  const counts = { vn: 0, vr: 0, on_: 0, or_: 0 };
  for (const b of sortedBeds) {
    if (b.physical_status === "VACANT"   && b.reservation_status === "NONE")     counts.vn++;
    if (b.physical_status === "VACANT"   && b.reservation_status === "RESERVED") counts.vr++;
    if (b.physical_status === "OCCUPIED" && b.reservation_status === "NONE")     counts.on_++;
    if (b.physical_status === "OCCUPIED" && b.reservation_status === "RESERVED") counts.or_++;
  }

  const displayed = sortedBeds.filter(b => {
    if (filter === "V")   return b.physical_status === "VACANT"   && b.reservation_status === "NONE";
    if (filter === "V+R") return b.physical_status === "VACANT"   && b.reservation_status === "RESERVED";
    if (filter === "O")   return b.physical_status === "OCCUPIED" && b.reservation_status === "NONE";
    if (filter === "O+R") return b.physical_status === "OCCUPIED" && b.reservation_status === "RESERVED";
    if (filter === "R")   return b.reservation_status === "RESERVED";  // V+R + O+R combined
    return true; // ALL
  });

  // Optimistic update — snapshot restored on failure
  const changeStatus = useCallback(async (bedId, physicalStatus, reservationStatus) => {
    let snapshot;
    setBeds(prev => {
      snapshot = prev;
      return prev.map(b => b.id === bedId
        ? { ...b, physical_status: physicalStatus, reservation_status: reservationStatus }
        : b);
    });
    try {
      await api.preUpdateBedStatus(bedId, physicalStatus, reservationStatus);
    } catch (e) {
      setBeds(snapshot);
      showToast(toastErr(e));
    }
  }, [showToast]);

  const emptyState = (
    <div className="card empty" style={{ marginTop: 8 }}>
      <Ic d={icons.bed} s={28} />
      <div style={{ marginTop: 10, fontWeight: 600 }}>No beds configured</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>Ask your manager to generate beds for this ward.</div>
    </div>
  );
  const spinner = (
    <div className="dim" style={{ textAlign: "center", padding: 28 }}>
      <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={22} /></span>
    </div>
  );

  // ── Shared grid renderer ─────────────────────────────────────────────────
  function BedGrid({ clickable, showFilters }) {
    const chips = [
      { key: "ALL",  label: `All (${beds.length})`,               color: "var(--ink)" },
      { key: "V",    label: `Vac (${counts.vn})`,                 color: "var(--green)" },
      { key: "V+R",  label: `V+R (${counts.vr})`,                 color: "var(--amber)" },
      { key: "O",    label: `Occ (${counts.on_})`,                color: "var(--red)" },
      { key: "O+R",  label: `O+R (${counts.or_})`,                color: "#8B5CF6" },
      { key: "R",    label: `Res (${counts.vr + counts.or_})`,    color: "var(--amber)" },
    ];
    // Manage tab always shows all beds (no filter applied)
    const gridBeds = showFilters ? displayed : sortedBeds;
    return (
      <>
        {/* Filter chips — View tab only. Active chip hides itself; others fill the row. */}
        {showFilters && (
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {chips.map(({ key, label, color }) => (
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

        {/* Grid */}
        {gridBeds.length === 0 ? (
          <div className="dim" style={{ textAlign: "center", padding: "18px 0", fontSize: 13 }}>
            No beds in this filter
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
            gap: 6,
          }}>
            {gridBeds.map((bed) => (
              <BedGridCard
                key={bed.id}
                bed={bed}
                onClick={clickable ? () => setEditingBed(bed) : undefined}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <div className="grab" />
        <div className="pad">
          {/* Header */}
          <div className="row between" style={{ marginBottom: 14 }}>
            <div>
              <div className="h1" style={{ fontSize: 18 }}>{ward.ward}</div>
              <div className="dim" style={{ fontSize: 12 }}>
                {beds.length} bed{beds.length !== 1 ? "s" : ""}
              </div>
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          {/* Tab bar */}
          <div className="seg" style={{ marginBottom: 14 }}>
            <button className={tab === "view" ? "on" : ""} onClick={() => setTab("view")}>
              <Ic d={icons.grid} s={14} /> View
            </button>
            <button className={tab === "manage" ? "on" : ""} onClick={() => setTab("manage")}>
              <Ic d={icons.bed} s={14} /> Manage
            </button>
          </div>



          {/* Tab content */}
          {loading ? spinner : beds.length === 0 ? emptyState : <BedGrid clickable={tab === "manage"} showFilters={tab === "view"} />}
        </div>
      </div>

      {/* Bed edit dialog — rendered outside the sheet so it overlays everything */}
      {editingBed && (
        <BedEditDialog
          bed={editingBed}
          onSave={async (bedId, physical, reservation) => {
            // Keep editingBed state in sync so the dialog header updates live
            setEditingBed(prev => ({ ...prev, physical_status: physical, reservation_status: reservation }));
            await changeStatus(bedId, physical, reservation);
          }}
          onClose={() => setEditingBed(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
