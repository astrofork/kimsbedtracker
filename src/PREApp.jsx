import React, { useState, useEffect, useRef, useCallback } from "react";
import { api, startAlarm, stopAlarm, fmtTime, fmtClock, toastErr, createSocket } from "./lib.js";
import { Ic, icons, StatusBar, useModal } from "./ui.jsx";
import { AppShell } from "./shell.jsx";
import { naturalSort, bedStateColor, bedStateBg, bedStateShort } from "./bedUtils.js";

const TAB_TITLES = { home: "Dashboard", entry: "Entry — Wards", map: "My Ward Map" };

export default function PREApp({ user, meta, onLogout }) {
  const [tab, setTab] = useState("home");
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [loadError,   setLoadError]   = useState(null); // null | string — real network errors
  const [configError, setConfigError] = useState(null); // null | string — account config issues
  const [toast,     setToast]     = useState("");
  const loadRef = useRef(null);

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2200); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setConfigError(null);
      setData(await api.preMe());
    } catch (e) {
      const msg = e?.message ?? "";
      if (msg === "Unauthorized") return;
      if (msg.includes("No PRE Block")) setConfigError(msg);
      else setLoadError(msg || "Unable to connect to server");
    }
    finally { setLoading(false); }
  }, [showToast]);

  // Always keep loadRef current so socket handlers call the latest load closure
  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  // Real-time updates via WebSocket — replaces 15-second polling
  useEffect(() => {
    const socket = createSocket();
    const refresh = () => { loadRef.current(); };
    socket.on("bed:update",       refresh); // ward counts changed
    socket.on("round:submit",     refresh); // round submitted → alarm clears
    socket.on("alarm:active",     refresh); // scheduler fired → alarm state changed
    socket.on("ward:operational", refresh); // manager toggled ward operational status
    socket.on("connect",          refresh); // reconnect → catch missed updates
    return () => { socket.disconnect(); };
  }, []);

  const alarmActive = data?.alarm?.alarmActive;
  useEffect(() => {
    if (alarmActive) startAlarm(); else stopAlarm();
    return () => stopAlarm();
  }, [alarmActive]);

  const [submitting, setSubmitting] = useState(false);
  const submitRound = async () => {
    if (!data || submitting) return;
    const notReady = data.wards.filter(w => w.vacant === null);
    if (notReady.length > 0) {
      showToast(`Configure beds for ${notReady[0].ward} first`);
      setTab("entry");
      return;
    }
    setSubmitting(true);
    try {
      await api.submitRound();
      stopAlarm();
      showToast("Round submitted ✓");
      await loadRef.current();
      setTab("home");
    } catch (e) { showToast(toastErr(e)); }
    finally { setSubmitting(false); }
  };

  if (!data) {
    if (configError) return (
      <AppShell
        menu={[]}
        active=""
        onSelect={() => {}}
        title="PRE Dashboard"
        user={{ name: user.username, role: "PRE" }}
        onLogout={onLogout}
      >
        <div className="card empty" style={{ marginTop: 40 }}>
          <Ic d={icons.bed} s={32} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>No PRE Block assigned</div>
          <div style={{ fontSize: 12, marginTop: 4, color: "var(--ink-3)" }}>{configError}. Contact your manager.</div>
        </div>
        {toast && <div className="toast">{toast}</div>}
      </AppShell>
    );
    return (
      <div className="empty" style={{ paddingTop: 120 }}>
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
            <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
            <div className="dim" style={{ marginTop: 12 }}>Loading…</div>
          </>
        )}
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  const menu = [
    { key: "home",  icon: icons.home, label: "Home" },
    { key: "entry", icon: icons.bed,  label: "Entry", dot: alarmActive },
    { key: "map",   icon: icons.map,  label: "Map" },
  ];

  return (
    <AppShell
      menu={menu}
      active={tab}
      onSelect={setTab}
      title={TAB_TITLES[tab]}
      user={{ name: user.username || data.pre, role: "PRE" }}
      onLogout={onLogout}
      alarm={alarmActive}
      topExtra={
        <span className="pre-pill" style={{ flexDirection: "column", gap: 1, lineHeight: 1.2, padding: "5px 9px" }}>
          <span style={{ fontSize: 11 }}><Ic d={icons.clock} s={11} /> {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })}</span>
          <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{new Date().toLocaleDateString("en-GB")}</span>
        </span>
      }
    >
      {tab === "home"  && <Home {...{ data, meta, setTab, alarmActive }} />}
      {tab === "entry" && <Entry data={data} submitRound={submitRound} submitting={submitting} alarmActive={alarmActive} onRefresh={load} />}
      {tab === "map"   && <MyMap data={data} />}

      {toast && <div className="toast">{toast}</div>}
    </AppShell>
  );
}

function Home({ data, setTab, alarmActive }) {
  const s = data.summary;
  const round = data.alarm.round;
  const pct = s.wards > 0 ? Math.round((s.wardsDone / s.wards) * 100) : 0;
  const reported = s.wardsDone > 0;
  const isMorning = data.alarm.shift === "morning";

  return (
    <div>
      {/* Row 1 — context info cards */}
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="n" style={{ fontSize: 18 }}>{data.floor || "—"}</div>
          <div className="l">BLOCK</div>
        </div>
        <div className="stat">
          <div className="n" style={{ fontSize: 18, display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ color: isMorning ? "var(--amber)" : "var(--blue)", display: "inline-flex" }}>
              <Ic d={isMorning ? icons.sun : icons.moon} s={16} />
            </span>
            {isMorning ? "Morning" : "Night"}
          </div>
          <div className="l">SHIFT · {data.alarm.shiftWindow || (isMorning ? "Morning" : "Night")}</div>
        </div>
        <div className="stat">
          <div>
            <div className="n" style={{ fontSize: 18 }}>{pct}%</div>
            <div className="bar" style={{ marginTop: 8 }}>
              <span style={{ flex: pct, background: "var(--primary)" }} />
              <span style={{ flex: 100 - pct, background: "var(--panel-2)" }} />
            </div>
          </div>
          <div className="l">ROUND PROGRESS</div>
        </div>
        <div className="stat">
          <div className="n" style={{ fontSize: 18 }}>{s.wardsDone}/{s.wards}</div>
          <div className="l">WARDS UPDATED</div>
        </div>
      </div>

      {alarmActive && (
        <div className="alarm-banner slide-up">
          <div className="row">
            <span className="pulse" style={{ color: "var(--red)" }}><Ic d={icons.bell} s={24} /></span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--red)" }}>Round update due</div>
              <div style={{ fontSize: 12, color: "#DC2626" }}>Alarm rings until you submit this round</div>
            </div>
          </div>
          <button className="btn btn-primary btn-block" style={{ marginTop: 14, maxWidth: 360 }} onClick={() => setTab("entry")}>
            Enter bed status now
          </button>
          <div style={{ fontSize: 11, color: "#DC2626", marginTop: 9 }}>
            Window {fmtClock(round.startMin)} – {fmtClock(round.endMin)}
          </div>
        </div>
      )}

      {!alarmActive && data.alarm.submitted && (
        <div className="card slide-up" style={{ padding: 16, borderColor: "var(--st-v)", background: "var(--st-v-bg)", marginBottom: 14 }}>
          <div className="row"><span style={{ color: "var(--st-v)" }}><Ic d={icons.check} s={22} /></span>
            <div><div style={{ fontWeight: 700, color: "var(--st-v)" }}>This round submitted</div>
              <div style={{ fontSize: 12, color: "var(--st-v)" }}>Next round at {fmtClock(round.endMin)}</div></div></div>
        </div>
      )}

      {!data.alarm.onDuty && (
        <div className="card slide-up" style={{ padding: 16, marginBottom: 14 }}>
          <div className="row"><span className="dim"><Ic d={icons.clock} s={22} /></span>
            <div><div style={{ fontWeight: 700 }}>Off shift</div>
              <div className="dim" style={{ fontSize: 12 }}>No alarms outside your shift hours</div></div></div>
        </div>
      )}

      {/* Row 2 — wards summary */}
      <div className="floor-head">Wards summary</div>
      <div className="stat-grid">
        <div className="stat"><div className="n" style={{ color: "var(--st-v)"  }}>{reported ? s.v  : "–"}</div><div className="l">VACANT</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--st-vr)" }}>{reported ? s.r  : "–"}</div><div className="l">VAC + RES</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--st-o)"  }}>{reported ? s.o  : "–"}</div><div className="l">OCCUPIED</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--st-or)" }}>{reported ? s.or : "–"}</div><div className="l">OCC + RES</div></div>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 14 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="h2">Round completion</span>
          <span className="chip">{s.wardsDone}/{s.wards} wards</span>
        </div>
        <div className="bar"><span style={{ flex: pct, background: "var(--primary)" }} /><span style={{ flex: 100 - pct, background: "var(--panel-2)" }} /></div>
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

// ══════════════════════════════════════════════════════════════════════════════
//  ENTRY TAB — ward cards with live counts + View/Manage beds
// ══════════════════════════════════════════════════════════════════════════════
function Entry({ data, submitRound, submitting, alarmActive, onRefresh }) {
  const [bedModal, setBedModal] = useState(null); // { ward, tab } | null

  if (data.wards.length === 0)
    return (
      <div className="card empty">
        <Ic d={icons.bed} s={28} />
        <div style={{ marginTop: 10, fontWeight: 600 }}>No wards to enter</div>
      </div>
    );

  const round = data.alarm.round;
  // Non-operational wards are visible but excluded from the "done" requirement
  const opWards = data.wards.filter(w => w.operational !== false);
  const allDone = opWards.every(w => w.vacant !== null);
  const doneCount = opWards.filter(w => w.vacant !== null).length;

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="h1" style={{ fontSize: 18 }}>Bed entry</div>
        <span className="chip">{fmtClock(round.startMin)}–{fmtClock(round.endMin)}</span>
      </div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        Open each ward to manage individual bed status, then submit.
      </div>

      <div className="card-grid">
        {data.wards.map((w, i) => {
          const entered = w.vacant !== null;
          const nonOp = w.operational === false;
          return (
            <div className="ward-card slide-up" key={w.id}
              style={{
                animationDelay: i * 0.03 + "s",
                borderColor: nonOp ? "var(--line)" : entered ? "var(--st-v)" : "var(--line)",
                padding: 16,
                display: "flex", flexDirection: "column",
                opacity: nonOp ? 0.75 : 1,
              }}>
              {/* Header */}
              <div className="row between" style={{ marginBottom: (entered && !nonOp) ? 14 : 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{w.ward}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {w.total} beds
                    {!nonOp && entered && <span style={{ color: "var(--st-v)" }}> · complete</span>}
                  </div>
                </div>
                {nonOp
                  ? <span className="tag" style={{ background: "var(--warn-bg, #fff3cd)", color: "var(--warn, #b45309)" }}>
                      <Ic d={icons.alert} s={12} /> Non-op
                    </span>
                  : entered
                    ? <span className="tag v"><Ic d={icons.check} s={12} /> ok</span>
                    : <span className="tag b">no data</span>}
              </div>

              {/* Non-operational warning */}
              {nonOp && (
                <div style={{
                  background: "var(--panel-2)", borderRadius: 10, padding: "12px 14px",
                  display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14,
                }}>
                  <Ic d={icons.alert} s={15} style={{ color: "var(--warn, #b45309)", flexShrink: 0, marginTop: 1 }} />
                  <div className="dim" style={{ fontSize: 12 }}>
                    Ward non-operational — excluded from this round.
                  </div>
                </div>
              )}

              {/* Stats block */}
              {entered && !nonOp && (
                <div style={{
                  display: "flex",
                  background: "var(--panel-2)",
                  borderRadius: 10,
                  overflow: "hidden",
                  marginBottom: 14,
                }}>
                  {[
                    { label: "Vacant",   val: w.vacant,             color: "var(--st-v)"  },
                    { label: "Vac+Res",  val: w.reserved  ?? 0,     color: "var(--st-vr)" },
                    { label: "Occupied", val: w.occupied  ?? 0,     color: "var(--st-o)"  },
                    { label: "Occ+Res",  val: w.occupied_reserved ?? 0, color: "var(--st-or)" },
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
                      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{val}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              {!nonOp && (
                <div className="row" style={{ gap: 8, marginTop: "auto" }}>
                  <button className="btn btn-ghost" style={{ flex: 1, padding: "9px 0", fontSize: 13 }}
                    onClick={() => setBedModal({ ward: w, tab: "view" })}>
                    <Ic d={icons.grid} s={13} /> View Beds
                  </button>
                  <button className="btn btn-primary" style={{ flex: 1, padding: "9px 0", fontSize: 13 }}
                    onClick={() => setBedModal({ ward: w, tab: "manage" })}>
                    <Ic d={icons.bed} s={13} /> Manage Beds
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        className={"btn btn-primary btn-block" + (alarmActive ? " pulse" : "")}
        style={{ marginTop: 16, maxWidth: 420, marginLeft: "auto", marginRight: "auto", display: "flex" }}
        onClick={submitRound}
        disabled={submitting}>
        {submitting
          ? <><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={18} /></span> Submitting…</>
          : <><Ic d={icons.check} s={18} /> Submit this round</>}
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
  const enteredBeds = s.v + s.r + s.o + s.or;
  const occPct = enteredBeds > 0 ? Math.round((s.o + s.or) / enteredBeds * 100) : 0;

  return (
    <div>
      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>My ward map</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>{data.floor} · {data.pre} · {s.wards} wards · {s.total} beds</div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="h2">My occupancy</span>
          <span className="chip mono">{occPct}% full</span>
        </div>
        <StatusBar v={s.v} r={s.r} o={s.o} or={s.or} total={s.total} />
        <div className="row" style={{ gap: 12, marginTop: 10, flexWrap: "wrap" }}>
          <span className="tag v">{s.v} vacant</span>
          <span className="tag r">{s.r} vac+res</span>
          <span className="tag o">{s.o} occupied</span>
          {s.or > 0 && <span className="tag or">{s.or} occ+res</span>}
        </div>
      </div>

      <div className="floor-head">Wards ({s.wardsDone}/{s.wards} updated)</div>
      <div className="card-grid">
        {data.wards.map((w) => {
          const entered = w.vacant !== null;
          const wEntered = entered ? w.vacant + (w.occupied || 0) + (w.reserved || 0) + (w.occupied_reserved || 0) : 0;
          const wPct = wEntered > 0 ? Math.round(((w.occupied || 0) + (w.occupied_reserved || 0)) / wEntered * 100) : 0;
          const full = entered && (w.occupied || 0) === w.total;
          return (
            <div className="ward-card" key={w.ward} style={{ borderColor: full ? "var(--st-o)" : entered ? "var(--st-v)" : "var(--line)" }}>
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
                  ? <span className="tag" style={{ background: full ? "var(--st-o-bg)" : "var(--panel-2)", color: full ? "var(--st-o)" : "var(--ink-2)" }}>
                      {full ? "FULL" : wPct + "% full"}
                    </span>
                  : <span className="tag b">not entered</span>}
              </div>
              {entered && (
                <>
                  <StatusBar v={w.vacant} r={w.reserved} o={w.occupied} or={w.occupied_reserved ?? 0} total={w.total} />
                  <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <span className="tag v">{w.vacant} vacant</span>
                    <span className="tag r">{w.reserved} vac+res</span>
                    <span className="tag o">{w.occupied} occupied</span>
                    {(w.occupied_reserved ?? 0) > 0 && <span className="tag or">{w.occupied_reserved} occ+res</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Bed tile — name + status label, status-tinted ─────────────────────────────
const BedGridCard = React.memo(function BedGridCard({ bed, onClick }) {
  const color = bedStateColor(bed.physical_status, bed.reservation_status);
  const bg    = bedStateBg(bed.physical_status, bed.reservation_status);
  const dimmed = bed.operational_status === false;
  return (
    <div
      className={"bed-tile" + (onClick ? " tap" : "")}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      style={{ borderColor: color, background: bg, opacity: dimmed ? 0.5 : 1 }}
    >
      <span className="bname">{bed.bed_name}</span>
      <span className="bstate" style={{ color }}>{bedStateShort(bed.physical_status, bed.reservation_status)}</span>
      {bed.physical_status === "OCCUPIED" && bed.payer_type && (
        <span style={{ fontSize: 9, fontWeight: 700, color: "var(--primary)", lineHeight: 1.1,
          maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {bed.payer_type}
        </span>
      )}
    </div>
  );
});

// ── Bed status dialog — centered popup ────────────────────────────────────────
function BedDetailSheet({ bed, onSave, onClose }) {
  const [physical,    setPhysical]    = useState(bed.physical_status);
  const [reservation, setReservation] = useState(bed.reservation_status);
  const [payer,       setPayer]       = useState(bed.payer_type || "");
  const [payerTypes,  setPayerTypes]  = useState([]);
  const [saving,      setSaving]      = useState(false);

  const color = bedStateColor(physical, reservation);

  useEffect(() => {
    api.prePayerTypes().then(r => setPayerTypes(r.payerTypes || [])).catch(() => {});
  }, []);

  const handleSetPhysical = (val) => {
    setPhysical(val);
    if (val === "VACANT") setPayer("");
  };

  const needsPayer = physical === "OCCUPIED";
  const payerLocked = physical === "OCCUPIED" && reservation === "RESERVED" && bed.physical_status === "OCCUPIED";

  async function handleSave() {
    if (needsPayer && !payer && !payerLocked) return;
    setSaving(true);
    const payerArg = physical === "VACANT" ? null : (payerLocked && payer === (bed.payer_type || "") ? undefined : payer || null);
    await onSave(bed.id, physical, reservation, payerArg);
    setSaving(false);
    onClose();
  }

  const infoCols = [
    ["Bed Type",    bed.bed_type || "Census"],
    ...(bed.unit_type ? [["Unit", bed.unit_type]] : []),
    ["Operational", bed.operational_status !== false ? "Yes" : "No"],
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1100, padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: "var(--panel)",
        borderRadius: 16,
        width: "100%", maxWidth: 400,
        maxHeight: "90vh", overflowY: "auto",
        animation: "slideUp .18s both",
        boxShadow: "0 8px 40px rgba(0,0,0,0.22)",
      }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="row between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Update Bed Status — {bed.bed_name}</div>
          <button className="appbar-btn" onClick={onClose} aria-label="Close" style={{ width: 30, height: 30 }}>✕</button>
        </div>

        <div style={{ padding: "16px 20px 20px" }}>
          {/* Info strip */}
          <div style={{
            display: "flex", borderRadius: 10, overflow: "hidden",
            background: "var(--panel-2)", marginBottom: 18,
          }}>
            {infoCols.map(([label, val], i) => (
              <div key={label} style={{
                flex: 1, padding: "9px 8px", textAlign: "center",
                borderLeft: i > 0 ? "1px solid var(--line)" : "none",
              }}>
                <div style={{ fontSize: 9.5, color: "var(--ink-3)", fontWeight: 700, letterSpacing: .4, textTransform: "uppercase" }}>{label}</div>
                <div style={{
                  fontSize: 12, fontWeight: 700, marginTop: 3,
                  color: label === "Operational" ? (val === "Yes" ? "var(--st-v)" : "var(--st-or)") : "var(--ink)",
                }}>{val}</div>
              </div>
            ))}
            <div style={{ flex: 1.2, padding: "9px 8px", textAlign: "center", borderLeft: "1px solid var(--line)" }}>
              <div style={{ fontSize: 9.5, color: "var(--ink-3)", fontWeight: 700, letterSpacing: .4, textTransform: "uppercase" }}>Current</div>
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 3, color }}>{bedStateShort(physical, reservation)}</div>
            </div>
          </div>

          {/* Physical Status */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
              Physical Status
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["VACANT","var(--st-v)","Vacant"],["OCCUPIED","var(--st-o)","Occupied"]].map(([val, c, lbl]) => (
                <button key={val} onClick={() => handleSetPhysical(val)} style={{
                  flex: 1, padding: "11px 0", borderRadius: 10, fontSize: 14, fontWeight: 700,
                  border: `2px solid ${physical === val ? c : "var(--line)"}`,
                  background: physical === val ? c : "transparent",
                  color: physical === val ? "#fff" : "var(--ink-2)",
                  cursor: "pointer", transition: "all 0.15s",
                }}>{lbl}</button>
              ))}
            </div>
          </div>

          {/* Reservation Status */}
          <div style={{ marginBottom: physical === "OCCUPIED" ? 16 : 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
              Reservation Status
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["NONE","var(--ink-2)","None"],["RESERVED","var(--st-vr)","Reserved"]].map(([val, c, lbl]) => (
                <button key={val} onClick={() => setReservation(val)} style={{
                  flex: 1, padding: "11px 0", borderRadius: 10, fontSize: 14, fontWeight: 700,
                  border: `2px solid ${reservation === val ? c : "var(--line)"}`,
                  background: reservation === val ? c : "transparent",
                  color: reservation === val ? "#fff" : "var(--ink-2)",
                  cursor: "pointer", transition: "all 0.15s",
                }}>{lbl}</button>
              ))}
            </div>
          </div>

          {/* Payer type — shown only when OCCUPIED */}
          {physical === "OCCUPIED" && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
                Payer Type {!payerLocked && <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>}
              </div>
              {payerLocked ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: "var(--primary)" }}>{payer || "—"}</span>
                  <span className="dim" style={{ fontSize: 11 }}>(same patient — change if needed)</span>
                  <select className="field" value={payer} style={{ flex: 1, minWidth: 160, fontSize: 13 }}
                    onChange={(e) => setPayer(e.target.value)}>
                    <option value="">— Keep current —</option>
                    {payerTypes.map(pt => <option key={pt.id} value={pt.name}>{pt.name}</option>)}
                  </select>
                </div>
              ) : (
                <select className="field" value={payer}
                  onChange={(e) => setPayer(e.target.value)}
                  style={{ borderColor: needsPayer && !payer ? "var(--red)" : undefined }}>
                  <option value="">— Select payer type —</option>
                  {payerTypes.map(pt => <option key={pt.id} value={pt.name}>{pt.name}</option>)}
                </select>
              )}
              {needsPayer && !payer && !payerLocked && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Payer type is required for occupied beds.</div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" style={{ padding: "10px 18px" }} onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" style={{ padding: "10px 18px" }}
              disabled={saving || (needsPayer && !payer && !payerLocked)}
              onClick={handleSave}>
              {saving ? "Saving…" : "Update Status"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRE BED MODAL  (View + Manage tabs — bed tile grid)
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
    try {
      const result = await api.preBeds(ward.id);
      // Annotate beds with ward-level unit_type so filter + badges work uniformly
      const unitType = ward.unit_type || null;
      setBeds((result.beds || []).map(b => ({ ...b, unit_type: unitType })));
    }
    catch (e) { showToast(toastErr(e)); }
    finally { setLoading(false); }
  }, [ward.id, ward.unit_type, showToast]);

  useEffect(() => { load(); }, [load]);

  const sortedBeds = [...beds].sort((a, b) => {
    return naturalSort(a.bed_name, b.bed_name);
  });

  const displayed = sortedBeds.filter(b => {
    if (filter === "KIMS")     return b.unit_type === "KIMS";
    if (filter === "Renova")   return b.unit_type?.includes("Renova");
    if (filter === "Op")       return !!b.operational_status;
    if (filter === "Non-Op")   return !b.operational_status;
    if (filter === "Vacant")   return b.physical_status === "VACANT";
    if (filter === "Occupied") return b.physical_status === "OCCUPIED";
    if (filter === "Reserved") return b.reservation_status === "RESERVED";
    return true;
  });

  // Optimistic update — snapshot restored on failure; unit_type preserved via spread
  const changeStatus = useCallback(async (bedId, physicalStatus, reservationStatus, payerType) => {
    let snapshot;
    setBeds(prev => {
      snapshot = prev;
      return prev.map(b => b.id === bedId
        ? { ...b, physical_status: physicalStatus, reservation_status: reservationStatus, payer_type: physicalStatus === "VACANT" ? null : (payerType ?? b.payer_type) }
        : b);
    });
    try {
      await api.preUpdateBedStatus(bedId, physicalStatus, reservationStatus, payerType);
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
  function BedGrid({ clickable }) {
    const fc = { ALL: sortedBeds.length, KIMS: 0, Renova: 0, Op: 0, "Non-Op": 0, Vacant: 0, Occupied: 0, Reserved: 0 };
    for (const b of sortedBeds) {
      if (b.unit_type?.includes("Renova")) fc["Renova"]++;
      else if (b.unit_type === "KIMS") fc["KIMS"]++;
      if (b.operational_status !== false) fc["Op"]++; else fc["Non-Op"]++;
      if (b.physical_status === "VACANT") fc["Vacant"]++; else fc["Occupied"]++;
      if (b.reservation_status === "RESERVED") fc["Reserved"]++;
    }
    const CHIPS = [
      { key: "ALL",      label: "All"         },
      { key: "KIMS",     label: "KIMS"        },
      { key: "Renova",   label: "Renova"      },
      { key: "Op",       label: "Operational" },
      { key: "Non-Op",   label: "Non-Op"      },
      { key: "Vacant",   label: "Vacant"      },
      { key: "Occupied", label: "Occupied"    },
      { key: "Reserved", label: "Reserved"    },
    ];
    return (
      <>
        {/* Filter chips — compact, wrap automatically */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {CHIPS.map(({ key, label }) => (
            <button key={key} className={"fchip" + (filter === key ? " on" : "")} onClick={() => setFilter(key)}>
              {label}{fc[key] > 0 ? ` (${fc[key]})` : ""}
            </button>
          ))}
        </div>

        {/* Grid */}
        {displayed.length === 0 ? (
          <div className="dim" style={{ textAlign: "center", padding: "18px 0", fontSize: 13 }}>
            No beds in this filter
          </div>
        ) : (
          <div className="bed-grid">
            {displayed.map((bed) => (
              <BedGridCard
                key={bed.id}
                bed={bed}
                onClick={clickable && bed.operational_status !== false ? () => setEditingBed(bed) : undefined}
              />
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="row" style={{ gap: 14, marginTop: 14, flexWrap: "wrap" }}>
          {[
            ["Vacant", "var(--st-v)"], ["Vacant + Reserved", "var(--st-vr)"],
            ["Occupied", "var(--st-o)"],
          ].map(([lbl, c]) => (
            <span key={lbl} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-2)", fontWeight: 600 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: c }} />{lbl}
            </span>
          ))}
        </div>
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
            <button className="chip" onClick={onClose}>✕ Close</button>
          </div>

          {/* Tab bar */}
          <div className="seg" style={{ marginBottom: 14, maxWidth: 320 }}>
            <button className={tab === "view" ? "on" : ""} onClick={() => setTab("view")}>
              <Ic d={icons.grid} s={14} /> View
            </button>
            <button className={tab === "manage" ? "on" : ""} onClick={() => setTab("manage")}>
              <Ic d={icons.bed} s={14} /> Manage
            </button>
          </div>

          {/* Tab content */}
          {loading ? spinner : beds.length === 0 ? emptyState : <BedGrid clickable={tab === "manage"} />}
        </div>
      </div>

      {/* Bed edit dialog — rendered outside the sheet so it overlays everything */}
      {editingBed && (
        <BedDetailSheet
          bed={editingBed}
          onSave={async (bedId, physical, reservation, payer) => {
            setEditingBed(prev => ({ ...prev, physical_status: physical, reservation_status: reservation, payer_type: physical === "VACANT" ? null : (payer ?? prev.payer_type) }));
            await changeStatus(bedId, physical, reservation, payer);
          }}
          onClose={() => setEditingBed(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
