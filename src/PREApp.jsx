import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { api, startAlarm, stopAlarm, fmtTime, fmtClock, fmtRelative, toastErr, createSocket } from "./lib.js";
import { Ic, icons, StatusBar, ThemeToggle, useModal } from "./ui.jsx";
import { AppShell, useProfileMenuSlot } from "./shell.jsx";
import { naturalSort, bedStateColor, bedStateBg, bedStateShort, calculateWardTotals, dischargeBadge, dischargeProgress, fmtIpLast6, bedCurrentStatus } from "./bedUtils.js";
import DischargeTab, { TransferSection } from "./DischargeTab.jsx";
import DischargeMiniWidget from "./DischargeMiniWidget.jsx";
import DischargesPage from "./DischargesPage.jsx";

const TAB_TITLES = { home: "Dashboard", entry: "Entry — Wards", discharges: "Discharges", map: "My Ward Map" };

// Role configuration for the shared ward/bed pages. Nurse and Doctor reuse the exact
// same pages (WardPage → bed page → discharge pages) with their own endpoints — only
// the role string and API functions differ; layout/UX is identical everywhere.
export const PRE_CFG = {
  role: "PRE",
  listBeds: (wardId) => api.preBeds(wardId),
  updateBedStatus: (...a) => api.preUpdateBedStatus(...a),
  payerTypes: () => api.prePayerTypes(),
  destinations: () => api.preDestinations(),
};

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
    socket.on("discharge:update", refresh); // discharge step/plan/transfer changed
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
    } catch (e) { showToast(toastErr(e)); }
    finally { setSubmitting(false); }
  };

  if (!data) {
    if (configError) return (
      <div className="preui">
        <AppShell
          menu={[]}
          active=""
          onSelect={() => {}}
          title="PRE Dashboard"
          user={{ name: user.username, role: "PRE" }}
          onLogout={onLogout}
        >
          <div className="card empty" style={{ marginTop: 40, padding: 32 }}>
            <Ic d={icons.bed} s={32} />
            <div style={{ marginTop: 12, fontWeight: 700, fontSize: 15 }}>No PRE Block assigned</div>
            <div style={{ fontSize: 13, marginTop: 6, color: "var(--ink-3)" }}>{configError}. Contact your manager.</div>
          </div>
          {toast && <div className="toast">{toast}</div>}
        </AppShell>
      </div>
    );
    if (loadError) return (
      <div className="preui">
        <div className="empty" style={{ paddingTop: 120 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Unable to connect to server</div>
          <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>Check your network and try again.</div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={load}>
            <Ic d={icons.refresh} s={15} /> Retry
          </button>
          {toast && <div className="toast">{toast}</div>}
        </div>
      </div>
    );
    // Skeleton screen — mirrors the Home layout so content doesn't jump when it lands.
    return (
      <div className="preui">
        <div style={{ padding: "24px 20px", maxWidth: 1100, margin: "0 auto" }}>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            {[0, 1, 2, 3].map(i => <div key={i} className="preui-sk preui-sk-stat" />)}
          </div>
          <div className="preui-sk preui-sk-line" style={{ width: 140, marginBottom: 12 }} />
          <div className="card-grid">
            {[0, 1, 2].map(i => <div key={i} className="preui-sk preui-sk-card" />)}
          </div>
          {toast && <div className="toast">{toast}</div>}
        </div>
      </div>
    );
  }

  const menu = [
    { key: "home",       icon: icons.home,      label: "Home" },
    { key: "entry",      icon: icons.bed,       label: "Entry", dot: alarmActive },
    { key: "discharges", icon: icons.clipboard, label: "Discharges" },
    { key: "map",        icon: icons.map,       label: "Map" },
  ];

  return (
    <div className="preui">
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
        {tab === "discharges" && <DischargesPage role="PRE" wards={data.wards.map(w => ({ id: w.id, name: w.ward }))} />}
        {tab === "map"   && <MyMap data={data} />}

        <ProfileThemeRow />
        {toast && <div className="toast">{toast}</div>}
      </AppShell>
    </div>
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
          <div className="row" style={{ gap: 10 }}>
            <span className="ic"><Ic d={icons.building} s={16} /></span>
            <div className="n" style={{ fontSize: 18 }}>{data.floor || "—"}</div>
          </div>
          <div className="l">BLOCK</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 10 }}>
            <span className="ic" style={{ background: isMorning ? "var(--amber-bg)" : "var(--blue-bg)", color: isMorning ? "var(--amber)" : "var(--blue)" }}>
              <Ic d={isMorning ? icons.sun : icons.moon} s={16} />
            </span>
            <div className="n" style={{ fontSize: 18 }}>{isMorning ? "Morning" : "Night"}</div>
          </div>
          <div className="l">SHIFT · {data.alarm.shiftWindow || (isMorning ? "Morning" : "Night")}</div>
        </div>
        <div className="stat">
          <div>
            <div className="row" style={{ gap: 10 }}>
              <span className="ic"><Ic d={icons.chart} s={16} /></span>
              <div className="n" style={{ fontSize: 18 }}>{pct}%</div>
            </div>
            <div className="bar" style={{ marginTop: 8 }}>
              <span style={{ flex: pct, background: "var(--primary)" }} />
              <span style={{ flex: 100 - pct, background: "var(--panel-2)" }} />
            </div>
          </div>
          <div className="l">ROUND PROGRESS</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 10 }}>
            <span className="ic" style={{ background: "var(--st-v-bg)", color: "var(--st-v)" }}><Ic d={icons.check} s={16} /></span>
            <div className="n" style={{ fontSize: 18 }}>{s.wardsDone}/{s.wards}</div>
          </div>
          <div className="l">WARDS UPDATED</div>
        </div>
      </div>

      <DischargeMiniWidget />

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
  const [openWard, setOpenWard] = useState(null); // { ward, tab } | null
  const [wardFilter, setWardFilter] = useState("all"); // "all" | ward id

  // Full-page ward view — replaces the grid entirely (no popup stack).
  if (openWard) return (
    <WardPage
      ward={openWard.ward}
      initialTab={openWard.tab}
      allWards={data.wards}
      onBack={() => { setOpenWard(null); onRefresh(); }}
    />
  );

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

      {/* Ward picker — jump straight to one ward when the list is long */}
      {data.wards.length > 1 && (
        <select className="field" aria-label="Filter by ward" value={wardFilter}
          onChange={(e) => setWardFilter(e.target.value)}
          style={{ marginBottom: 14, maxWidth: 380, fontWeight: 600 }}>
          <option value="all">All wards ({data.wards.length})</option>
          {data.wards.map((w) => <option key={w.id} value={String(w.id)}>{w.ward}</option>)}
        </select>
      )}

      {(data.blocks ?? [{ id: data.preBlockId, name: "", wards: data.wards }]).map((block, bi) => {
        const visibleWards = block.wards.filter((w) => wardFilter === "all" || String(w.id) === wardFilter);
        if (visibleWards.length === 0) return null;
        return (
        <div key={block.id}>
          {(data.blocks ?? []).length > 1 && (
            <div className="floor-head" style={{ marginTop: bi > 0 ? 24 : 0, marginBottom: 12 }}>
              {block.name}
              <span className="chip" style={{ marginLeft: 8, fontSize: 11, verticalAlign: "middle" }}>
                {visibleWards.length} ward{visibleWards.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          <div className="card-grid">
            {visibleWards.map((w, i) => {
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
                        { label: "Vacant",   val: w.vacant,                color: "var(--st-v)"  },
                        { label: "Vac+Res",  val: w.reserved  ?? 0,        color: "var(--st-vr)" },
                        { label: "Occupied", val: w.occupied  ?? 0,        color: "var(--st-o)"  },
                        { label: "Occ+Res",  val: w.occupied_reserved ?? 0, color: "var(--st-or)" },
                      ].map(({ label, val, color }, idx) => (
                        <div key={label} style={{
                          flex: 1, textAlign: "center", padding: "12px 6px",
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

                  {/* Action buttons — each opens the full-page ward view on its tab */}
                  {!nonOp && (
                    <div className="row" style={{ gap: 8, marginTop: "auto", flexWrap: "wrap" }}>
                      <button className="btn btn-primary" style={{ flex: "1 1 110px", padding: "9px 0", fontSize: 13 }}
                        onClick={() => setOpenWard({ ward: w, tab: "manage" })}>
                        <Ic d={icons.bed} s={13} /> Manage Beds
                      </button>
                      <button className="btn btn-ghost" style={{ flex: "1 1 96px", padding: "9px 0", fontSize: 13 }}
                        onClick={() => setOpenWard({ ward: w, tab: "discharge" })}>
                        <Ic d={icons.clipboard} s={13} /> Discharges
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        );
      })}

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
          const wt = entered ? calculateWardTotals(w) : null;
          const wEntered = wt ? wt.totalBeds : 0;
          const wPct = wEntered > 0 ? Math.round((wt.totalOccupied / wEntered) * 100) : 0;
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

// ── Back button — one design for every PRE screen (square card + optional label) ──
export const BackBtn = ({ label, onClick, style }) => (
  <button className="pback" onClick={onClick} aria-label={label || "Back"} style={style}>
    <span className="bx"><Ic d={icons.chevron} s={20} style={{ transform: "rotate(180deg)" }} /></span>
    {label && <span>{label}</span>}
  </button>
);

// Theme control inside the profile dropdown — on phones the standalone appbar
// toggle is hidden (CSS) and this portal row becomes the way to switch themes.
export function ProfileThemeRow() {
  const slot = useProfileMenuSlot();
  if (!slot) return null;
  return createPortal(
    <div className="row between" style={{ padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Theme</span>
      <ThemeToggle />
    </div>,
    slot
  );
}

// ── Bed card v2 — status badge, payer chip, inline discharge progress ─────────
const STATE_KEY = (p, r) =>
  p === "OCCUPIED" ? (r === "RESERVED" ? "or" : "o") : (r === "RESERVED" ? "vr" : "v");

// Badge wording: reserved variants read as VAC[RES] / OCC[RES] — no "+" separators.
const STATE_LABEL = (p, r) =>
  p === "OCCUPIED" ? (r === "RESERVED" ? "OCC[RES]" : "OCCUPIED") : (r === "RESERVED" ? "VAC[RES]" : "VACANT");

const BedGridCard = React.memo(function BedGridCard({ bed, onClick }) {
  const sk = STATE_KEY(bed.physical_status, bed.reservation_status);
  const dimmed = bed.operational_status === false;
  const occupied = bed.physical_status === "OCCUPIED";
  const badge = occupied ? dischargeBadge(bed.discharge_tracking) : null;
  const color = bedStateColor(bed.physical_status, bed.reservation_status);
  const bg    = bedStateBg(bed.physical_status, bed.reservation_status);
  // Overstay — System Checkout done but the patient hasn't actually left yet
  // (same condition the Admin dashboard counts as "overstay"). patient_left can
  // never be true here while still Occupied — completeIfEligible vacates the bed
  // the moment both are true, so checking it is enough, no need for physical_checkout_status too.
  const overstay = occupied && bed.discharge_tracking?.system_checkout_status === "COMPLETED"
    && bed.discharge_tracking?.patient_left !== true;
  const hasRows = !!(
    (occupied && (bed.payer_type || bed.ip_last6 || bed.admission_type || bed.consultant_name || bed.department_name)) || badge ||
    (occupied && bed.reservation_status === "RESERVED" && bed.destination) ||
    (!occupied && bed.reservation_status === "RESERVED" && bed.reservation_note)
  );

  return (
    <div
      className={`pbed st-${sk}` + (overstay ? " overstay" : "") + (onClick ? " tap" : "")}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      style={{ opacity: dimmed ? 0.55 : 1 }}
    >
      {overstay && (
        <div className="pbed-overstay-tag">
          <Ic d={icons.alert} s={11} /> Patient Not Left
        </div>
      )}
      <div className="pbed-head">
        <span className="pbed-name">{bed.bed_name}</span>
        <span className={`pbadge ${sk}`}>{STATE_LABEL(bed.physical_status, bed.reservation_status)}</span>
      </div>
      {dimmed && <div className="pbed-type">Non-operational</div>}

      {/* Labeled rows — every value says what it is */}
      {occupied && bed.ip_last6 && (
        <div className="pbed-kv"><span className="pk">IP</span><span className="pv" title={fmtIpLast6(bed.ip_last6)}>{fmtIpLast6(bed.ip_last6)}</span></div>
      )}
      {occupied && bed.admission_type && (
        <div className="pbed-kv"><span className="pk">Type</span><span className="pv">{bed.admission_type === "DAYCARE" ? "Daycare" : bed.admission_type === "OPD" ? "OPD" : "IP"}</span></div>
      )}
      {occupied && bed.payer_type && (
        <div className="pbed-kv"><span className="pk">Payer</span><span className="pv" title={bed.payer_type}>{bed.payer_type}</span></div>
      )}
      {occupied && (bed.consultant_name || bed.department_name) && (
        <div className="pbed-kv"><span className="pk">{bed.consultant_name ? "Dr" : "Dept"}</span><span className="pv" title={[bed.consultant_name, bed.department_name].filter(Boolean).join(" / ")}>{bed.consultant_name || bed.department_name}</span></div>
      )}
      {badge && (
        <div className="pbed-kv"><span className="pk">Discharge</span><span className="pv" style={{ color: "var(--st-vr)" }} title={badge}>{badge}</span></div>
      )}
      {occupied && bed.reservation_status === "RESERVED" && bed.destination && (
        <div className="pbed-kv"><span className="pk">Sent to</span><span className="pv" style={{ color: "var(--st-or)" }} title={bed.destination}>{bed.destination}</span></div>
      )}
      {!occupied && bed.reservation_status === "RESERVED" && bed.reservation_note && (
        <div className="pbed-kv"><span className="pk">Held for</span><span className="pv" style={{ color: "var(--st-vr)" }} title={bed.reservation_note}>{bed.reservation_note}</span></div>
      )}

      {/* Nothing else to report — fill the middle with the status icon so all cards
          keep the same height instead of collapsing into short empty boxes. */}
      {!hasRows && (
        <div className="pbed-idle">
          <span className="ring" style={{ background: bg, color }}><Ic d={icons.bed} s={20} /></span>
        </div>
      )}

      <div className="pbed-foot">
        <span>Updated {fmtRelative(bed.updated_at)}</span>
        {onClick && <Ic d={icons.chevron} s={13} style={{ color: "var(--ink-3)" }} />}
      </div>
    </div>
  );
});

// Reservation, for an already-Occupied bed, is a quick standalone action —
// a small popup (None/Reserved, + Location when Reserved) rather than a
// permanent inline section fighting Physical Status/Payer for space.
function ReservationPopup({ bed, destinations, onClose, onSave }) {
  useModal(onClose);
  const [val,     setVal]     = useState(bed.reservation_status);
  const [dest,    setDest]    = useState(bed.destination || "");
  const [saving,  setSaving]  = useState(false);
  const needsDest = val === "RESERVED";

  async function save() {
    if (needsDest && !dest) return;
    setSaving(true);
    await onSave(bed.id, bed.physical_status, val, undefined, needsDest ? dest : undefined, undefined, undefined, undefined, undefined, undefined);
    setSaving(false);
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ padding: "18px 20px" }}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 14 }}>Reservation Status</div>
          <div style={{ display: "flex", gap: 10, marginBottom: needsDest ? 14 : 18 }}>
            {[["NONE", "var(--ink-2)", "None", icons.ban], ["RESERVED", "var(--st-vr)", "Reserved", icons.bookmark]].map(([v, c, lbl, ic]) => (
              <button key={v} onClick={() => setVal(v)} style={{
                flex: 1, padding: "13px 0", borderRadius: 12, fontSize: 14.5, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                border: `2px solid ${val === v ? c : "var(--line)"}`,
                background: val === v ? c : "var(--panel)",
                color: val === v ? "#fff" : "var(--ink-2)",
                cursor: "pointer", transition: "all 0.15s",
              }}><Ic d={ic} s={16} /> {lbl}</button>
            ))}
          </div>
          {needsDest && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
                Current Location <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>
              </div>
              <select className="field" value={dest} onChange={(e) => setDest(e.target.value)}
                style={{ borderColor: !dest ? "var(--red)" : undefined }}>
                <option value="">— Choose Location —</option>
                {destinations.map(dt => <option key={dt.id} value={dt.name}>{dt.name}</option>)}
              </select>
              {!dest && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Current location is required when Reserved.</div>}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" style={{ flex: 1, padding: "12px 0", borderRadius: 12, fontSize: 14 }} onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 1, padding: "12px 0", borderRadius: 12, fontSize: 14 }}
              disabled={saving || (needsDest && !dest)} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Bed Transfer, for an already-Occupied bed — PRE only. Now a top-level Actions
// row item instead of a step nested inside the Discharge flow, so it's available
// any time a bed is Occupied, not only once a discharge has been initiated.
function TransferPopup({ bed, wards, onClose, onSaved }) {
  useModal(onClose);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ padding: "18px 20px" }}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>Bed Transfer</div>
          <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>Move this patient to a different bed.</div>
          <TransferSection bed={bed} wards={wards} onClose={onClose} onSaved={onSaved} />
        </div>
      </div>
    </div>
  );
}

function planPopupTodayStr(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

// First click on "Discharge" (no plan exists yet) — asks how this discharge should
// start, instead of dropping straight into an empty planning form. Initiate Now
// skips the Planned state entirely (plans for today, then immediately starts it,
// as one action) — PRE only, matching who's allowed to start a discharge at all.
// Schedule keeps the familiar Today/Tomorrow/Custom + time picker.
function DischargePlanPopup({ bed, canInitiate, onClose, onDone }) {
  useModal(onClose);
  const [mode,       setMode]       = useState(null); // null | "schedule"
  const [option,     setOption]     = useState("today"); // today | tomorrow | custom
  const [customDate, setCustomDate] = useState(planPopupTodayStr());
  const [time,       setTime]       = useState("");
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState("");

  const plannedDate = option === "today" ? planPopupTodayStr() : option === "tomorrow" ? planPopupTodayStr(1) : customDate;

  async function initiateNow() {
    setSaving(true); setError("");
    try {
      const r = await api.dischargePlan(bed.id, planPopupTodayStr(), null);
      await api.dischargeInitiate(r.tracking.admission_id);
      onDone();
    } catch (e) { setError(toastErr(e)); setSaving(false); }
  }

  async function schedule() {
    setSaving(true); setError("");
    try {
      await api.dischargePlan(bed.id, plannedDate, time || null);
      onDone();
    } catch (e) { setError(toastErr(e)); setSaving(false); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ padding: "18px 20px" }}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>Discharge Plan</div>
          <div className="dim" style={{ fontSize: 12, marginBottom: 16 }}>{bed.bed_name} — how should this discharge start?</div>

          {mode === null && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {canInitiate && (
                <button className="btn btn-primary" style={{ padding: "13px 0", borderRadius: 12, fontSize: 14 }}
                  disabled={saving} onClick={initiateNow}>
                  {saving ? "Starting…" : "Initiate Now"}
                </button>
              )}
              <button className="btn btn-ghost" style={{ padding: "13px 0", borderRadius: 12, fontSize: 14 }}
                disabled={saving} onClick={() => setMode("schedule")}>
                Schedule
              </button>
              {error && <div style={{ fontSize: 12, color: "var(--red)" }}>{error}</div>}
              <button className="btn btn-ghost" style={{ padding: "10px 0", fontSize: 12, color: "var(--ink-3)" }} onClick={onClose}>
                Cancel
              </button>
            </div>
          )}

          {mode === "schedule" && (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {[["today", "Today"], ["tomorrow", "Tomorrow"], ["custom", "Custom"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setOption(val)} style={{
                    flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 12.5, fontWeight: 700,
                    border: `2px solid ${option === val ? "var(--primary)" : "var(--line)"}`,
                    background: option === val ? "var(--primary)" : "transparent",
                    color: option === val ? "#fff" : "var(--ink-2)", cursor: "pointer",
                  }}>{lbl}</button>
                ))}
              </div>
              {option === "custom" && (
                <input type="date" className="field" value={customDate} min={planPopupTodayStr()} style={{ marginBottom: 10 }}
                  onChange={(e) => setCustomDate(e.target.value)} />
              )}
              <input type="time" className="field" value={time} placeholder="Time (optional)" style={{ marginBottom: 16 }}
                onChange={(e) => setTime(e.target.value)} />
              {error && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 10 }}>{error}</div>}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-ghost" style={{ flex: 1, padding: "12px 0", borderRadius: 12, fontSize: 14 }}
                  disabled={saving} onClick={() => { setError(""); setMode(null); }}>Back</button>
                <button className="btn btn-primary" style={{ flex: 1, padding: "12px 0", borderRadius: 12, fontSize: 14 }}
                  disabled={saving} onClick={schedule}>
                  {saving ? "Saving…" : "Save Plan"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Bed status dialog — centered popup ────────────────────────────────────────
function BedDetailSheet({ bed, onSave, onClose, wards, onChanged, cfg = PRE_CFG, onToast, onTransferred }) {
  const [physical,     setPhysical]     = useState(bed.physical_status);
  const [reservation,  setReservation]  = useState(bed.reservation_status);
  const [payer,        setPayer]        = useState(bed.payer_type || "");
  const [payerTypes,   setPayerTypes]   = useState([]);
  const [destination,  setDestination]  = useState(bed.destination || "");
  const [destinations, setDestinations] = useState([]);
  const [resNote,      setResNote]      = useState(bed.reservation_note || "");
  const [saving,       setSaving]       = useState(false);
  const [ipLast6,      setIpLast6]      = useState("");
  const [admissionType, setAdmissionType] = useState("");
  const [consultantName, setConsultantName] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [selectedDeptId, setSelectedDeptId] = useState(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState(null);
  const [deptSearch, setDeptSearch] = useState("");
  const [doctorSearch, setDoctorSearch] = useState("");
  const [deptOpen, setDeptOpen] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [reservationOpen, setReservationOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [dischargePlanOpen, setDischargePlanOpen] = useState(false);

  useEffect(() => {
    cfg.payerTypes().then(r => setPayerTypes(r.payerTypes || [])).catch(() => {});
    cfg.destinations().then(r => setDestinations(r.destinations || [])).catch(() => {});
  }, [cfg]);

  useEffect(() => {
    api.departments().then(r => setDepartments(r.departments || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedDeptId) {
      api.doctors(selectedDeptId).then(r => setDoctors(r.doctors || [])).catch(() => {});
    } else {
      setDoctors([]);
    }
    setSelectedDoctorId(null);
    setDoctorSearch("");
  }, [selectedDeptId]);

  const deptRef = useRef(null);
  const doctorRef = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (deptRef.current && !deptRef.current.contains(e.target)) setDeptOpen(false);
      if (doctorRef.current && !doctorRef.current.contains(e.target)) setDoctorOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSetPhysical = (val) => {
    setPhysical(val);
    if (val === "VACANT") setPayer("");
    // Reservation is decided later, on its own — not as part of admitting/updating
    // to Occupied. Reset any stale Vacant+Reserved value so it can't leak through.
    if (val === "OCCUPIED") setReservation("NONE");
  };

  const needsPayer = physical === "OCCUPIED";
  const payerLocked = physical === "OCCUPIED" && reservation === "RESERVED" && bed.physical_status === "OCCUPIED";

  // Fresh admission — bed is currently Vacant and about to become Occupied.
  // Required per the discharge module's Patient Section (V1: manual entry, HIS integration later).
  const needsIp = bed.physical_status === "VACANT" && physical === "OCCUPIED";
  const ipValid = /^\d{6}$/.test(ipLast6);

  // OCC+RES = patient temporarily away at a destination (OT, Scanning) — bed
  // held for them. Destination is required to enter/stay in this state.
  const needsDestination = physical === "OCCUPIED" && reservation === "RESERVED";

  // VAC+RES = bed held for an incoming patient. Note describing why is required.
  const needsResNote = physical === "VACANT" && reservation === "RESERVED";
  const showResNote = needsResNote;

  // Once a bed is saved Occupied and stays Occupied, Reservation moves out of this
  // form into a standalone popup (Actions row below).
  const showActionsRow = bed.physical_status === "OCCUPIED" && physical === "OCCUPIED";

  // Reservation is only ever set inline while the bed is (or is becoming) Vacant —
  // never as part of admitting a patient. Vacant+Reserved ("held for incoming
  // patient") is decided at Vacant; Occupied+Reserved is decided later, via the
  // Reservation popup in the Actions row, only after the bed is already Occupied.
  const showReservationInline = physical === "VACANT";

  async function handleSave() {
    if (needsPayer && !payer && !payerLocked) return;
    if (!showActionsRow && needsDestination && !destination) return;
    if (!showActionsRow && needsResNote && !resNote.trim()) return;
    if (needsIp && !ipValid) return;
    if (needsIp && !admissionType) return;
    if (needsIp && !selectedDeptId) return;
    if (needsIp && !selectedDoctorId) return;
    setSaving(true);
    const payerArg = physical === "VACANT" ? null : (payerLocked && payer === (bed.payer_type || "") ? undefined : payer || null);
    const destinationArg = (!showActionsRow && needsDestination) ? destination : undefined;
    const resNoteArg = (!showActionsRow && showResNote) ? resNote : undefined;
    const ipArg = needsIp ? ipLast6 : undefined;
    const admissionTypeArg = needsIp ? admissionType : undefined;
    const consultantArg = needsIp ? (consultantName.trim() || null) : undefined;
    const departmentArg = needsIp ? (departmentName.trim() || null) : undefined;
    const doctorIdArg = needsIp ? (selectedDoctorId || null) : undefined;
    const departmentIdArg = needsIp ? (selectedDeptId || null) : undefined;
    await onSave(bed.id, physical, reservation, payerArg, destinationArg, resNoteArg, ipArg, admissionTypeArg, consultantArg, departmentArg, doctorIdArg, departmentIdArg);
    setSaving(false);
    onToast?.("Status updated ✓");
  }

  const savedSk = STATE_KEY(bed.physical_status, bed.reservation_status);
  const liveSk  = STATE_KEY(physical, reservation);

  // Full-page discharge view — "Discharge Details" navigates here, back returns to the bed.
  if (dischargeOpen) return (
    <div className="slide-up" style={{ maxWidth: 640, margin: "0 auto" }}>
      <BackBtn label={`Back to ${bed.bed_name}`} onClick={() => setDischargeOpen(false)} style={{ marginBottom: 18 }} />

      <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <span style={{ fontWeight: 800, fontSize: 24, letterSpacing: "-.02em" }}>Discharge — {bed.bed_name}</span>
        <span className={`pbadge ${savedSk}`} style={{ gap: 5, padding: "6px 12px", fontSize: 10.5 }}>
          <Ic d={bed.physical_status === "OCCUPIED" ? icons.user : icons.bed} s={12} />
          {STATE_LABEL(bed.physical_status, bed.reservation_status)}
        </span>
      </div>

      <div className="card" style={{ padding: "16px 18px" }}>
        <DischargeTab bed={bed} wards={wards} role={cfg.role} onChanged={onChanged} />
      </div>
    </div>
  );

  return (
    <div className="slide-up" style={{ maxWidth: 640, margin: "0 auto" }}>
      {/* Back */}
      <BackBtn label="Back to beds" onClick={onClose} style={{ marginBottom: 18 }} />

      {/* Title — name · unit · operational · saved status · live selection */}
      <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <span style={{ fontWeight: 800, fontSize: 24, letterSpacing: "-.02em" }}>{bed.bed_name}</span>
        <span className="chip" style={{ fontSize: 11, padding: "6px 12px" }}>
          <Ic d={icons.bed} s={13} /> {bed.bed_type || "Census"} Bed
        </span>
        {bed.unit_type && (
          <span className="chip" style={{ fontSize: 11, padding: "6px 12px" }}>
            <Ic d={icons.building} s={13} /> {bed.unit_type}
          </span>
        )}
        <span className="tag" style={{
          display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, padding: "6px 12px",
          background: bed.operational_status !== false ? "var(--st-v-bg)" : "var(--st-or-bg)",
          color: bed.operational_status !== false ? "var(--st-v)" : "var(--st-or)",
        }}>
          <Ic d={icons.settings} s={12} /> {bed.operational_status !== false ? "Operational" : "Non-operational"}
        </span>
        <span className={`pbadge ${savedSk}`} style={{ gap: 5, padding: "6px 12px", fontSize: 10.5 }}>
          <Ic d={bed.physical_status === "OCCUPIED" ? icons.user : icons.bed} s={12} />
          {STATE_LABEL(bed.physical_status, bed.reservation_status)}
        </span>
        {liveSk !== savedSk && (
          <span className={`pbadge ${liveSk}`} style={{ gap: 5, padding: "6px 12px", fontSize: 10.5, border: "1.5px dashed var(--ink-3)" }}>
            <Ic d={icons.target} s={12} /> Selected: {STATE_LABEL(physical, reservation)}
          </span>
        )}
      </div>

      {/* Bed information card */}
      <div className="card" style={{ padding: "16px 18px", marginBottom: 20 }}>
        <div className="row" style={{ gap: 8, marginBottom: 4 }}>
          <span style={{ color: "var(--ink-3)", display: "flex" }}><Ic d={icons.info} s={15} /></span>
          <span className="pdlg-sect" style={{ marginBottom: 0 }}>Bed Information</span>
        </div>

        <div className="pdlg-row" style={{ padding: "10px 0" }}>
          <span className="k row" style={{ gap: 10 }}><Ic d={icons.target} s={16} /> Current Status</span>
          <span className="v">{bedCurrentStatus(bed)}</span>
        </div>
        {bed.physical_status === "OCCUPIED" && bed.admission_type && (
          <div className="pdlg-row" style={{ padding: "10px 0" }}>
            <span className="k row" style={{ gap: 10 }}><Ic d={icons.stethoscope} s={16} /> Admission Type</span>
            <span className="v">{bed.admission_type === "DAYCARE" ? "Daycare" : bed.admission_type === "OPD" ? "OPD" : "IP"}</span>
          </div>
        )}
        {bed.physical_status === "OCCUPIED" && (
          <div className="pdlg-row" style={{ padding: "10px 0" }}>
            <span className="k row" style={{ gap: 10 }}><Ic d={icons.user} s={16} /> IP ID</span>
            <span className="v">{fmtIpLast6(bed.ip_last6)}</span>
          </div>
        )}
        {bed.physical_status === "OCCUPIED" && (bed.consultant_name || bed.department_name) && (
          <div className="pdlg-row" style={{ padding: "10px 0" }}>
            <span className="k row" style={{ gap: 10 }}><Ic d={icons.building} s={16} /> Consultant / Dept</span>
            <span className="v">{[bed.consultant_name, bed.department_name].filter(Boolean).join(" / ")}</span>
          </div>
        )}
        {bed.physical_status === "OCCUPIED" && dischargeBadge(bed.discharge_tracking) && (
          <div className="pdlg-row" style={{ padding: "10px 0" }}>
            <span className="k row" style={{ gap: 10 }}><Ic d={icons.clipboard} s={16} /> Discharge</span>
            <span className="v" style={{ color: "var(--st-vr)" }}>
              {dischargeBadge(bed.discharge_tracking)}
              {dischargeProgress(bed.discharge_tracking) && (() => {
                const p = dischargeProgress(bed.discharge_tracking);
                return ` · ${p.done}/${p.total} done`;
              })()}
            </span>
          </div>
        )}
        <div className="pdlg-row" style={{ padding: "10px 0" }}>
          <span className="k row" style={{ gap: 10 }}><Ic d={icons.clock} s={16} /> Last Updated</span>
          <span className="v dim" style={{ fontWeight: 600 }}>{fmtRelative(bed.updated_at)}</span>
        </div>

        {/* What's saved on the bed right now, regardless of the toggles */}
        {bed.physical_status === "OCCUPIED" && bed.reservation_status === "RESERVED" && bed.destination && (
          <div className="pdlg-row" style={{ padding: "10px 0" }}>
            <span className="k row" style={{ gap: 10, color: "var(--st-or)" }}><Ic d={icons.share} s={16} /> Sent to</span>
            <span className="v">{bed.destination}</span>
          </div>
        )}
        {bed.physical_status === "VACANT" && bed.reservation_status === "RESERVED" && bed.reservation_note && (
          <div style={{ padding: "10px 0" }}>
            <div className="k row" style={{ gap: 10, fontSize: 12, color: "var(--st-vr)", fontWeight: 600, marginBottom: 4 }}>
              <Ic d={icons.fileText} s={16} /> Reservation Note
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, wordBreak: "break-word", overflowWrap: "anywhere" }}>{bed.reservation_note}</div>
          </div>
        )}

      </div>

      <div>

          {/* Physical Status — first: this decides what the rest of the form asks for. */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
              Physical Status
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {[["VACANT","var(--st-v)","Vacant"],["OCCUPIED","var(--st-o)","Occupied"]].map(([val, c, lbl]) => (
                <button key={val} onClick={() => handleSetPhysical(val)} style={{
                  flex: 1, padding: "13px 0", borderRadius: 12, fontSize: 14.5, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                  border: `2px solid ${physical === val ? c : "var(--line)"}`,
                  background: physical === val ? c : "var(--panel)",
                  color: physical === val ? "#fff" : "var(--ink-2)",
                  cursor: "pointer", transition: "all 0.15s",
                }}><Ic d={icons.bed} s={16} /> {lbl}</button>
              ))}
            </div>
          </div>

          {/* Patient Section — required when a Vacant bed is about to become Occupied.
              Future: full IP number will come from HIS; this is manual for V1. Consultant/Dept
              is a plain field for now — it'll become an admin-configured dropdown (Setup) later. */}
          {needsIp && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
                Admission Type <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                {[["IP", "IP"], ["DAYCARE", "Daycare"], ["OPD", "OPD"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setAdmissionType(val)} style={{
                    flex: 1, padding: "13px 0", borderRadius: 12, fontSize: 14.5, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                    border: `2px solid ${admissionType === val ? "var(--primary)" : "var(--line)"}`,
                    background: admissionType === val ? "var(--primary)" : "var(--panel)",
                    color: admissionType === val ? "#fff" : "var(--ink-2)",
                    cursor: "pointer", transition: "all 0.15s",
                  }}><Ic d={icons.stethoscope} s={16} /> {lbl}</button>
                ))}
              </div>
              {!admissionType && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: -10, marginBottom: 16 }}>Select an admission type.</div>
              )}

              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
                Patient — Last 6 Digits of IP Number <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>
              </div>
              <input className="field" inputMode="numeric" maxLength={6} value={ipLast6}
                placeholder="e.g. 123456"
                onChange={(e) => setIpLast6(e.target.value.replace(/\D/g, "").slice(0, 6))}
                style={{ borderColor: !ipValid ? "var(--red)" : undefined }} />
              {!ipValid && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Enter exactly 6 digits.</div>
              )}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 16, marginBottom: 10 }}>
                Department &amp; Consultant <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {/* Department dropdown */}
                <div ref={deptRef} style={{ flex: "1 1 160px", position: "relative" }}>
                  <input className="field" style={{ width: "100%", borderColor: !selectedDeptId ? "var(--red)" : undefined }}
                    placeholder="Select department"
                    value={deptOpen ? deptSearch : (departments.find(d => d.id === selectedDeptId)?.name || "")}
                    onFocus={() => { setDeptOpen(true); setDeptSearch(""); }}
                    onChange={(e) => setDeptSearch(e.target.value)} />
                  {selectedDeptId && !deptOpen && (
                    <span onClick={() => { setSelectedDeptId(null); setDeptSearch(""); setDepartmentName(""); }}
                      style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "var(--ink-3)", fontSize: 16, lineHeight: 1 }}>&times;</span>
                  )}
                  {deptOpen && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 99, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, maxHeight: 180, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,.12)" }}>
                      {departments.filter(d => !deptSearch || d.name.toLowerCase().includes(deptSearch.toLowerCase())).map(d => (
                        <div key={d.id} onClick={() => { setSelectedDeptId(d.id); setDepartmentName(d.name); setDeptOpen(false); setDeptSearch(""); }}
                          style={{ padding: "10px 14px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--line)" }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--bg)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          {d.name}
                        </div>
                      ))}
                      {departments.filter(d => !deptSearch || d.name.toLowerCase().includes(deptSearch.toLowerCase())).length === 0 && (
                        <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--ink-3)" }}>No departments found</div>
                      )}
                    </div>
                  )}
                </div>
                {/* Doctor dropdown — filtered by selected department */}
                <div ref={doctorRef} style={{ flex: "1 1 160px", position: "relative" }}>
                  <input className="field" style={{ width: "100%", opacity: selectedDeptId ? 1 : 0.5, borderColor: selectedDeptId && !selectedDoctorId ? "var(--red)" : undefined }}
                    placeholder={selectedDeptId ? "Select consultant" : "Select dept first"}
                    disabled={!selectedDeptId}
                    value={doctorOpen ? doctorSearch : (doctors.find(d => d.id === selectedDoctorId)?.name || "")}
                    onFocus={() => { setDoctorOpen(true); setDoctorSearch(""); }}
                    onChange={(e) => setDoctorSearch(e.target.value)} />
                  {selectedDoctorId && !doctorOpen && (
                    <span onClick={() => { setSelectedDoctorId(null); setDoctorSearch(""); setConsultantName(""); }}
                      style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "var(--ink-3)", fontSize: 16, lineHeight: 1 }}>&times;</span>
                  )}
                  {doctorOpen && selectedDeptId && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 99, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, maxHeight: 180, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,.12)" }}>
                      {doctors.filter(d => !doctorSearch || d.name.toLowerCase().includes(doctorSearch.toLowerCase())).map(d => (
                        <div key={d.id} onClick={() => { setSelectedDoctorId(d.id); setConsultantName(d.name); setDoctorOpen(false); setDoctorSearch(""); }}
                          style={{ padding: "10px 14px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--line)" }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--bg)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          {d.name}
                        </div>
                      ))}
                      {doctors.filter(d => !doctorSearch || d.name.toLowerCase().includes(doctorSearch.toLowerCase())).length === 0 && (
                        <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--ink-3)" }}>No doctors in this department</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {!selectedDeptId && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Select a department.</div>
              )}
              {selectedDeptId && !selectedDoctorId && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Select a consultant.</div>
              )}
            </div>
          )}

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
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex", pointerEvents: "none" }}>
                    <Ic d={icons.wallet} s={16} />
                  </span>
                  <select className="field" value={payer}
                    onChange={(e) => setPayer(e.target.value)}
                    style={{ paddingLeft: 40, borderColor: needsPayer && !payer ? "var(--red)" : undefined }}>
                    <option value="">— Select payer type —</option>
                    {payerTypes.map(pt => <option key={pt.id} value={pt.name}>{pt.name}</option>)}
                  </select>
                </div>
              )}
              {needsPayer && !payer && !payerLocked && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Payer type is required for occupied beds.</div>
              )}
            </div>
          )}

          {/* Status — Reservation / Bed Transfer / Discharge. Only once a bed is
              already saved Occupied (not while admitting). */}
          {showActionsRow && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
                Status
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => setReservationOpen(true)} style={{
                  display: "flex", alignItems: "center", gap: 8, flex: "1 1 140px",
                  background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 12,
                  padding: "12px 14px", fontSize: 13, fontWeight: 600, color: "var(--ink)", cursor: "pointer",
                }}>
                  <Ic d={icons.bookmark} s={15} style={{ color: "var(--st-vr)" }} />
                  Reservation
                  <span className="dim" style={{ fontSize: 11, marginLeft: "auto" }}>{bed.reservation_status === "RESERVED" ? "Reserved" : "None"}</span>
                </button>
                {cfg.role === "PRE" && (
                  <button onClick={() => setTransferOpen(true)} style={{
                    display: "flex", alignItems: "center", gap: 8, flex: "1 1 140px",
                    background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 12,
                    padding: "12px 14px", fontSize: 13, fontWeight: 600, color: "var(--ink)", cursor: "pointer",
                  }}>
                    <Ic d={icons.exchange} s={15} style={{ color: "var(--primary)" }} />
                    Bed Transfer
                  </button>
                )}
                <button onClick={() => {
                  // No plan yet and this role is allowed to make one — ask Initiate
                  // Now vs Schedule first, instead of dropping into an empty form.
                  // Otherwise (already planned/running, or a role that can't plan
                  // e.g. Nurse) go straight to the full Discharge Details page.
                  const canPlanRole = cfg.role === "PRE" || cfg.role === "DOCTOR";
                  if (!bed.discharge_tracking && canPlanRole) setDischargePlanOpen(true);
                  else setDischargeOpen(true);
                }} style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: "none", cursor: "pointer",
                  flex: "1 1 100%", borderRadius: 999, padding: "12px 14px", fontSize: 13, fontWeight: 800, letterSpacing: 0.3,
                  background: "var(--blue-bg)", color: "var(--blue)",
                }}>
                  <Ic d={icons.fileText} s={14} /> Discharge
                </button>
              </div>
            </div>
          )}

          {/* Reservation Status — inline only while the bed is (or is becoming) Vacant.
              Occupied+Reserved is never set here; it's decided later, via the Reservation
              popup in the Actions row, only after the bed has already been saved Occupied. */}
          {showReservationInline && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
                Reservation Status
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {[["NONE","var(--ink-2)","None",icons.ban],["RESERVED","var(--st-vr)","Reserved",icons.bookmark]].map(([val, c, lbl, ic]) => (
                  <button key={val} onClick={() => setReservation(val)} style={{
                    flex: 1, padding: "13px 0", borderRadius: 12, fontSize: 14.5, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                    border: `2px solid ${reservation === val ? c : "var(--line)"}`,
                    background: reservation === val ? c : "var(--panel)",
                    color: reservation === val ? "#fff" : "var(--ink-2)",
                    cursor: "pointer", transition: "all 0.15s",
                  }}><Ic d={ic} s={16} /> {lbl}</button>
                ))}
              </div>
            </div>
          )}

          {/* Reservation note — shown only for Vacant + Reserved (bed held for incoming patient) */}
          {showResNote && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
                Note <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>
              </div>
              <textarea className="field" value={resNote} maxLength={255} rows={2}
                placeholder="e.g. Reserved for incoming transfer from ICU"
                onChange={(e) => setResNote(e.target.value)}
                style={{ resize: "vertical", fontSize: 13, fontFamily: "inherit", wordBreak: "break-word", overflowWrap: "anywhere", borderColor: !resNote.trim() ? "var(--red)" : undefined }} />
              {!resNote.trim() && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>A note is required for Vacant + Reserved beds.</div>
              )}
            </div>
          )}

      </div>{/* /controls */}

      {reservationOpen && createPortal(
        <ReservationPopup bed={bed} destinations={destinations} onClose={() => setReservationOpen(false)} onSave={onSave} />,
        document.body
      )}
      {transferOpen && createPortal(
        <TransferPopup bed={bed} wards={wards} onClose={() => setTransferOpen(false)}
          onSaved={(r) => { setTransferOpen(false); onChanged?.(); if (onTransferred) onTransferred(r); else onClose(); }} />,
        document.body
      )}
      {dischargePlanOpen && createPortal(
        <DischargePlanPopup bed={bed} canInitiate={cfg.role === "PRE"} onClose={() => setDischargePlanOpen(false)}
          onDone={() => { setDischargePlanOpen(false); onChanged?.(); setDischargeOpen(true); }} />,
        document.body
      )}

      {/* Footer actions */}
      <div style={{ display: "flex", gap: 10, marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
        <button className="btn btn-ghost" style={{ flex: 1, padding: "13px 0", borderRadius: 12, fontSize: 14.5 }} onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" style={{ flex: 1.6, padding: "13px 0", borderRadius: 12, fontSize: 14.5 }}
          disabled={saving || (needsPayer && !payer && !payerLocked) || (!showActionsRow && needsDestination && !destination) || (!showActionsRow && needsResNote && !resNote.trim()) || (needsIp && !ipValid) || (needsIp && !admissionType)}
          onClick={handleSave}>
          <Ic d={icons.save} s={16} /> {saving ? "Saving…" : "Update Status"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  WARD PAGE — full-page ward view (View / Manage / Discharge tabs, no popup)
// ══════════════════════════════════════════════════════════════════════════════
export function WardPage({ ward, initialTab, onBack, allWards, cfg = PRE_CFG }) {
  const [tab,        setTab]        = useState(initialTab || "view");
  const [beds,       setBeds]       = useState([]);
  const [filter,     setFilter]     = useState("ALL");
  const [search,     setSearch]     = useState("");
  const [editingBed, setEditingBed] = useState(null);  // bed object | null
  const [loading,    setLoading]    = useState(false);
  const [loadedAt,   setLoadedAt]   = useState(null);  // Date | null — freshness dot in the header
  const [toast,      setToast]      = useState("");

  const showToast = useCallback((m) => {
    setToast(m); setTimeout(() => setToast(""), 2000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await cfg.listBeds(ward.id);
      // Annotate beds with ward-level unit_type so filter + badges work uniformly
      const unitType = ward.unit_type || null;
      setBeds((result.beds || []).map(b => ({ ...b, unit_type: unitType })));
      setLoadedAt(new Date());
    }
    catch (e) { showToast(toastErr(e)); }
    finally { setLoading(false); }
  }, [ward.id, ward.unit_type, showToast]);

  useEffect(() => { load(); }, [load]);

  // Live refresh — every bed/discharge change lands here instantly via websocket.
  // Payloads carrying a wardId are filtered to this ward; anything else reloads
  // defensively. The ref keeps the handler on the latest load closure without
  // reconnecting the socket on every render.
  const liveLoadRef = useRef(load);
  liveLoadRef.current = load;
  useEffect(() => {
    const socket = createSocket();
    const onData = (p) => {
      if (p && p.wardId != null && Number(p.wardId) !== Number(ward.id)) return;
      liveLoadRef.current();
    };
    socket.on("bed:update",       onData);
    socket.on("discharge:update", onData);
    socket.on("ward:operational", onData);
    socket.on("connect", () => liveLoadRef.current()); // reconnect → catch missed updates
    return () => { socket.disconnect(); };
  }, [ward.id]);

  // On phones, hide the app top bar while inside a ward — the back chip is the way
  // out, and the reclaimed space goes to the bed grid. (CSS: body.ward-focus)
  useEffect(() => {
    document.body.classList.add("ward-focus");
    return () => document.body.classList.remove("ward-focus");
  }, []);

  const sortedBeds = [...beds].sort((a, b) => {
    return naturalSort(a.bed_name, b.bed_name);
  });

  const q = search.trim().toLowerCase();
  const displayed = sortedBeds.filter(b => {
    if (q && !b.bed_name.toLowerCase().includes(q)) return false;
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
  const changeStatus = useCallback(async (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId) => {
    let snapshot;
    const stillOccRes = physicalStatus === "OCCUPIED" && reservationStatus === "RESERVED";
    const stillVacRes = physicalStatus === "VACANT" && reservationStatus === "RESERVED";
    setBeds(prev => {
      snapshot = prev;
      return prev.map(b => b.id === bedId
        ? {
            ...b, physical_status: physicalStatus, reservation_status: reservationStatus,
            payer_type: physicalStatus === "VACANT" ? null : (payerType ?? b.payer_type),
            destination: stillOccRes ? (destination ?? b.destination) : null,
            reservation_note: stillVacRes ? (reservationNote ?? b.reservation_note) : null,
          }
        : b);
    });
    try {
      await cfg.updateBedStatus(bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId);
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

  // Facet counts for the filter dropdown — options with nothing behind them are hidden.
  const fc = { ALL: sortedBeds.length, KIMS: 0, Renova: 0, "Non-Op": 0, Vacant: 0, Occupied: 0, Reserved: 0 };
  for (const b of sortedBeds) {
    if (b.unit_type?.includes("Renova")) fc["Renova"]++;
    else if (b.unit_type === "KIMS") fc["KIMS"]++;
    if (b.operational_status === false) fc["Non-Op"]++;
    if (b.physical_status === "VACANT") fc["Vacant"]++; else fc["Occupied"]++;
    if (b.reservation_status === "RESERVED") fc["Reserved"]++;
  }
  const FILTER_OPTIONS = [
    { key: "ALL",      label: "All beds" },
    { key: "Vacant",   label: "Vacant" },
    { key: "Occupied", label: "Occupied" },
    { key: "Reserved", label: "Reserved" },
    { key: "Non-Op",   label: "Non-operational" },
    { key: "KIMS",     label: "KIMS" },
    { key: "Renova",   label: "Renova" },
  ].filter(o => o.key === "ALL" || fc[o.key] > 0);

  // Rendered inline in WardPage (NOT as a nested component) so the input keeps
  // focus across keystrokes — a component defined inside render remounts every time.
  const searchBar = (
    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
      <div style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex" }}>
          <Ic d={icons.search} s={15} />
        </span>
        <input
          className="field"
          value={search}
          placeholder="Search bed…"
          style={{ paddingLeft: 36, paddingRight: search ? 36 : 13 }}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            aria-label="Clear search"
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex", padding: 4 }}
          >
            <Ic d={icons.x} s={14} />
          </button>
        )}
      </div>
      <select
        className="field"
        aria-label="Filter beds"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ width: "auto", flex: "0 1 auto", maxWidth: 150, fontWeight: 600 }}
      >
        {FILTER_OPTIONS.map(o => (
          <option key={o.key} value={o.key}>{o.label} ({fc[o.key] ?? fc.ALL})</option>
        ))}
      </select>
      {/* Jump straight to one bed — same pattern as the ward/station dropdowns.
          In Manage it opens the bed's page; in View it narrows the grid to it. */}
      {sortedBeds.length > 1 && (
        <select
          className="field"
          aria-label="Go to bed"
          value=""
          onChange={(e) => {
            const b = sortedBeds.find((x) => String(x.id) === e.target.value);
            if (!b) return;
            if (tab === "manage" && b.operational_status !== false) setEditingBed(b);
            else { setSearch(b.bed_name); setFilter("ALL"); }
          }}
          style={{ width: "auto", flex: "0 1 auto", maxWidth: 150, fontWeight: 600 }}
        >
          <option value="">Go to bed…</option>
          {sortedBeds.map((b) => <option key={b.id} value={String(b.id)}>{b.bed_name}</option>)}
        </select>
      )}
    </div>
  );

  // ── Shared grid renderer — grid + empty state only ─────────────────────────
  function BedGrid({ clickable }) {
    return displayed.length === 0 ? (
      <div className="card empty" style={{ padding: 24 }}>
        <Ic d={icons.search} s={24} />
        <div style={{ marginTop: 8, fontWeight: 600, fontSize: 13 }}>No beds match</div>
        <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>
          {q ? `Nothing named “${search.trim()}” in this filter.` : "No beds in this filter."}
        </div>
        {(q || filter !== "ALL") && (
          <button className="btn btn-ghost" style={{ marginTop: 12, fontSize: 12, padding: "8px 14px" }}
            onClick={() => { setSearch(""); setFilter("ALL"); }}>
            Clear search & filters
          </button>
        )}
      </div>
    ) : (
      <div className="pbed-grid">
        {displayed.map((bed) => (
          <BedGridCard
            key={bed.id}
            bed={bed}
            onClick={clickable && bed.operational_status !== false ? () => setEditingBed(bed) : undefined}
          />
        ))}
      </div>
    );
  }

  // Ward summary strip — Total / Vacant / Occupied / Planned (from live bed data)
  const sum = {
    total: sortedBeds.length,
    vacant: sortedBeds.filter(b => b.physical_status === "VACANT").length,
    occupied: sortedBeds.filter(b => b.physical_status === "OCCUPIED").length,
    planned: sortedBeds.filter(b => b.discharge_tracking?.status === "PLANNED").length,
  };
  const summaryStrip = (
    <div className="wsum">
      {[
        { n: sum.total,    l: "Total Beds", ic: icons.bed,       c: "var(--primary)", bg: "var(--st-vr-bg)" },
        { n: sum.vacant,   l: "Vacant",     ic: icons.bed,       c: "var(--st-v)",    bg: "var(--st-v-bg)" },
        { n: sum.occupied, l: "Occupied",   ic: icons.user,      c: "var(--st-o)",    bg: "var(--st-o-bg)" },
        { n: sum.planned,  l: "Planned",    ic: icons.clipboard, c: "var(--st-vr)",   bg: "var(--st-vr-bg)" },
      ].map(({ n, l, ic, c, bg }) => (
        <div className="wsum-item" key={l}>
          <span className="wsum-ic" style={{ background: bg, color: c }}><Ic d={ic} s={16} /></span>
          <div>
            <div className="wsum-n" style={{ color: c }}>{n}</div>
            <div className="wsum-l">{l}</div>
          </div>
        </div>
      ))}
    </div>
  );

  // Full-page bed editor — replaces the ward page entirely (no popup, natural scroll).
  // Use the latest bed data from the live beds array (kept fresh by websocket) so the
  // info card updates in real time; fall back to editingBed for the optimistic snapshot.
  if (editingBed) {
    const liveBed = beds.find(b => b.id === editingBed.id) || editingBed;
    return (
      <div>
        <BedDetailSheet
          bed={liveBed}
          wards={(allWards || []).map(w => ({ id: w.id, name: w.ward }))}
          onSave={async (bedId, physical, reservation, payer, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId) => {
            const stillOccRes = physical === "OCCUPIED" && reservation === "RESERVED";
            const stillVacRes = physical === "VACANT" && reservation === "RESERVED";
            setEditingBed(prev => ({
              ...prev, physical_status: physical, reservation_status: reservation,
              payer_type: physical === "VACANT" ? null : (payer ?? prev.payer_type),
              destination: stillOccRes ? (destination ?? prev.destination) : null,
              reservation_note: stillVacRes ? (reservationNote ?? prev.reservation_note) : null,
            }));
            await changeStatus(bedId, physical, reservation, payer, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId);
          }}
          onClose={() => setEditingBed(null)}
          onChanged={load}
          onToast={showToast}
          cfg={cfg}
          onTransferred={(r) => {
            load().then(() => {
              if (r.toWardId === ward.id) {
                setEditingBed({ id: r.toBedId, bed_name: r.toBedName, ward_id: r.toWardId, physical_status: "OCCUPIED", reservation_status: "NONE" });
              } else {
                setEditingBed(null);
              }
              showToast(`Transferred to ${r.toBedName}${r.toWardName ? " · " + r.toWardName : ""} ✓`);
            });
          }}
        />
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="slide-up">
      {/* Header — back · ward name + count · refresh + freshness */}
      <div className="row between" style={{ marginBottom: 14, gap: 10 }}>
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <BackBtn onClick={onBack} />
          <div style={{ minWidth: 0 }}>
            <div className="h1" style={{ fontSize: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ward.ward}</div>
            <div className="dim" style={{ fontSize: 11.5 }}>
              {beds.length} bed{beds.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexShrink: 0 }}>
          <button className="appbar-btn" onClick={load} title="Refresh" aria-label="Refresh beds">
            <Ic d={icons.refresh} s={15} />
          </button>
          {loadedAt && (
            <span className="dim" style={{ fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--st-v)" }} />
              {fmtRelative(loadedAt.getTime())}
            </span>
          )}
        </div>
      </div>

      {/* Tab bar — Discharges is a first-class tab, not a popup */}
      <div className="seg" style={{ marginBottom: 14, maxWidth: 420 }}>
        <button className={tab === "view" ? "on" : ""} onClick={() => setTab("view")}>
          <Ic d={icons.grid} s={14} /> View
        </button>
        <button className={tab === "manage" ? "on" : ""} onClick={() => setTab("manage")}>
          <Ic d={icons.bed} s={14} /> Manage
        </button>
        <button className={tab === "discharge" ? "on" : ""} onClick={() => setTab("discharge")}>
          <Ic d={icons.clipboard} s={14} /> Discharges
        </button>
      </div>

      {/* Tab content — Discharges reuses the same full page as the left-nav "Discharges"
          tab, just scoped to this ward, so both places show identical planned/in-progress data. */}
      {tab === "discharge" ? (
        <DischargesPage
          role={cfg.role} wardId={ward.id}
          wards={(allWards || []).map(w => ({ id: w.id, name: w.ward }))}
        />
      ) : (
        <>
          {!loading && beds.length > 0 && searchBar}
          {loading ? spinner : beds.length === 0 ? emptyState : <BedGrid clickable={tab === "manage"} />}
          {!loading && beds.length > 0 && summaryStrip}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
