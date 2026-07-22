import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { api, startAlarm, stopAlarm, fmtTime, fmtClock, fmtRelative, toastErr, createSocket } from "./lib.js";
import { Ic, icons, StatusBar, ThemeToggle, useModal } from "./ui.jsx";
import { AppShell, useProfileMenuSlot } from "./shell.jsx";
import { OverstayPanel } from "./COOApp.jsx";
import { naturalSort, bedStateColor, bedStateBg, bedStateShort, calculateWardTotals, dischargeBadge, dischargeProgress, bedCurrentStatus } from "./bedUtils.js";
import DischargeTab, { TransferSection } from "./DischargeTab.jsx";
import DischargesPage from "./DischargesPage.jsx";
import { LiveBedDashboard } from "./COOApp.jsx";

// "dashboard" is no longer a tab of its own — the full dashboard now renders
// underneath Home on the same page (see the home branch below).
const TAB_TITLES = { home: "Home", entry: "Bed Entry", discharges: "Discharges", overstay: "Overstay Alerts" };

// Role configuration for the shared ward/bed pages. Nurse and Doctor reuse the exact
// same pages (WardPage → bed page → discharge pages) with their own endpoints — only
// the role string and API functions differ; layout/UX is identical everywhere.
export const PRE_CFG = {
  role: "PRE",
  listBeds: (wardId) => api.preBeds(wardId),
  updateBedStatus: (...a) => api.preUpdateBedStatus(...a),
  payerTypes: () => api.prePayerTypes(),
  destinations: () => api.preDestinations(),
  // PRE-only for now — Nurse/Doctor cfgs deliberately don't define this, so the
  // edit affordance on Patient Information only renders for PRE.
  updateAdmission: (bedId, patch) => api.preUpdateAdmission(bedId, patch),
  reviewWard: (wardId) => api.preReviewWard(wardId),
};

export default function PREApp({ user, meta, onLogout }) {
  const [tab, setTab] = useState("home");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null); // null | string — real network errors
  const [configError, setConfigError] = useState(null); // null | string — account config issues
  const [toast, setToast] = useState("");
  const [liveKey, setLiveKey] = useState(0); // bumped on every live event — feeds the Dashboard tab
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
      else setLoadError("Unable to connect to server");
    }
    finally { setLoading(false); }
  }, [showToast]);

  // Always keep loadRef current so socket handlers call the latest load closure
  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  // Real-time updates via WebSocket — replaces 15-second polling
  useEffect(() => {
    const socket = createSocket();
    const refresh = () => { loadRef.current(); setLiveKey(k => k + 1); };
    socket.on("bed:update", refresh); // ward counts changed
    socket.on("discharge:update", refresh); // discharge step/plan/transfer changed
    socket.on("discharge:overstay", refresh); // 60-min overstay timer fired
    socket.on("round:submit", refresh); // round submitted → alarm clears
    socket.on("alarm:active", refresh); // scheduler fired → alarm state changed
    socket.on("ward:operational", refresh); // manager toggled ward operational status
    socket.on("connect", refresh); // reconnect → catch missed updates
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
          onSelect={() => { }}
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
    { key: "home", icon: icons.home, label: "Home" },
    { key: "entry", icon: icons.bed, label: "Entry", dot: alarmActive },
    { key: "discharges", icon: icons.clipboard, label: "Discharges" },
    { key: "overstay", icon: icons.alert, label: "Overstay" },
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
        topExtra={
          <span className="pre-pill" style={{ flexDirection: "column", gap: 1, lineHeight: 1.2, padding: "5px 9px" }}>
            <span style={{ fontSize: 11 }}><Ic d={icons.clock} s={11} /> {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })}</span>
            <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{new Date().toLocaleDateString("en-GB")}</span>
          </span>
        }
      >
        {/* Home + the full dashboard are one page now. The dashboard keeps its own
            top-bar/profile portals, so it must stay mounted only while Home is the
            active tab — otherwise those portals leak onto Entry/Discharges/Map. */}
        {tab === "home" && (
          <>
            <Home {...{ data, meta, setTab, alarmActive }} />
            <div style={{ height: 20 }} />
            <LiveBedDashboard refreshKey={liveKey} userName={user.username || data.pre} scope="pre" />
          </>
        )}
        {tab === "entry" && <Entry data={data} submitRound={submitRound} submitting={submitting} alarmActive={alarmActive} onRefresh={load} />}
        {tab === "discharges" && <DischargesPage role="PRE" wards={data.wards.map(w => ({ id: w.id, name: w.ward }))} />}
        {tab === "overstay" && <OverstayPanel loadFn={api.preOverstay} />}

        <ProfileThemeRow />
        {toast && <div className="toast">{toast}</div>}
      </AppShell>
    </div>
  );
}

// Round Update Due — a blocking popup rather than a banner that scrolls away.
// It leads with the one action that clears it, and can be dismissed to reveal
// the compact inline strip below (so the alert is never lost, just quieter).
function RoundDuePopup({ round, onGo, onDismiss }) {
  useModal(onDismiss);
  return (
    <div className="overlay" onClick={onDismiss}>
      <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="round-due-title"
        style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ padding: "22px 20px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            <span className="pulse" style={{
              color: "var(--red)", background: "var(--st-or-bg)", borderRadius: "50%",
              width: 60, height: 60, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Ic d={icons.bell} s={28} />
            </span>
            <div id="round-due-title" style={{ fontWeight: 800, fontSize: 19, marginTop: 14 }}>Round update due</div>
            <div className="dim" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              The alarm keeps ringing until this round is submitted.
            </div>
            <span className="chip mono" style={{ marginTop: 12 }}>
              <Ic d={icons.clock} s={12} /> {fmtClock(round.startMin)} – {fmtClock(round.endMin)}
            </span>
          </div>
          <button className="btn btn-primary btn-block" style={{ marginTop: 20, padding: "13px 0", borderRadius: 12, fontSize: 14.5 }}
            onClick={onGo}>
            <Ic d={icons.bed} s={16} /> Enter bed status now
          </button>
          <button className="btn btn-ghost btn-block" style={{ marginTop: 10, padding: "10px 0", fontSize: 12.5, color: "var(--ink-3)" }}
            onClick={onDismiss}>
            Remind me on this page
          </button>
        </div>
      </div>
    </div>
  );
}

function Home({ data, setTab, alarmActive }) {
  const s = data.summary || {};
  const round = data.alarm?.round;

  // Popup shows once per alarm activation. Dismissing drops back to the inline
  // strip; a *new* alarm (or a re-fire after submit) opens the popup again.
  const [alertDismissed, setAlertDismissed] = useState(false);
  useEffect(() => { if (!alarmActive) setAlertDismissed(false); }, [alarmActive]);

  return (
    <div>
      {alarmActive && !alertDismissed && (
        <RoundDuePopup
          round={round}
          onGo={() => { setAlertDismissed(true); setTab("entry"); }}
          onDismiss={() => setAlertDismissed(true)}
        />
      )}

      {alarmActive && (
        <div className="alarm-banner slide-up" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div className="row">
            <span className="pulse" style={{ color: "var(--red)" }}><Ic d={icons.bell} s={22} /></span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--red)" }}>Round update due</div>
              <div style={{ fontSize: 12, color: "#DC2626" }}>
                Window {fmtClock(round.startMin)} – {fmtClock(round.endMin)}
              </div>
            </div>
          </div>
          <button className="btn btn-primary" style={{ padding: "9px 16px", fontSize: 13 }} onClick={() => setTab("entry")}>
            Enter bed status
          </button>
        </div>
      )}

      {!alarmActive && data.alarm.submitted && (
        <div className="card slide-up" style={{ padding: 16, borderColor: "var(--st-v)", background: "var(--st-v-bg)", marginBottom: 14 }}>
          <div className="row"><span style={{ color: "var(--st-v)" }}><Ic d={icons.check} s={22} /></span>
            <div><div style={{ fontWeight: 700, color: "var(--st-v)" }}>This round submitted</div>
              <div style={{ fontSize: 12, color: "var(--st-v)" }}>Next round at {fmtClock(round.endMin)}</div></div></div>
        </div>
      )}

      <div className="floor-head">Wards summary</div>
      <div className="stat-grid">
        <div className="stat"><div className="n" style={{ color: "var(--st-v)" }}>{s.wardsDone > 0 ? s.v : "–"}</div><div className="l">VACANT</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--st-vr)" }}>{s.wardsDone > 0 ? s.r : "–"}</div><div className="l">VAC + RES</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--st-o)" }}>{s.wardsDone > 0 ? s.o : "–"}</div><div className="l">OCCUPIED</div></div>
        <div className="stat"><div className="n" style={{ color: "var(--st-or)" }}>{s.wardsDone > 0 ? s.or : "–"}</div><div className="l">OCC + RES</div></div>
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
  const [wardSearch, setWardSearch] = useState("");

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

  // Non-operational wards are visible but excluded from the "done" requirement
  const opWards = data.wards.filter(w => w.operational !== false);
  const allDone = opWards.every(w => w.vacant !== null);
  const doneCount = opWards.filter(w => w.vacant !== null).length;

  return (
    <div>
      <OccupancyCards data={data} />

      {/* Search + ward picker */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex" }}>
            <Ic d={icons.search} s={15} />
          </span>
          <input
            className="field"
            value={wardSearch}
            placeholder="Search ward…"
            style={{ paddingLeft: 36, paddingRight: wardSearch ? 36 : 13 }}
            onChange={(e) => setWardSearch(e.target.value)}
          />
          {wardSearch && (
            <button
              onClick={() => setWardSearch("")}
              aria-label="Clear search"
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex", padding: 4, background: "none", border: "none", cursor: "pointer" }}
            >
              <Ic d={icons.x} s={14} />
            </button>
          )}
        </div>
        {data.wards.length > 1 && (
          <select className="field" aria-label="Filter by ward" value={wardFilter}
            onChange={(e) => setWardFilter(e.target.value)}
            style={{ width: "auto", flex: "0 1 auto", maxWidth: 200, fontWeight: 600 }}>
            <option value="all">All wards ({data.wards.length})</option>
            {data.wards.map((w) => <option key={w.id} value={String(w.id)}>{w.ward}</option>)}
          </select>
        )}
      </div>

      {(data.blocks ?? [{ id: data.preBlockId, name: "", wards: data.wards }]).map((block, bi) => {
        const wq = wardSearch.trim().toLowerCase();
        const visibleWards = block.wards.filter((w) =>
          (wardFilter === "all" || String(w.id) === wardFilter) &&
          (!wq || w.ward.toLowerCase().includes(wq))
        );
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
                        <div className="dim" style={{ fontSize: 12 }}>{w.total} beds</div>
                      </div>
                      {/* One success state only — the badge is the single source of
                        truth; the old "· complete" subtitle said the same thing. */}
                      {nonOp
                        ? <span className="tag" style={{ background: "var(--warn-bg, #fff3cd)", color: "var(--warn, #b45309)" }}>
                          <Ic d={icons.alert} s={12} /> Non-op
                        </span>
                        : entered
                          ? <span className="tag v"><Ic d={icons.check} s={12} /> Complete</span>
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
                      <div className="ward-stats-4">
                        {[
                          { label: "Vacant", val: w.vacant, color: "var(--st-v)" },
                          { label: "Vac+Res", val: w.reserved ?? 0, color: "var(--st-vr)" },
                          { label: "Occupied", val: w.occupied ?? 0, color: "var(--st-o)" },
                          { label: "Occ+Res", val: w.occupied_reserved ?? 0, color: "var(--st-or)" },
                        ].map(({ label, val, color }) => (
                          <div key={label} className="ws-col">
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 6 }}>
                              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                              <span className="ws-label">{label}</span>
                            </div>
                            <div className="ws-val" style={{ color }}>{val}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Action buttons — each opens the full-page ward view on its tab */}
                    {!nonOp && (
                      <div className="row ward-card-btns" style={{ gap: 8, marginTop: "auto", flexWrap: "wrap" }}>
                        <button className="btn btn-primary" style={{ flex: "1 1 100px", padding: "9px 0", fontSize: 13 }}
                          onClick={() => setOpenWard({ ward: w, tab: "manage" })}>
                          <Ic d={icons.bed} s={13} /> Manage Beds
                        </button>
                        <button className="btn btn-ghost" style={{ flex: "1 1 88px", padding: "9px 0", fontSize: 13 }}
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

// Occupancy Cards — the summary block that used to live inline on the Map page.
// Now shared: it renders at the top of My Wards and at the top of Entry, and is
// no longer rendered by the map itself.
export function OccupancyCards({ data }) {
  const s = data.summary || {};
  const enteredBeds = (s.v || 0) + (s.r || 0) + (s.o || 0) + (s.or || 0);
  const occPct = enteredBeds > 0 ? Math.round((s.o + s.or) / enteredBeds * 100) : 0;

  return (
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
  );
}

function MyMap({ data }) {
  const s = data.summary;

  return (
    <div>
      <OccupancyCards data={data} />

      <div className="h1" style={{ fontSize: 18, marginBottom: 4 }}>My ward map</div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>{data.floor} · {data.pre} · {s.wards} wards · {s.total} beds</div>

      <div className="floor-head">Wards ({s.wardsDone}/{s.wards} updated)</div>
      <div className="card-grid">
        {data.wards.map((w) => {
          const entered = w.vacant !== null;
          const wt = entered ? calculateWardTotals(w) : null;
          const wEntered = wt ? wt.totalBeds : 0;
          const wPct = wEntered > 0 ? Math.round((wt.totalOccupied / wEntered) * 100) : 0;
          const full = entered && (w.occupied || 0) === w.total;
          return (
            <div className="ward-card" key={w.id} style={{ borderColor: full ? "var(--st-o)" : entered ? "var(--st-v)" : "var(--line)" }}>
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

export const BedGridCard = React.memo(function BedGridCard({ bed, onClick, wardLabel, hideDoctorDept }) {
  const sk = STATE_KEY(bed.physical_status, bed.reservation_status);
  const dimmed = bed.operational_status === false;
  const occupied = bed.physical_status === "OCCUPIED";
  const badge = occupied ? dischargeBadge(bed.discharge_tracking) : null;
  // "Started" = actually initiated or further along, not merely PLANNED — a
  // planned-but-not-initiated discharge shouldn't show on the bed card yet.
  const dischargeStarted = !!badge && bed.discharge_tracking?.status !== "PLANNED";
  const color = bedStateColor(bed.physical_status, bed.reservation_status);
  const bg = bedStateBg(bed.physical_status, bed.reservation_status);
  // Overstay — System Checkout done but the patient hasn't actually left yet
  // (same condition the Admin dashboard counts as "overstay"). patient_left can
  // never be true here while still Occupied — completeIfEligible vacates the bed
  // the moment both are true, so checking it is enough, no need for physical_checkout_status too.
  const overstay = occupied && bed.discharge_tracking?.system_checkout_status === "COMPLETED"
    && bed.discharge_tracking?.patient_left !== true;
  const hasRows = !!(
    (occupied && (bed.payer_type || bed.ip_last6 || bed.admission_type || (!hideDoctorDept && (bed.consultant_name || bed.department_name)))) || dischargeStarted ||
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
      {wardLabel && (
        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-3)", letterSpacing: ".02em", marginBottom: -2, paddingTop: 2 }}>{wardLabel}</div>
      )}
      <div className="pbed-head">
        <span className="pbed-name">{bed.bed_name}</span>
        <span className={`pbadge ${sk}`}>{STATE_LABEL(bed.physical_status, bed.reservation_status)}</span>
      </div>
      {dimmed && <div className="pbed-type">Non-operational</div>}

      {/* Labeled rows — every value says what it is. Sequence: IP, Doctor, Dept,
          Payer, Type, then Discharge only once it's actually started (not just
          planned — see dischargeStarted below). */}
      {occupied && bed.ip_last6 && (
        <div className="pbed-kv"><span className="pk">IP</span><span className="pv" title={bed.ip_last6}>{bed.ip_last6}</span></div>
      )}
      {!hideDoctorDept && occupied && bed.consultant_name && (
        <div className="pbed-kv"><span className="pk">Dr</span><span className="pv" title={bed.consultant_name}>{bed.consultant_name}</span></div>
      )}
      {!hideDoctorDept && occupied && bed.department_name && (
        <div className="pbed-kv"><span className="pk">Dept</span><span className="pv" title={bed.department_name}>{bed.department_name}</span></div>
      )}
      {occupied && bed.payer_type && (
        <div className="pbed-kv"><span className="pk">Payer</span><span className="pv" title={bed.payer_type}>{bed.payer_type}</span></div>
      )}
      {occupied && bed.admission_type && (
        <div className="pbed-kv"><span className="pk">Type</span><span className="pv">{bed.admission_type === "DAYCARE" ? "Daycare" : bed.admission_type === "OPD" ? "OPD" : "IP"}</span></div>
      )}
      {dischargeStarted && (
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
  const [val, setVal] = useState(bed.reservation_status);
  const [dest, setDest] = useState(bed.destination || "");
  const [saving, setSaving] = useState(false);
  const needsDest = val === "RESERVED";

  async function save() {
    if (needsDest && !dest) return;
    setSaving(true);
    try {
      await onSave(bed.id, bed.physical_status, val, undefined, needsDest ? dest : undefined, undefined, undefined, undefined, undefined, undefined);
      onClose();
    } catch {}
    finally { setSaving(false); }
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
  const [mode, setMode] = useState(null); // null | "schedule"
  const [option, setOption] = useState("tomorrow"); // tomorrow | custom
  const [customDate, setCustomDate] = useState(planPopupTodayStr(1));
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const plannedDate = option === "tomorrow" ? planPopupTodayStr(1) : customDate;

  async function initiateNow() {
    setSaving(true); setError("");
    try {
      const r = await api.dischargePlan(bed.id, planPopupTodayStr(), null);
      await api.dischargeInitiate(r.tracking.admission_id);
      onDone();
    } catch (e) { setError(toastErr(e)); } finally { setSaving(false); }
  }

  async function schedule() {
    setSaving(true); setError("");
    try {
      await api.dischargePlan(bed.id, plannedDate, time || null);
      onDone();
    } catch (e) { setError(toastErr(e)); } finally { setSaving(false); }
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
                {[["tomorrow", "Tomorrow"], ["custom", "Custom"]].map(([val, lbl]) => (
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
export function BedDetailSheet({ bed, onSave, onClose, wards, onChanged, cfg = PRE_CFG, onToast, onTransferred, payerTypes = [], destinations = [], departments = [] }) {
  const [physical, setPhysical] = useState(bed.physical_status);
  const [reservation, setReservation] = useState(bed.reservation_status);
  const [payer, setPayer] = useState(bed.payer_type || "");
  const [destination, setDestination] = useState(bed.destination || "");
  const [resNote, setResNote] = useState(bed.reservation_note || "");
  const [saving, setSaving] = useState(false);
  const [ipLast6, setIpLast6] = useState("");
  const [admissionType, setAdmissionType] = useState("");
  const [consultantName, setConsultantName] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [allDoctors, setAllDoctors] = useState([]);
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
  // Editing Patient Information (IP/consultant/dept) on an already-Occupied bed —
  // separate from needsIp, which only covers the Vacant→Occupied admission moment.
  const [editingPatientInfo, setEditingPatientInfo] = useState(false);
  const [savingPatientInfo, setSavingPatientInfo] = useState(false);
  const [editPayer, setEditPayer] = useState(bed.payer_type || "");
  // Snapshot of Patient Information at the moment Edit is opened — savePatientInfo
  // diffs against this so only actually-changed fields are sent to the backend,
  // instead of resending every field (including untouched ones) on every save.
  const patientInfoSnapshotRef = useRef(null);

  // When opening the edit form we seed selectedDeptId AND selectedDoctorId together
  // (from the bed's current admission) — this flag stops the effect below from
  // wiping the seeded doctor the moment selectedDeptId changes, which it otherwise
  // does on every normal "user picked a different department" change.
  const skipDoctorResetRef = useRef(false);
  const prevDeptIdRef = useRef(selectedDeptId);
  useEffect(() => {
    api.doctors().then(r => setAllDoctors(r.doctors || [])).catch(() => { });
  }, []);
  useEffect(() => {
    if (selectedDeptId) {
      setDoctors(allDoctors.filter(d => d.departments?.some(dep => dep.id === selectedDeptId)));
    } else {
      setDoctors(allDoctors);
    }
    const deptChanged = prevDeptIdRef.current !== selectedDeptId;
    prevDeptIdRef.current = selectedDeptId;
    if (!deptChanged) return;
    if (skipDoctorResetRef.current) {
      skipDoctorResetRef.current = false;
    } else {
      setSelectedDoctorId(null);
      setDoctorSearch("");
    }
  }, [selectedDeptId, allDoctors]);

  function openEditPatientInfo() {
    skipDoctorResetRef.current = true;
    const ipLast6Init = bed.ip_last6 || "";
    const admissionTypeInit = bed.admission_type || "";
    const consultantNameInit = bed.consultant_name || "";
    const departmentNameInit = bed.department_name || "";
    const doctorIdInit = bed.doctor_id || null;
    const deptIdInit = bed.department_id || null;
    const payerInit = bed.payer_type || "";
    setIpLast6(ipLast6Init);
    setAdmissionType(admissionTypeInit);
    setConsultantName(consultantNameInit);
    setDepartmentName(departmentNameInit);
    setSelectedDoctorId(doctorIdInit);
    setSelectedDeptId(deptIdInit);
    setEditPayer(payerInit);
    patientInfoSnapshotRef.current = {
      ipLast6: ipLast6Init, admissionType: admissionTypeInit,
      consultantName: consultantNameInit, departmentName: departmentNameInit,
      doctorId: doctorIdInit, departmentId: deptIdInit, payer: payerInit,
    };
    setEditingPatientInfo(true);
  }

  async function savePatientInfo() {
    if (!/^\d{6}$/.test(ipLast6)) return;
    if (!admissionType || !selectedDeptId || !selectedDoctorId) return;

    // Only send fields that actually changed from the snapshot taken when the
    // edit form opened — avoids resending untouched fields on every save.
    const snap = patientInfoSnapshotRef.current || {};
    const patch = {};
    if (ipLast6 !== snap.ipLast6) patch.ipLast6 = ipLast6;
    if (admissionType !== snap.admissionType) patch.admissionType = admissionType;
    if (consultantName !== snap.consultantName) patch.consultantName = consultantName;
    if (departmentName !== snap.departmentName) patch.departmentName = departmentName;
    if (selectedDoctorId !== snap.doctorId) patch.doctorId = selectedDoctorId;
    if (selectedDeptId !== snap.departmentId) patch.departmentId = selectedDeptId;
    if ((editPayer || null) !== (snap.payer || null)) patch.payerType = editPayer || null;

    if (Object.keys(patch).length === 0) {
      setEditingPatientInfo(false);
      return;
    }

    setSavingPatientInfo(true);
    try {
      await cfg.updateAdmission(bed.id, patch);
      setEditingPatientInfo(false);
      onChanged?.();
      onToast?.("Patient information updated ✓");
    } catch (e) {
      onToast?.(toastErr(e) || "Could not update patient information");
    } finally {
      setSavingPatientInfo(false);
    }
  }

  // Shared by the fresh-admission form (needsIp) and the Patient Information edit
  // form — same state (departments/doctors/selectedDeptId/etc.), same UI, kept in
  // one place so a change here doesn't need to be made twice.
  function renderDeptDoctorPicker() {
    return (
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
        {/* Doctor dropdown — always enabled, filtered by department if one is selected */}
        <div ref={doctorRef} style={{ flex: "1 1 160px", position: "relative" }}>
          <input className="field" style={{ width: "100%", borderColor: !selectedDoctorId ? "var(--red)" : undefined }}
            placeholder="Select consultant"
            value={doctorOpen ? doctorSearch : (doctors.find(d => d.id === selectedDoctorId)?.name || allDoctors.find(d => d.id === selectedDoctorId)?.name || "")}
            onFocus={() => { setDoctorOpen(true); setDoctorSearch(""); }}
            onChange={(e) => setDoctorSearch(e.target.value)} />
          {selectedDoctorId && !doctorOpen && (
            <span onClick={() => { setSelectedDoctorId(null); setDoctorSearch(""); setConsultantName(""); }}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "var(--ink-3)", fontSize: 16, lineHeight: 1 }}>&times;</span>
          )}
          {doctorOpen && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 99, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, maxHeight: 180, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,.12)" }}>
              {doctors.filter(d => !doctorSearch || d.name.toLowerCase().includes(doctorSearch.toLowerCase())).map(d => (
                <div key={d.id} onClick={() => {
                  setSelectedDoctorId(d.id); setConsultantName(d.name); setDoctorOpen(false); setDoctorSearch("");
                  if (!selectedDeptId && d.departments?.length === 1) {
                    skipDoctorResetRef.current = true;
                    setSelectedDeptId(d.departments[0].id);
                    setDepartmentName(d.departments[0].name);
                  }
                }}
                  style={{ padding: "10px 14px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--line)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  {d.name}
                </div>
              ))}
              {doctors.filter(d => !doctorSearch || d.name.toLowerCase().includes(doctorSearch.toLowerCase())).length === 0 && (
                <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--ink-3)" }}>No consultants found</div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

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

  // Fresh admission — bed is currently Vacant and about to become Occupied.
  // Required per the discharge module's Patient Section (V1: manual entry, HIS integration later).
  const needsIp = bed.physical_status === "VACANT" && physical === "OCCUPIED";
  const needsPayer = needsIp;  // payer only required on fresh admission; for occupied beds, edit via Patient Information
  const payerLocked = false;  // removed: payer is no longer in the status-change form for already-occupied beds
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
    if (needsPayer && !payer) return;
    if (!showActionsRow && needsDestination && !destination) return;
    if (!showActionsRow && needsResNote && !resNote.trim()) return;
    if (needsIp && !ipValid) return;
    if (needsIp && !admissionType) return;
    if (needsIp && !selectedDeptId) return;
    if (needsIp && !selectedDoctorId) return;
    setSaving(true);
    const payerArg = physical === "VACANT" ? null : needsIp ? (payer || null) : undefined;
    const destinationArg = (physical === "OCCUPIED" && reservation === "RESERVED") ? (destination || bed.destination || undefined) : undefined;
    const resNoteArg = (!showActionsRow && showResNote) ? resNote : undefined;
    const ipArg = needsIp ? ipLast6 : undefined;
    const admissionTypeArg = needsIp ? admissionType : undefined;
    const consultantArg = needsIp ? (consultantName.trim() || null) : undefined;
    const departmentArg = needsIp ? (departmentName.trim() || null) : undefined;
    const doctorIdArg = needsIp ? (selectedDoctorId || null) : undefined;
    const departmentIdArg = needsIp ? (selectedDeptId || null) : undefined;
    try {
      await onSave(bed.id, physical, reservation, payerArg, destinationArg, resNoteArg, ipArg, admissionTypeArg, consultantArg, departmentArg, doctorIdArg, departmentIdArg);
      onToast?.("Status updated ✓");
    } catch {
      // error already shown as a toast by changeStatus in WardPage
    } finally {
      setSaving(false);
    }
  }

  const savedSk = STATE_KEY(bed.physical_status, bed.reservation_status);
  const liveSk = STATE_KEY(physical, reservation);
  const noChanges = savedSk === liveSk && !needsIp;

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
        <span className="chip" style={{ fontSize: 11, padding: "6px 12px" }}>
          <Ic d={icons.bed} s={13} /> {bed.bed_type || "Census"} Bed
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
        <div className="row" style={{ gap: 8, marginBottom: 4, justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 8 }}>
            <span style={{ color: "var(--ink-3)", display: "flex" }}><Ic d={icons.info} s={15} /></span>
            <span className="pdlg-sect" style={{ marginBottom: 0 }}>Patient Information</span>
          </div>
          {cfg.updateAdmission && bed.physical_status === "OCCUPIED" && !editingPatientInfo && (
            <button onClick={openEditPatientInfo} title="Edit patient information" style={{
              display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8,
              border: "1px solid var(--line)", background: "transparent", color: "var(--primary)",
              fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}><Ic d={icons.pencil} s={13} /> Edit</button>
          )}
        </div>

        <div className="pdlg-row" style={{ padding: "10px 0" }}>
          <span className="k row" style={{ gap: 10 }}><Ic d={icons.target} s={16} /> Current Status</span>
          <span className="v">{bedCurrentStatus(bed)}</span>
        </div>
        {bed.physical_status === "OCCUPIED" && editingPatientInfo ? (
          <div style={{ padding: "10px 0" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
              Admission Type <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {[["IP", "IP"], ["DAYCARE", "Daycare"], ["OPD", "OPD"]].map(([val, lbl]) => (
                <button key={val} onClick={() => setAdmissionType(val)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700,
                  border: `2px solid ${admissionType === val ? "var(--primary)" : "var(--line)"}`,
                  background: admissionType === val ? "var(--primary)" : "var(--panel)",
                  color: admissionType === val ? "#fff" : "var(--ink-2)", cursor: "pointer",
                }}>{lbl}</button>
              ))}
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
              Last 6 Digits of IP Number <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>
            </div>
            <input className="field" inputMode="numeric" maxLength={6} value={ipLast6}
              placeholder="e.g. 123456" style={{ marginBottom: 14, borderColor: !/^\d{6}$/.test(ipLast6) ? "var(--red)" : undefined }}
              onChange={(e) => setIpLast6(e.target.value.replace(/\D/g, "").slice(0, 6))} />

            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
              Department &amp; Consultant <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>
            </div>
            {renderDeptDoctorPicker()}

            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 14, marginBottom: 8 }}>
              Payer Type
            </div>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex", pointerEvents: "none" }}>
                <Ic d={icons.wallet} s={16} />
              </span>
              <select className="field" value={editPayer} style={{ paddingLeft: 40 }}
                onChange={(e) => setEditPayer(e.target.value)}>
                <option value="">— No change —</option>
                {payerTypes.map(pt => <option key={pt.id} value={pt.name}>{pt.name}</option>)}
              </select>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="btn btn-ghost" style={{ flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13 }}
                disabled={savingPatientInfo} onClick={() => setEditingPatientInfo(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13 }}
                disabled={savingPatientInfo || !/^\d{6}$/.test(ipLast6) || !admissionType || !selectedDeptId || !selectedDoctorId}
                onClick={savePatientInfo}>{savingPatientInfo ? "Saving…" : "Save"}</button>
            </div>
          </div>
        ) : (
          <>
            {bed.physical_status === "OCCUPIED" && bed.admission_type && (
              <div className="pdlg-row" style={{ padding: "10px 0" }}>
                <span className="k row" style={{ gap: 10 }}><Ic d={icons.stethoscope} s={16} /> Admission Type</span>
                <span className="v">{bed.admission_type === "DAYCARE" ? "Daycare" : bed.admission_type === "OPD" ? "OPD" : "IP"}</span>
              </div>
            )}
            {bed.physical_status === "OCCUPIED" && (
              <div className="pdlg-row" style={{ padding: "10px 0" }}>
                <span className="k row" style={{ gap: 10 }}><Ic d={icons.user} s={16} /> IP ID</span>
                <span className="v">{bed.ip_last6 || "Not recorded"}</span>
              </div>
            )}
            {bed.physical_status === "OCCUPIED" && bed.payer_type && (
              <div className="pdlg-row" style={{ padding: "10px 0" }}>
                <span className="k row" style={{ gap: 10 }}><Ic d={icons.wallet} s={16} /> Payer</span>
                <span className="v">{bed.payer_type}</span>
              </div>
            )}
            {bed.physical_status === "OCCUPIED" && (bed.consultant_name || bed.department_name) && (
              <div className="pdlg-row" style={{ padding: "10px 0" }}>
                <span className="k row" style={{ gap: 10 }}><Ic d={icons.building} s={16} /> Consultant / Dept</span>
                <span className="v">{[bed.consultant_name, bed.department_name].filter(Boolean).join(" / ")}</span>
              </div>
            )}
          </>
        )}
        {bed.physical_status === "OCCUPIED" && dischargeBadge(bed.discharge_tracking) && (
          <div className="pdlg-row" style={{ padding: "10px 0" }}>
            <span className="k row" style={{ gap: 10 }}><Ic d={icons.clipboard} s={16} /> Discharge Status</span>
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
          {cfg.readOnly ? (
            <div style={{ display: "flex", gap: 10 }}>
              {[["VACANT", "var(--st-v)", "Vacant"], ["OCCUPIED", "var(--st-o)", "Occupied"]].map(([val, c, lbl]) => (
                <div key={val} style={{
                  flex: 1, padding: "13px 0", borderRadius: 12, fontSize: 14.5, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                  border: `2px solid ${physical === val ? c : "var(--line)"}`,
                  background: physical === val ? c : "var(--panel)",
                  color: physical === val ? "#fff" : "var(--ink-2)",
                  opacity: physical === val ? 1 : 0.4,
                }}><Ic d={icons.bed} s={16} /> {lbl}</div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              {[["VACANT", "var(--st-v)", "Vacant"], ["OCCUPIED", "var(--st-o)", "Occupied"]].map(([val, c, lbl]) => {
                const vacantDisabled = val === "VACANT" && bed.physical_status === "OCCUPIED";
                return (
                  <button key={val} disabled={vacantDisabled} onClick={() => !vacantDisabled && handleSetPhysical(val)} style={{
                    flex: 1, padding: "13px 0", borderRadius: 12, fontSize: 14.5, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                    border: `2px solid ${physical === val ? c : "var(--line)"}`,
                    background: physical === val ? c : "var(--panel)",
                    color: physical === val ? "#fff" : "var(--ink-2)",
                    cursor: vacantDisabled ? "not-allowed" : "pointer", transition: "all 0.15s",
                    opacity: vacantDisabled ? 0.4 : 1,
                  }}><Ic d={icons.bed} s={16} /> {lbl}</button>
                );
              })}
            </div>
          )}
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
            {renderDeptDoctorPicker()}
            {!selectedDeptId && (
              <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Select a department.</div>
            )}
            {selectedDeptId && !selectedDoctorId && (
              <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Select a consultant.</div>
            )}
          </div>
        )}

        {/* Payer type — only needed for fresh admission (VACANT → OCCUPIED); for occupied beds edit via Patient Information */}
        {needsIp && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
              Payer Type <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>
            </div>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex", pointerEvents: "none" }}>
                <Ic d={icons.wallet} s={16} />
              </span>
              <select className="field" value={payer}
                onChange={(e) => setPayer(e.target.value)}
                style={{ paddingLeft: 40, borderColor: !payer ? "var(--red)" : undefined }}>
                <option value="">— Select payer type —</option>
                {payerTypes.map(pt => <option key={pt.id} value={pt.name}>{pt.name}</option>)}
              </select>
            </div>
            {!payer && (
              <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Payer type is required for new admissions.</div>
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
              {!cfg.readOnly && bed.bed_type !== "Lounge" && (
                <button onClick={() => setReservationOpen(true)} style={{
                  display: "flex", alignItems: "center", gap: 8, flex: "1 1 140px",
                  background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 12,
                  padding: "12px 14px", fontSize: 13, fontWeight: 600, color: "var(--ink)", cursor: "pointer",
                }}>
                  <Ic d={icons.bookmark} s={15} style={{ color: "var(--st-vr)" }} />
                  Reservation
                  <span className="dim" style={{ fontSize: 11, marginLeft: "auto" }}>{bed.reservation_status === "RESERVED" ? "Reserved" : "None"}</span>
                </button>
              )}
              {cfg.role === "PRE" && bed.bed_type !== "Lounge" && (
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
                const canPlanRole = cfg.role === "PRE" || cfg.role === "DOCTOR" || cfg.role === "CONSULTANT";
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
              {[["NONE", "var(--ink-2)", "None", icons.ban], ["RESERVED", "var(--st-vr)", "Reserved", icons.bookmark]].map(([val, c, lbl, ic]) => (
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
        <ReservationPopup bed={bed} destinations={destinations} onClose={() => setReservationOpen(false)} onSave={async (...args) => {
          await onSave(...args);
          const newRes = args[2];
          const newDest = args[4];
          if (newRes !== undefined) setReservation(newRes);
          if (newDest !== undefined) setDestination(newDest);
        }} />,
        document.body
      )}
      {transferOpen && createPortal(
        <TransferPopup bed={bed} wards={wards} onClose={() => setTransferOpen(false)}
          onSaved={(r) => {
            setTransferOpen(false);
            // Pass the current bed's already-loaded patient data (payer, department,
            // doctor, discharge tracking, etc.) along with the transfer result — a
            // transfer carries all of that over unchanged, so onTransferred can jump
            // straight to the destination bed fully populated, with no refetch (and
            // no intermediate ward-list page) needed first.
            if (onTransferred) onTransferred(r, bed);
            else { onChanged?.(); onClose(); }
          }} />,
        document.body
      )}
      {dischargePlanOpen && createPortal(
        <DischargePlanPopup bed={bed} canInitiate={cfg.role === "PRE" || cfg.role === "CONSULTANT"} onClose={() => setDischargePlanOpen(false)}
          onDone={() => { setDischargePlanOpen(false); onChanged?.(); setDischargeOpen(true); }} />,
        document.body
      )}

      {/* Footer actions */}
      <div style={{ display: "flex", gap: 10, marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
        {cfg.readOnly ? (
          <button className="btn btn-ghost" style={{ flex: 1, padding: "13px 0", borderRadius: 12, fontSize: 14.5 }} onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" style={{ flex: 1, padding: "13px 0", borderRadius: 12, fontSize: 14.5 }} onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" style={{ flex: 1.6, padding: "13px 0", borderRadius: 12, fontSize: 14.5 }}
              disabled={saving || noChanges || (needsPayer && !payer) || (!showActionsRow && needsDestination && !destination) || (!showActionsRow && needsResNote && !resNote.trim()) || (needsIp && !ipValid) || (needsIp && !admissionType)}
              onClick={handleSave}>
              <Ic d={icons.save} s={16} /> {saving ? "Saving…" : "Update Status"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  WARD PAGE — full-page ward view (View / Manage / Discharge tabs, no popup)
// ══════════════════════════════════════════════════════════════════════════════
export function WardPage({ ward, initialTab, onBack, allWards, cfg = PRE_CFG, focusBedId }) {
  const [tab, setTab] = useState(initialTab || "manage");
  const [beds, setBeds] = useState([]);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [editingBed, setEditingBed] = useState(null);  // bed object | null
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  const [toast, setToast] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reviewedAt, setReviewedAt] = useState(ward.reviewedAt ?? null);
  // Reference/lookup data (payer types, destinations, departments) — not tied to any
  // one bed, so it's fetched once per ward visit here and passed down, instead of
  // BedDetailSheet re-fetching it on every mount (e.g. every time key={liveBed.id}
  // forces a remount, such as right after a transfer).
  const [payerTypes, setPayerTypes] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [departments, setDepartments] = useState([]);
  // Optional-chained: read-only cfgs (e.g. CONSULTANT) omit the endpoints they
  // can't use, so a missing fetcher must be a no-op rather than a crash.
  useEffect(() => {
    cfg.payerTypes?.().then(r => setPayerTypes(r.payerTypes || [])).catch(() => { });
    cfg.destinations?.().then(r => setDestinations(r.destinations || [])).catch(() => { });
    api.departments().then(r => setDepartments(r.departments || [])).catch(() => { });
  }, [cfg]);

  const showToast = useCallback((m) => {
    setToast(m); setTimeout(() => setToast(""), 2000);
  }, []);

  // Mirrors the backend's 5-minute cooldown (pre.ts) so the button visibly
  // disables/counts down instead of just failing silently on the next tap.
  const REVIEW_COOLDOWN_MS = 5 * 60 * 1000;
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!reviewedAt || Date.now() - reviewedAt >= REVIEW_COOLDOWN_MS) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [reviewedAt]);
  const cooldownMsLeft = reviewedAt ? Math.max(0, REVIEW_COOLDOWN_MS - (nowTick - reviewedAt)) : 0;
  const inCooldown = cooldownMsLeft > 0;

  const reviewWard = async () => {
    if (!cfg.reviewWard || reviewing || inCooldown) return;
    setReviewing(true);
    try {
      const r = await cfg.reviewWard(ward.id);
      setReviewedAt(r.reviewedAt);
      setNowTick(Date.now());
      showToast("Ward marked reviewed ✓");
    } catch (e) { showToast(toastErr(e)); }
    finally { setReviewing(false); }
  };

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

  const focusedRef = useRef(false);
  useEffect(() => {
    if (focusBedId && beds.length > 0 && !focusedRef.current) {
      const match = beds.find(b => b.id === focusBedId);
      if (match) { setEditingBed(match); focusedRef.current = true; }
    }
  }, [focusBedId, beds]);

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
    socket.on("bed:update", onData);
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
    if (q && !b.bed_name.toLowerCase().includes(q) && !(b.ip_last6 && b.ip_last6.includes(q))) return false;
    if (filter === "KIMS") return b.unit_type === "KIMS";
    if (filter === "Renova") return b.unit_type?.includes("Renova");
    if (filter === "Op") return !!b.operational_status;
    if (filter === "Non-Op") return !b.operational_status;
    if (filter === "Vacant") return b.physical_status === "VACANT";
    if (filter === "Occupied") return b.physical_status === "OCCUPIED";
    if (filter === "Reserved") return b.reservation_status === "RESERVED";
    return true;
  });

  // Optimistic update — snapshot restored on failure; unit_type preserved via spread
  const changeStatus = useCallback(async (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId) => {
    if (!cfg.updateBedStatus) return;  // read-only cfg (CONSULTANT) — nothing to save
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
          ...(physicalStatus === "VACANT" ? { ip_last6: null, admission_type: null, consultant_name: null, department_name: null, doctor_id: null, department_id: null, discharge_tracking: null } : {}),
          ...(ipLast6 ? { ip_last6: ipLast6 } : {}),
          ...(admissionType ? { admission_type: admissionType } : {}),
          ...(consultantName !== undefined ? { consultant_name: consultantName } : {}),
          ...(departmentName !== undefined ? { department_name: departmentName } : {}),
          ...(doctorId ? { doctor_id: doctorId } : {}),
          ...(departmentId ? { department_id: departmentId } : {}),
        }
        : b);
    });
    try {
      await cfg.updateBedStatus(bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId);
    } catch (e) {
      setBeds(snapshot);
      showToast(toastErr(e));
      throw e;  // re-throw so handleSave knows the save failed and skips the success toast
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
    { key: "ALL", label: "All beds" },
    { key: "Vacant", label: "Vacant" },
    { key: "Occupied", label: "Occupied" },
    { key: "Reserved", label: "Reserved" },
    { key: "Non-Op", label: "Non-operational" },
    { key: "KIMS", label: "KIMS" },
    { key: "Renova", label: "Renova" },
  ].filter(o => o.key === "ALL" || fc[o.key] > 0);

  // Rendered inline in WardPage (NOT as a nested component) so the input keeps
  // focus across keystrokes — a component defined inside render remounts every time.
  const searchBar = (
    <div className="ward-search-row" style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
      <div className="field-search" style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex" }}>
          <Ic d={icons.search} s={15} />
        </span>
        <input
          className="field"
          value={search}
          placeholder="Search bed or IP…"
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
        className="field field-select"
        aria-label="Filter beds"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ width: "auto", flex: "0 1 auto", maxWidth: 150, fontWeight: 600 }}
      >
        {FILTER_OPTIONS.map(o => (
          <option key={o.key} value={o.key}>{o.label} ({fc[o.key] ?? fc.ALL})</option>
        ))}
      </select>
      {/* Jump straight to one bed — opens the bed's edit page. */}
      {sortedBeds.length > 1 && (
        <select
          className="field field-select"
          aria-label="Go to bed"
          value=""
          onChange={(e) => {
            const b = sortedBeds.find((x) => String(x.id) === e.target.value);
            if (!b) return;
            if (b.operational_status !== false) setEditingBed(b);
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
          {q ? `No bed or IP matching "${search.trim()}" in this filter.` : "No beds in this filter."}
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
        { n: sum.total, l: "Total Beds", ic: icons.bed, c: "var(--primary)", bg: "var(--st-vr-bg)" },
        { n: sum.vacant, l: "Vacant", ic: icons.bed, c: "var(--st-v)", bg: "var(--st-v-bg)" },
        { n: sum.occupied, l: "Occupied", ic: icons.user, c: "var(--st-o)", bg: "var(--st-o-bg)" },
        { n: sum.planned, l: "Planned", ic: icons.clipboard, c: "var(--st-vr)", bg: "var(--st-vr-bg)" },
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
          // Keyed by bed id so a transfer (or any other path that swaps which bed
          // is being edited) fully remounts the sheet instead of reusing the same
          // instance — otherwise its local form state (physical, reservation,
          // payer, etc.), all seeded once via useState(bed.xxx), keeps stale
          // values from the previous bed and can briefly render a mismatched,
          // confusing form (e.g. the fresh-admission form flashing over a bed
          // that was never actually vacated for a new patient).
          key={liveBed.id}
          bed={liveBed}
          payerTypes={payerTypes}
          destinations={destinations}
          departments={departments}
          wards={(allWards || []).map(w => ({ id: w.id, name: w.ward }))}
          onSave={async (bedId, physical, reservation, payer, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId) => {
            const stillOccRes = physical === "OCCUPIED" && reservation === "RESERVED";
            const stillVacRes = physical === "VACANT" && reservation === "RESERVED";
            setEditingBed(prev => ({
              ...prev, physical_status: physical, reservation_status: reservation,
              payer_type: physical === "VACANT" ? null : (payer ?? prev.payer_type),
              destination: stillOccRes ? (destination ?? prev.destination) : null,
              reservation_note: stillVacRes ? (reservationNote ?? prev.reservation_note) : null,
              ...(ipLast6 ? { ip_last6: ipLast6 } : {}),
              ...(admissionType ? { admission_type: admissionType } : {}),
              ...(consultantName !== undefined ? { consultant_name: consultantName } : {}),
              ...(departmentName !== undefined ? { department_name: departmentName } : {}),
              ...(doctorId ? { doctor_id: doctorId } : {}),
              ...(departmentId ? { department_id: departmentId } : {}),
            }));
            await changeStatus(bedId, physical, reservation, payer, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId);
          }}
          onClose={() => setEditingBed(null)}
          onChanged={load}
          onToast={showToast}
          cfg={cfg}
          onTransferred={(r, fromBed) => {
            // A transfer carries the admission's patient data over unchanged — we
            // already have it (fromBed, the bed we were just on) and the transfer
            // result (r) tells us where it landed. No need to wait on a refetch (or
            // pass through the ward-list page) before showing the destination bed:
            // patch beds optimistically so the lookup below resolves to fresh data
            // immediately, then jump straight there. No extra load() here — the
            // backend's discharge:update socket event (sent to both wards) already
            // reconciles this ward's beds shortly after, same as every other
            // mutation in this app; calling load() again here would just be a
            // second, unneeded fetch racing that self-echo.
            setBeds(prev => prev.map(b => {
              if (b.id === r.fromBedId) {
                return {
                  ...b, physical_status: "VACANT", reservation_status: "NONE",
                  ip_last6: null, admission_type: null, consultant_name: null, department_name: null,
                  doctor_id: null, department_id: null, payer_type: null,
                  destination: null, reservation_note: null, discharge_tracking: null,
                };
              }
              if (b.id === r.toBedId && r.toWardId === ward.id) {
                return {
                  ...b, physical_status: "OCCUPIED", reservation_status: "NONE",
                  ip_last6: fromBed.ip_last6, admission_type: fromBed.admission_type,
                  consultant_name: fromBed.consultant_name, department_name: fromBed.department_name,
                  doctor_id: fromBed.doctor_id, department_id: fromBed.department_id,
                  payer_type: fromBed.payer_type, discharge_tracking: fromBed.discharge_tracking,
                };
              }
              return b;
            }));
            setEditingBed(r.toWardId === ward.id ? { id: r.toBedId } : null);
            showToast(`Transferred to ${r.toBedName}${r.toWardName ? " · " + r.toWardName : ""} ✓`);
          }}
        />
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="slide-up">
      <div className="ward-page-hdr">
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <BackBtn onClick={onBack} />
          <div style={{ minWidth: 0 }}>
            <div className="h1" style={{ fontSize: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ward.ward}</div>
            <div className="dim" style={{ fontSize: 11.5 }}>
              {beds.length} bed{beds.length !== 1 ? "s" : ""}
              {tab === "manage" && reviewedAt
                ? <> · <Ic d={icons.check} s={11} /> Reviewed {fmtRelative(reviewedAt)}</>
                : tab === "manage" && cfg.reviewWard ? " · Not reviewed yet" : ""}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexShrink: 0 }}>
          {tab === "manage" && cfg.reviewWard && (
            <button className="btn btn-ghost ward-review-btn"
              disabled={reviewing || inCooldown} onClick={reviewWard}
              title={inCooldown ? `Available again in ${Math.ceil(cooldownMsLeft / 60000)}m` : "No changes needed — mark this ward reviewed"}>
              {reviewing ? "…" : inCooldown ? `${Math.ceil(cooldownMsLeft / 60000)}m` : "Review"}
            </button>
          )}
        </div>
      </div>

      {/* Tab bar — Discharges is a first-class tab, not a popup */}
      <div className="seg" style={{ marginBottom: 14, maxWidth: 420 }}>
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
          {loading ? spinner : beds.length === 0 ? emptyState : <BedGrid clickable />}
          {!loading && beds.length > 0 && summaryStrip}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
