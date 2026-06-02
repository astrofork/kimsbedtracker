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
        <div className="stat"><div className="n" style={{ color: "var(--red)" }}>{reported ? s.o : "–"}</div><div className="l">OCCUPIED</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--amber)" }}>{reported ? s.r : "–"}</div><div className="l">RESERVED</div></div>
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
                  { label: "Vacant",   val: w.vacant,        color: "var(--green)" },
                  { label: "Reserved", val: w.reserved ?? 0, color: "var(--amber)" },
                  { label: "Occupied", val: w.occupied ?? 0, color: "var(--red)"   },
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
  const enteredBeds = s.v + s.o + s.r;
  const occPct = enteredBeds > 0 ? Math.round((s.o / enteredBeds) * 100) : 0;

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>My ward map</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>{data.floor} · {data.pre} · {s.wards} wards · {s.total} beds</div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="h2">My occupancy</span>
          <span className="chip mono">{occPct}% full</span>
        </div>
        <StatusBar v={s.v} o={s.o} r={s.r} total={s.total} />
        <div className="row" style={{ gap: 12, marginTop: 10 }}>
          <span className="tag v">{s.v} vacant</span>
          <span className="tag o">{s.o} occupied</span>
          <span className="tag r">{s.r} reserved</span>
        </div>
      </div>

      <div className="floor-head">Wards ({s.wardsDone}/{s.wards} updated)</div>
      {data.wards.map((w) => {
        const entered = w.vacant !== null;
        const wEntered = entered ? w.vacant + (w.occupied || 0) + (w.reserved || 0) : 0;
        const wPct = wEntered > 0 ? Math.round(((w.occupied || 0) / wEntered) * 100) : 0;
        const full = entered && w.occupied === w.total;
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
                <StatusBar v={w.vacant} o={w.occupied} r={w.reserved} total={w.total} />
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <span className="tag v">{w.vacant} vacant</span>
                  <span className="tag o">{w.occupied} occupied</span>
                  <span className="tag r">{w.reserved} reserved</span>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── bed status color helper ────────────────────────────────────────────────────
function bedStatusColor(s) {
  if (s === "VACANT")   return "var(--green)";
  if (s === "RESERVED") return "var(--amber)";
  if (s === "OCCUPIED") return "var(--red)";
  return "var(--ink-3)";
}

// ── Memoized bed row for the Manage tab — only re-renders when its own status changes
const BedManageRow = React.memo(function BedManageRow({ bed, onChangeStatus }) {
  return (
    <div className="row between" style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div className="row" style={{ gap: 8 }}>
        <span style={{
          width: 9, height: 9, borderRadius: "50%",
          background: bedStatusColor(bed.status), flexShrink: 0, marginTop: 2,
        }} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>Bed {bed.bed_number}</span>
      </div>
      <div className="row" style={{ gap: 5 }}>
        {["VACANT", "RESERVED", "OCCUPIED"].map((s) => (
          <button key={s}
            style={{
              padding: "4px 9px", borderRadius: 16, fontSize: 11, fontWeight: 700,
              border: `1.5px solid ${bedStatusColor(s)}`,
              background: bed.status === s ? bedStatusColor(s) : "transparent",
              color: bed.status === s ? "#fff" : bedStatusColor(s),
              cursor: "pointer", transition: "all 0.15s",
            }}
            onClick={() => bed.status !== s && onChangeStatus(bed.id, s)}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
    </div>
  );
});

// ── Memoized bed card for the View tab
const BedViewCard = React.memo(function BedViewCard({ bed }) {
  return (
    <div style={{
      padding: "10px 8px", borderRadius: 10, textAlign: "center",
      background: "var(--panel-2)",
      border: `1.5px solid ${bedStatusColor(bed.status)}40`,
    }}>
      <div style={{
        width: 9, height: 9, borderRadius: "50%",
        background: bedStatusColor(bed.status), margin: "0 auto 5px",
      }} />
      <div style={{ fontWeight: 700, fontSize: 13 }}>Bed {bed.bed_number}</div>
      <div style={{ fontSize: 10, color: bedStatusColor(bed.status), fontWeight: 600 }}>
        {bed.status.charAt(0) + bed.status.slice(1).toLowerCase()}
      </div>
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
//  PRE BED MODAL  (View + Manage tabs with status change)
// ══════════════════════════════════════════════════════════════════════════════
function PreBedModal({ ward, initialTab, onClose }) {
  useModal(onClose);
  const [tab,     setTab]     = useState(initialTab || "view");
  const [beds,    setBeds]    = useState([]);
  const [filter,  setFilter]  = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [toast,   setToast]   = useState("");

  // Stable reference — setToast is always the same React dispatch function
  const showToast = useCallback((m) => {
    setToast(m); setTimeout(() => setToast(""), 2000);
  }, []);

  // Initial fetch (and manual refresh). Never called from changeStatus.
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
  const counts = { VACANT: 0, RESERVED: 0, OCCUPIED: 0 };
  for (const b of sortedBeds) if (b.status in counts) counts[b.status]++;
  const displayed = filter === "ALL" ? sortedBeds : sortedBeds.filter((b) => b.status === filter);

  // Optimistic update — no loading state, no DOM replacement, no scroll jump.
  // On API failure the snapshot is restored and an error toast is shown.
  const changeStatus = useCallback(async (bedId, newStatus) => {
    let snapshot;
    setBeds(prev => {
      snapshot = prev;
      return prev.map(b => b.id === bedId ? { ...b, status: newStatus } : b);
    });
    try {
      await api.preUpdateBedStatus(bedId, newStatus);
    } catch (e) {
      setBeds(snapshot);
      showToast(toastErr(e));
    }
  }, [showToast]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div>
              <div className="h1" style={{ fontSize: 18 }}>{ward.ward}</div>
              <div className="dim" style={{ fontSize: 12 }}>
                {beds.length} bed{beds.length !== 1 ? "s" : ""}
                {beds.length > 0 && (
                  <> · <span style={{ color: "var(--green)" }}>{counts.VACANT}V</span>
                  {" "}<span style={{ color: "var(--red)" }}>{counts.OCCUPIED}O</span>
                  {" "}<span style={{ color: "var(--amber)" }}>{counts.RESERVED}R</span></>
                )}
              </div>
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          {/* Tab bar */}
          <div className="seg" style={{ marginBottom: 16 }}>
            <button className={tab === "view" ? "on" : ""} onClick={() => setTab("view")}>
              <Ic d={icons.grid} s={14} /> View beds
            </button>
            <button className={tab === "manage" ? "on" : ""} onClick={() => setTab("manage")}>
              <Ic d={icons.bed} s={14} /> Manage beds
            </button>
          </div>

          {/* ── View tab ── */}
          {tab === "view" && (
            loading ? (
              <div className="dim" style={{ textAlign: "center", padding: 28 }}>
                <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={22} /></span>
              </div>
            ) : beds.length === 0 ? (
              <div className="card empty" style={{ marginTop: 8 }}>
                <Ic d={icons.bed} s={28} />
                <div style={{ marginTop: 10, fontWeight: 600 }}>No beds configured</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Ask your manager to generate beds for this ward.</div>
              </div>
            ) : (
              <div>
                {/* Filter chips */}
                <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                  {[
                    { key: "ALL",      label: `All (${beds.length})`,          color: "var(--ink)" },
                    { key: "VACANT",   label: `Vacant (${counts.VACANT})`,     color: "var(--green)" },
                    { key: "RESERVED", label: `Reserved (${counts.RESERVED})`, color: "var(--amber)" },
                    { key: "OCCUPIED", label: `Occupied (${counts.OCCUPIED})`, color: "var(--red)" },
                  ].map(({ key, label, color }) => (
                    <button key={key}
                      style={{
                        padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                        border: `1.5px solid ${color}`,
                        background: filter === key ? color : "transparent",
                        color: filter === key ? "#fff" : color, cursor: "pointer",
                      }}
                      onClick={() => setFilter(key)}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Bed grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {displayed.map((bed) => (
                    <BedViewCard key={bed.id} bed={bed} />
                  ))}
                </div>

                {displayed.length === 0 && (
                  <div className="dim" style={{ textAlign: "center", padding: "18px 0", fontSize: 13 }}>
                    No beds with status "{filter.toLowerCase()}"
                  </div>
                )}

                {/* Summary */}
                <div className="row" style={{ gap: 16, marginTop: 16, justifyContent: "center" }}>
                  <span className="tag v">{counts.VACANT} Vacant</span>
                  <span className="tag r">{counts.RESERVED} Reserved</span>
                  <span className="tag o">{counts.OCCUPIED} Occupied</span>
                </div>
              </div>
            )
          )}

          {/* ── Manage tab ── */}
          {tab === "manage" && (
            loading ? (
              <div className="dim" style={{ textAlign: "center", padding: 28 }}>
                <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={22} /></span>
              </div>
            ) : beds.length === 0 ? (
              <div className="card empty" style={{ marginTop: 8 }}>
                <Ic d={icons.bed} s={28} />
                <div style={{ marginTop: 10, fontWeight: 600 }}>No beds configured</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Ask your manager to generate beds for this ward.</div>
              </div>
            ) : (
              <div>
                <div className="dim" style={{ fontSize: 12, marginBottom: 12 }}>
                  Select a status for each bed individually.
                </div>
                {sortedBeds.map((bed) => (
                  <BedManageRow key={bed.id} bed={bed} onChangeStatus={changeStatus} />
                ))}
              </div>
            )
          )}
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
