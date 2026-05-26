import React, { useState, useEffect, useRef } from "react";
import { api, startAlarm, stopAlarm, fmtTime, fmtClock } from "./lib.js";
import { Ic, icons, StatusBar } from "./ui.jsx";

export default function PREApp({ user, meta, onLogout }) {
  const [tab, setTab] = useState("home");
  const [data, setData] = useState(null);
  const [toast, setToast] = useState("");
  const [draft, setDraft] = useState({}); // local edits before submit: {ward:{v,o,r}}
  const pollRef = useRef(null);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  const load = async () => {
    try {
      const d = await api.preMe();
      setData(d);
      // hydrate draft from server values (only for wards not locally edited)
      setDraft((prev) => {
        const next = { ...prev };
        for (const w of d.wards) {
          if (next[w.ward] === undefined) {
            next[w.ward] = w.vacant === null ? { v: null, r: null }
              : { v: w.vacant, r: w.reserved };
          }
        }
        return next;
      });
    } catch (e) { /* token expiry handled by 401 -> caller can re-login */ }
  };

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 15000); // live refresh
    return () => clearInterval(pollRef.current);
  }, []);

  const alarmActive = data?.alarm?.alarmActive;
  useEffect(() => {
    if (alarmActive) startAlarm(); else stopAlarm();
    return () => stopAlarm();
  }, [alarmActive]);

  const setWardDraft = (ward, patch) =>
    setDraft((d) => ({ ...d, [ward]: { ...d[ward], ...patch } }));

  // saveWard takes the ward's numeric id + vacant/reserved; backend auto-calcs occupied.
  const saveWard = async (wardId, v, r) => {
    try {
      await api.setWard(wardId, v || 0, r || 0);
    } catch (e) { showToast(e.message); }
  };

  const submitRound = async () => {
    // Auto-calc model: each ward needs vacant + reserved entered; occupied is derived.
    if (!data) return;
    for (const w of data.wards) {
      const dw = draft[w.ward];
      if (!dw || (dw.v === null && dw.r === null)) { showToast("Enter all wards first"); setTab("entry"); return; }
      const v = dw.v || 0, r = dw.r || 0;
      if (v + r > w.total) { showToast(`${w.ward}: vacant + reserved exceed ${w.total}`); setTab("entry"); return; }
    }
    try {
      for (const w of data.wards) {
        const v = draft[w.ward].v || 0, r = draft[w.ward].r || 0;
        await api.setWard(w.id, v, r);
      }
      await api.submitRound();
      stopAlarm();
      showToast("Round submitted ✓");
      await load();
      setTab("home");
    } catch (e) { showToast(e.message); }
  };

  if (!data) return <div className="app"><div className="empty" style={{ paddingTop: 120 }}><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span><div style={{ marginTop: 12 }}>Loading…</div></div></div>;

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
          <span className="pre-pill">
            <Ic d={icons.clock} s={13} />
            {new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true
            })}
          </span>
          <button className="btn btn-ghost" style={{ padding: 9 }} onClick={onLogout}><Ic d={icons.logout} s={17} /></button>
        </div>
      </div>

      <div className="pad" style={{ paddingBottom: 90 }}>
        {tab === "home" && <Home {...{ data, meta, setTab, alarmActive }} />}
        {tab === "entry" && <Entry {...{ data, draft, setWardDraft, saveWard, submitRound, alarmActive }} />}
        {tab === "map" && <MyMap data={data} />}
      </div>

      <div className="navbar">
        <NavBtn on={tab === "home"} ic={icons.home} label="Home" onClick={() => setTab("home")} />
        <NavBtn on={tab === "entry"} ic={icons.bed} label="Entry" dot={alarmActive} onClick={() => setTab("entry")} />
        <NavBtn on={tab === "map"} ic={icons.map} label="Map" onClick={() => setTab("map")} />
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
              <div style={{ fontWeight: 700, fontSize: 15, color: "#ffd7dd" }}>Round update due</div>
              <div style={{ fontSize: 12, color: "#ffb0bb" }}>Alarm rings until you submit this round</div>
            </div>
          </div>
          <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={() => setTab("entry")}>
            Enter bed status now
          </button>
          <div style={{ fontSize: 11, color: "#ff9aa6", marginTop: 9, textAlign: "center" }}>
            Window {fmtClock(round.startMin)} – {fmtClock(round.endMin)}
          </div>
        </div>
      )}

      {!alarmActive && data.alarm.submitted && (
        <div className="card slide-up" style={{ padding: 16, borderColor: "var(--teal-deep)", background: "var(--green-bg)" }}>
          <div className="row"><span style={{ color: "var(--green)" }}><Ic d={icons.check} s={22} /></span>
            <div><div style={{ fontWeight: 700, color: "var(--green)" }}>This round submitted</div>
              <div style={{ fontSize: 12, color: "#7fd9b6" }}>Next round at {fmtClock(round.endMin)}</div></div></div>
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

function Entry({ data, draft, setWardDraft, saveWard, submitRound, alarmActive }) {
  if (data.wards.length === 0)
    return <div className="card empty"><Ic d={icons.bed} s={28} /><div style={{ marginTop: 10, fontWeight: 600 }}>No wards to enter</div></div>;
  const round = data.alarm.round;

  // total beds across all this PRE's wards, and live entered tally
  const totalBeds = data.wards.reduce((a, w) => a + w.total, 0);
  let enteredV = 0, enteredR = 0, enteredBeds = 0;
  for (const w of data.wards) {
    const dw = draft[w.ward];
    if (dw && (dw.v !== null || dw.r !== null)) {
      const v = dw.v || 0, r = dw.r || 0;
      enteredV += v; enteredR += r; enteredBeds += w.total;
    }
  }
  const enteredO = Math.max(0, enteredBeds - enteredV - enteredR);

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="h1" style={{ fontSize: 18 }}>Bed entry</div>
        <span className="chip">{fmtClock(round.startMin)}–{fmtClock(round.endMin)}</span>
      </div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
        Enter <b style={{ color: "var(--green)" }}>Vacant</b> and <b style={{ color: "var(--amber)" }}>Reserved</b> for each ward.
        <b style={{ color: "var(--red)" }}> Occupied</b> is calculated automatically from the total.
      </div>

      {/* NEW: total bed count summary */}
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="h2">Total beds</span>
          <span className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--teal)" }}>{totalBeds}</span>
        </div>
        <StatusBar v={enteredV} o={enteredO} r={enteredR} total={totalBeds} />
        <div className="row" style={{ gap: 12, marginTop: 10 }}>
          <span className="tag v">{enteredV} vacant</span>
          <span className="tag o">{enteredO} occupied</span>
          <span className="tag r">{enteredR} reserved</span>
        </div>
        <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>{data.wards.length} wards · {totalBeds} beds total</div>
      </div>

      {data.wards.map((w, i) => {
        // Auto-calc model: Vacant + Reserved are inputs; Occupied = total − vacant − reserved.
        const dw = draft[w.ward] || { v: null, r: null };
        const entered = dw.v !== null || dw.r !== null;
        const v = dw.v || 0, r = dw.r || 0;
        const occupied = Math.max(0, w.total - v - r);
        const overflow = v + r > w.total; // entered more vacant+reserved than beds exist
        const ok = entered && !overflow;
        const step = (field) => (delta) => {
          const cur = { v: dw.v || 0, r: dw.r || 0 };
          let nv = Math.max(0, (cur[field] || 0) + delta);
          const other = field === "v" ? cur.r : cur.v;
          if (nv + other > w.total) nv = w.total - other; // clamp so it never exceeds total
          const next = { ...cur, [field]: nv };
          setWardDraft(w.ward, next);
          // persist vacant + reserved; backend computes occupied
          setTimeout(() => saveWard(w.id, next.v, next.r), 200);
        };
        return (
          <div className="ward-card slide-up" key={w.ward}
            style={{ animationDelay: i * 0.03 + "s", borderColor: ok ? "var(--teal-deep)" : overflow ? "var(--red)" : "var(--line)" }}>
            <div className="row between" style={{ marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{w.ward}</div>
                <div className="dim" style={{ fontSize: 12 }}>{w.total} beds {ok && <span style={{ color: "var(--green)" }}>· complete</span>}</div>
              </div>
              {!entered ? <span className="tag b">not entered</span>
                : overflow ? <span className="tag o">over by {v + r - w.total}</span>
                  : <span className="tag v"><Ic d={icons.check} s={12} /> ok</span>}
            </div>
            <Counter label="Vacant" color="var(--green)" val={dw.v} onStep={step("v")} />
            <Counter label="Reserved" color="var(--amber)" val={dw.r} onStep={step("r")} />
            {/* Occupied is auto-calculated — shown, not editable */}
            <div className="row between" style={{ padding: "10px 0 2px", marginTop: 4, borderTop: "1px solid var(--line)" }}>
              <div className="row" style={{ gap: 9 }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: "var(--red)" }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>Occupied <span className="dim" style={{ fontWeight: 400, fontSize: 11 }}>· auto</span></span>
              </div>
              <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: overflow ? "var(--red)" : "var(--red)" }}>
                {entered ? occupied : "–"}
              </span>
            </div>
          </div>
        );
      })}

      <button className={"btn btn-primary btn-block" + (alarmActive ? " pulse" : "")} style={{ marginTop: 6 }} onClick={submitRound}>
        <Ic d={icons.check} s={18} /> Submit this round
      </button>
      <div style={{ height: 14 }} />
    </div>
  );
}

function Counter({ label, color, val, onStep }) {
  return (
    <div className="row between" style={{ padding: "7px 0" }}>
      <div className="row" style={{ gap: 9 }}>
        <span style={{ width: 9, height: 9, borderRadius: 99, background: color }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
      </div>
      <div className="stepper">
        <button onClick={() => onStep(-1)}>–</button>
        <span className="val mono" style={{ color: val === null ? "var(--ink-3)" : color }}>{val === null ? "–" : val}</span>
        <button onClick={() => onStep(1)}>+</button>
      </div>
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

      {/* floor summary header */}
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
        const wEntered = entered ? w.vacant + w.occupied + w.reserved : 0;
        const wPct = wEntered > 0 ? Math.round((w.occupied / wEntered) * 100) : 0;
        const full = entered && w.occupied === w.total;
        return (
          <div className="ward-card" key={w.ward} style={{ borderColor: full ? "var(--red)" : entered ? "var(--teal-deep)" : "var(--line)" }}>
            <div className="row between" style={{ marginBottom: entered ? 10 : 0 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{w.ward}</div>
                <div className="dim" style={{ fontSize: 11 }}>
                  {w.total} beds{entered && w.updatedAt ? ` · updated ${new Date(w.updatedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true
                  })}` : ""}
                </div>
              </div>
              {entered
                ? <span className="tag" style={{ background: full ? "var(--red-bg)" : "var(--panel-2)", color: full ? "var(--red)" : "var(--ink-2)" }}>{full ? "FULL" : wPct + "% full"}</span>
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
