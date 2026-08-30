import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { api, startAlarm, stopAlarm, fmtTime, fmtClock, fmtDMY, toastErr, getSocket, onReconnect, coalesce, getWardBeds, setWardBeds } from "./lib.js";
import { RelativeTime } from "./relativeClock.jsx";
import { Ic, icons, StatusBar, ThemeToggle, useModal, useConfirm, useScrollRestore } from "./ui.jsx";
import { AppShell, useProfileMenuSlot } from "./shell.jsx";
import { OverstayPanel } from "./COOApp.jsx";
import { naturalSort, bedStateColor, bedStateBg, bedStateShort, calculateWardTotals, dischargeBadge, dischargeProgress, bedCurrentStatus, normalizeQuery, bedMatchesPatientName, wardIdsMatchingPatientName, PATIENT_NAME_MIN_QUERY } from "./bedUtils.js";
import DischargeTab, { TransferSection } from "./DischargeTab.jsx";
import DischargesPage from "./DischargesPage.jsx";
import { LiveBedDashboard, useLiveBedDashboardData } from "./COOApp.jsx";
// Spray-bottle icon for the cleaning card — a stroked SVG so it inherits
// currentColor and tracks --st-clean.
const CLEAN_ICON = <>
  <rect x="8" y="11" width="7" height="10" rx="1.5" />
  <rect x="10" y="8" width="3" height="3" />
  <rect x="8" y="5" width="8" height="3" rx="1" />
  <path d="M8 10 6 12" />
  <path d="M18 5 20 4" />
  <path d="M19 8 21 8" />
  <path d="M18 11 20 12" />
</>;

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
  // Bulk hospital-wide bed list (already fetched for the Home dashboard) — reused
  // client-side for IP search instead of a dedicated network call per search.
  bedDetails: () => api.preBedDetails(),
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
  // Lives here, above the Home/Entry/Discharges tab switch, so it survives
  // navigating away from and back to Home — see useLiveBedDashboardData.
  const dashboardData = useLiveBedDashboardData("pre", tab === "home");

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

  // Real-time updates via WebSocket — replaces 15-second polling. Shared
  // connection (see getSocket() in lib.js) — .off() each listener on
  // cleanup, never .disconnect(), since other mounted screens (e.g. an open
  // WardPage) are using the same connection.
  // True while Entry has a ward open (WardPage replaces the grid entirely).
  // A ref, not state, so flipping it never re-runs the socket effect below.
  const wardOpenRef = useRef(false);
  const setWardOpen = useCallback((v) => { wardOpenRef.current = v; }, []);

  // Refetching /me is only worth it for something currently on screen. While a
  // ward is open, Entry renders WardPage ALONE — data.wards and data.summary are
  // not rendered at all, and WardPage loads its own beds. The one thing from /me
  // that still matters there is data.alarm, which drives the beep, the banner and
  // the nav dot — so alarm-bearing events are never skipped. Coming back out
  // calls onRefresh() (see Entry's onBack), which reloads before the grid is
  // shown again, so the counts a user actually sees are never stale.
  const ALARM_EVENTS = ["round:submit", "alarm:active"];

  // Set when an event that WOULD have refreshed the grid arrives while a ward is
  // open. Coming back then reloads only if something actually happened — walking
  // into a ward and straight back out costs no request at all, while a grid that
  // genuinely moved is never shown stale.
  const gridStaleRef = useRef(false);

  useEffect(() => {
    const socket = getSocket();
    // Coalesced: PRE joins "overview", so it receives the scheduler's
    // per-block alarm:active burst every 30s too. See coalesce().
    const refresh = coalesce(() => { gridStaleRef.current = false; loadRef.current(); setLiveKey(k => k + 1); });
    const events = ["bed:update", "discharge:update", "discharge:overstay", "round:submit", "alarm:active", "ward:operational"];
    const handlers = events.map((ev) => {
      const affectsAlarm = ALARM_EVENTS.includes(ev);
      const h = () => {
        if (wardOpenRef.current && !affectsAlarm) { gridStaleRef.current = true; return; }
        refresh();
      };
      socket.on(ev, h);
      return [ev, h];
    });
    // Only a RECONNECT refreshes — the first connect would just duplicate the
    // mount-time load() a few hundred ms later. See onReconnect().
    // Deliberately NOT gated on wardOpenRef: after a disconnect nothing local can
    // be trusted, so resync regardless of what is on screen.
    const offReconnect = onReconnect(socket, refresh);
    return () => { for (const [ev, h] of handlers) socket.off(ev, h); offReconnect(); refresh.cancel(); };
  }, []);

  // Handed to Entry as its onBack refresh. Reloads only when the grid actually
  // went stale while the user was inside a ward (see gridStaleRef above).
  const refreshGridIfStale = useCallback(() => {
    if (!gridStaleRef.current) return;
    gridStaleRef.current = false;
    loadRef.current();
  }, []);

  const alarmActive = data?.alarm?.alarmActive;

  // Silencing the beep is NOT the same as resolving the alarm — every visual
  // cue (nav dot, banner, pulsing Submit button) keeps tracking raw
  // `alarmActive` untouched below. Only the AUDIO is gated behind `acknowledged`:
  // it goes quiet once the user demonstrably starts responding (opens Entry, or
  // saves a bed), and re-arms itself after a period of no further activity so
  // "opened the tab once" can't turn into a silent snooze for the rest of the round.
  const ALARM_IDLE_MS = 3 * 60 * 1000; // grace period of inactivity before the beep resumes
  const [acknowledged, setAcknowledged] = useState(false);
  const lastEngagementRef = useRef(null); // Date.now() of the last sign of activity, or null
  const seenRoundStartRef = useRef(null); // round.startMin last seen while alarmActive was true

  // Resets acknowledgment whenever there's a genuinely NEW debt to acknowledge:
  // the alarm just turned on, or — because a user can stay unsubmitted straight
  // through a round boundary — the 2-hour round rolled over while still active.
  // Also resets (to a clean idle state, not a "silenced" one) whenever nothing
  // is currently overdue, so the next activation always starts unacknowledged.
  useEffect(() => {
    const alarm = data?.alarm;
    const roundStart = alarm?.round?.startMin ?? null;
    if (!alarm?.alarmActive) {
      setAcknowledged(false);
      lastEngagementRef.current = null;
      seenRoundStartRef.current = roundStart;
      return;
    }
    if (seenRoundStartRef.current !== roundStart) {
      setAcknowledged(false);
      lastEngagementRef.current = null;
      seenRoundStartRef.current = roundStart;
    }
  }, [data?.alarm?.alarmActive, data?.alarm?.round?.startMin]);

  // Call on any concrete sign the PRE user is actively responding to the overdue
  // round (opening Entry, saving a bed). A no-op while nothing is overdue.
  const acknowledgeAlarm = useCallback(() => {
    if (!alarmActive) return;
    lastEngagementRef.current = Date.now();
    setAcknowledged(true);
  }, [alarmActive]);

  // Idle watchdog — only runs while silenced, so it costs nothing the rest of
  // the time. Polls rather than a single setTimeout because `acknowledgeAlarm`
  // can push the deadline out repeatedly (e.g. one bed save after another)
  // without this effect needing to re-run on every single engagement.
  useEffect(() => {
    if (!acknowledged) return;
    const id = setInterval(() => {
      if (lastEngagementRef.current !== null && Date.now() - lastEngagementRef.current >= ALARM_IDLE_MS) {
        setAcknowledged(false);
      }
    }, 15 * 1000);
    return () => clearInterval(id);
  }, [acknowledged]);

  const audioShouldPlay = alarmActive && !acknowledged;
  useEffect(() => {
    if (audioShouldPlay) startAlarm(); else stopAlarm();
    return () => stopAlarm();
  }, [audioShouldPlay]);

  // Reaching the Entry tab — however the user got there (nav item, the alarm
  // banner's "Enter bed status" button, or the RoundDuePopup's "Go" button) —
  // is itself the engagement signal, so this is keyed off the resulting `tab`
  // state rather than duplicated across every button that can set it.
  useEffect(() => {
    if (tab === "entry") acknowledgeAlarm();
  }, [tab, acknowledgeAlarm]);

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
            <LiveBedDashboard data={dashboardData} userName={user.username || data.pre} scope="pre" />
          </>
        )}
        {tab === "entry" && <Entry data={data} submitRound={submitRound} submitting={submitting} alarmActive={alarmActive} onRefresh={refreshGridIfStale} onEngage={acknowledgeAlarm} onWardOpen={setWardOpen} />}
        {tab === "discharges" && <DischargesPage role="PRE" />}
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
function Entry({ data, submitRound, submitting, alarmActive, onRefresh, onEngage, onWardOpen }) {
  const [openWard, setOpenWard] = useState(null); // { ward, tab, search? } | null
  const [wardFilter, setWardFilter] = useState("all"); // "all" | ward id
  const [wardSearch, setWardSearch] = useState("");
  const [ipMatch, setIpMatch] = useState(null); // { wardId } | null — resolved IP lookup
  const [ipNotFound, setIpNotFound] = useState(false);
  // Hospital-wide bed list — same data the Home dashboard already fetches —
  // pulled once, lazily, the first time it's needed, then cached for the rest
  // of this page visit. Every IP search after that is a pure client-side scan,
  // no network call at all.
  const [bedDetails, setBedDetails] = useState(null);
  const bedDetailsLoadingRef = useRef(false);

  // Opening a ward replaces this whole grid with WardPage — without this, the
  // ward always starts scrolled wherever the grid happened to be, and going
  // back drops you at the top of the grid instead of back where you were.
  // saveWardScroll() must be called at each place that OPENS a ward, before
  // setOpenWard — see useScrollRestore's doc comment for why.
  const saveWardScroll = useScrollRestore(!!openWard);

  // Tell PREApp whether the ward grid is on screen, so its socket handler can
  // skip refetching /me for data nobody is looking at. Cleared on unmount too —
  // switching tabs unmounts Entry without ever running the openWard=null branch.
  useEffect(() => {
    onWardOpen?.(!!openWard);
    return () => onWardOpen?.(false);
  }, [openWard, onWardOpen]);

  // A 6-digit search value is treated as an IP lookup instead of a ward-name
  // filter — narrows the ward grid down to the one matching ward's card (same
  // as today's ward-name search narrowing to matching cards), but does NOT
  // navigate in automatically — the user still clicks the card themselves,
  // same as any other ward. WardPage's search box is pre-seeded with the IP
  // once opened, so it shows just that one bed.
  // A 2+ character non-IP query is ALSO tried as a patient name, on top of the
  // ward-name match it already does. Both lookups need the hospital-wide bed
  // list, so the fetch below now triggers for either.
  const isIpSearch = /^\d{6}$/.test(wardSearch.trim());
  const nameQuery = isIpSearch ? "" : normalizeQuery(wardSearch);
  const needsBedLookup = isIpSearch || nameQuery.length >= PATIENT_NAME_MIN_QUERY;

  useEffect(() => {
    setIpNotFound(false);
    if (!needsBedLookup) { setIpMatch(null); return; }
    if (bedDetails === null) {
      if (!bedDetailsLoadingRef.current) {
        bedDetailsLoadingRef.current = true;
        PRE_CFG.bedDetails().then((r) => setBedDetails(r || [])).catch(() => setIpNotFound(true));
      }
      return; // effect re-runs once bedDetails lands
    }
    // Only an IP search reports "not found" — a name query that matches nothing
    // still legitimately falls through to the ward-name filter.
    if (!isIpSearch) { setIpMatch(null); return; }
    const bed = bedDetails.find((b) => b.ip_last6 === wardSearch.trim());
    if (bed) setIpMatch({ wardId: bed.ward_id });
    else { setIpMatch(null); setIpNotFound(true); }
  }, [wardSearch, bedDetails, needsBedLookup, isIpSearch]);

  const nameWardIds = useMemo(
    () => wardIdsMatchingPatientName(bedDetails, nameQuery),
    [bedDetails, nameQuery],
  );

  // Full-page ward view — replaces the grid entirely (no popup stack).
  if (openWard) return (
    <WardPage
      ward={openWard.ward}
      initialTab={openWard.tab}
      initialSearch={openWard.search}
      onBack={() => { setOpenWard(null); onRefresh(); }}
      onBedSaved={onEngage}
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

      {/* Search + ward picker — one row that stays a row, the two controls the
          same height and shape as the ward page's. */}
      <div className="pill-search entry-tools">
        <div className="entry-search">
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex" }}>
            <Ic d={icons.search} s={15} />
          </span>
          <input
            className="field"
            value={wardSearch}
            placeholder="Search ward, patient, or IP…"
            style={{ paddingLeft: 38, paddingRight: wardSearch ? 36 : 15 }}
            onChange={(e) => setWardSearch(e.target.value)}
          />
          {wardSearch && (
            <button
              onClick={() => setWardSearch("")}
              aria-label="Clear search"
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex", padding: 4, background: "none", border: "none", cursor: "pointer" }}
            >
              <Ic d={icons.x} s={14} />
            </button>
          )}
        </div>
        {data.wards.length > 1 && (
          <select className="field pill-select" aria-label="Filter by ward" value={wardFilter}
            onChange={(e) => setWardFilter(e.target.value)}>
            <option value="all">All wards ({data.wards.length})</option>
            {data.wards.map((w) => <option key={w.id} value={String(w.id)}>{w.ward}</option>)}
          </select>
        )}
      </div>

      {ipNotFound && (
        <div className="dim" style={{ fontSize: 13, padding: "10px 2px", marginBottom: 8 }}>
          No patient found with that IP in your wards.
        </div>
      )}

      {(data.blocks ?? [{ id: data.preBlockId, name: "", wards: data.wards }]).map((block, bi) => {
        const wq = wardSearch.trim().toLowerCase();
        // A non-IP query keeps ward cards that match by ward name OR that hold a
        // patient of that name — the two are additive, so adding patient search
        // never hides a ward the old ward-name search would have shown.
        const visibleWards = block.wards.filter((w) =>
          (wardFilter === "all" || String(w.id) === wardFilter) &&
          (isIpSearch ? ipMatch?.wardId === w.id
                      : (!wq || w.ward.toLowerCase().includes(wq) || nameWardIds.has(w.id)))
        );
        // Pre-seed the ward's own bed search only when the ward was found VIA a
        // bed — by IP, or by a patient name that isn't also the ward's name.
        // Seeding it with a ward-name query would filter every bed out and land
        // the user on an apparently empty ward.
        const seedSearch = (w) =>
          isIpSearch || (nameWardIds.has(w.id) && !w.ward.toLowerCase().includes(wq))
            ? wardSearch.trim()
            : undefined;
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
                  // Renders instantly, like BedGridCard. The staggered slide-up
                  // (0.03s per card on top of a 0.35s animation with fill-mode
                  // `both`) left later cards fully invisible for most of a
                  // second, so a grid whose data was already in hand looked like
                  // it was still loading — and it replayed on every return from
                  // a ward, which unmounts and remounts the whole grid.
                  <div className="ward-card" key={w.id}
                    style={{
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
                          onClick={() => { saveWardScroll(); setOpenWard({ ward: w, tab: "manage", search: seedSearch(w) }); }}>
                          <Ic d={icons.bed} s={13} /> Manage Beds
                        </button>
                        <button className="btn btn-ghost" style={{ flex: "1 1 88px", padding: "9px 0", fontSize: 13 }}
                          onClick={() => { saveWardScroll(); setOpenWard({ ward: w, tab: "discharge", search: seedSearch(w) }); }}>
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

/** Overstay — System Checkout done but the patient hasn't actually left yet
 *  (the same condition the Admin dashboard counts as "overstay"). patient_left
 *  can never be true here while still Occupied — completeIfEligible vacates the
 *  bed the moment both are true, so checking it is enough. */
export function isOverstay(bed) {
  return bed.physical_status === "OCCUPIED"
    && bed.discharge_tracking?.system_checkout_status === "COMPLETED"
    && bed.discharge_tracking?.patient_left !== true;
}

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
  const overstay = isOverstay(bed);
  const hasRows = !!(
    (occupied && (bed.payer_type || bed.ip_last6 || bed.admission_type || (!hideDoctorDept && (bed.consultant_name || bed.department_name)))) || dischargeStarted ||
    (occupied && bed.reservation_status === "RESERVED" && bed.destination) ||
    (!occupied && bed.reservation_status === "RESERVED" && bed.reservation_note) ||
    (occupied && bed.bed_type === "Lounge" && (bed.origin_ward_name || bed.origin_bed_name))
  );

  const cleaning = bed.housekeeping_status;
  const cleaningInProgress = cleaning === "IN_PROGRESS";

  if (cleaning) {
    return (
      <div
        className={"pbed st-clean" + (onClick ? " tap" : "")}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      >
        {wardLabel && (
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-3)", letterSpacing: ".02em", marginBottom: -2, paddingTop: 2 }}>{wardLabel}</div>
        )}
        <div className="pbed-head">
          <span className="pbed-name">{bed.bed_name}</span>
          <span className="pbadge clean">
            {cleaningInProgress ? "CLEANING" : "PENDING"}
          </span>
        </div>

        <div className="pbed-idle">
          <span className="ring" style={{ background: "color-mix(in srgb,var(--st-clean) 10%,transparent)", color: "var(--st-clean)" }}>
            <Ic d={CLEAN_ICON} s={20} style={{ pointerEvents: "none" }} />
          </span>
        </div>

        <div style={{ textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>
          {cleaningInProgress ? "Cleaning in progress" : "Awaiting cleaning"}
        </div>

        <div className="pbed-foot">
          <span>Updated <RelativeTime ts={bed.updated_at} /></span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {bed.reservation_status === "RESERVED" && (
              <span className="pbed-stamp">
                <Ic d={icons.bookmark} s={11} /> RESERVED
              </span>
            )}
            {onClick && <Ic d={icons.chevron} s={13} style={{ color: "var(--ink-3)" }} />}
          </div>
        </div>
      </div>
    );
  }

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

      {occupied && bed.ip_last6 && (
        <div className="pbed-kv"><span className="pk">IP</span><span className="pv" title={bed.ip_last6}>{bed.ip_last6}</span></div>
      )}
      {occupied && bed.bed_type === "Lounge" && bed.origin_ward_name && (
        <div className="pbed-kv"><span className="pk">From Ward</span><span className="pv" title={bed.origin_ward_name}>{bed.origin_ward_name}</span></div>
      )}
      {occupied && bed.bed_type === "Lounge" && bed.origin_bed_name && (
        <div className="pbed-kv"><span className="pk">From Bed</span><span className="pv" title={bed.origin_bed_name}>{bed.origin_bed_name}</span></div>
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

      {!hasRows && (
        <div className="pbed-idle">
          <span className="ring" style={{ background: bg, color }}><Ic d={icons.bed} s={20} /></span>
        </div>
      )}

      <div className="pbed-foot">
        <span>Updated <RelativeTime ts={bed.updated_at} /></span>
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
function TransferPopup({ bed, onClose, onSaved, onConflict }) {
  useModal(onClose);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ padding: "18px 20px" }}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>Bed Transfer</div>
          <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>Move this patient to a different bed.</div>
          <TransferSection bed={bed} onClose={onClose} onSaved={onSaved} onConflict={onConflict} />
        </div>
      </div>
    </div>
  );
}

// Readmit — moves a patient out of the Discharge Lounge back onto a real bed.
// Reuses TransferSection's ward/bed/reason UI, pointed at the readmit endpoint
// instead of the ordinary transfer one, so it's logged distinctly (is_readmit).
function ReadmitPopup({ bed, onClose, onSaved, onConflict }) {
  useModal(onClose);
  const admissionId = bed.admission_id ?? bed.discharge_tracking?.admission_id;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ padding: "18px 20px" }}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>Readmit</div>
          <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>Move this patient from the Discharge Lounge back onto a real bed.</div>
          <TransferSection
            bed={bed}
            onClose={onClose}
            onSaved={onSaved}
            onConflict={onConflict}
            submitLabel="Confirm Readmit"
            submit={(toWardId, toBedId, reason) => api.readmitFromLounge(admissionId, toWardId, toBedId, reason)}
          />
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
// as one action) — gated by canInitiate, matching who's allowed to start a
// discharge at all (see INITIATE_ROLES in dischargeService.ts on the backend).
// Schedule keeps the familiar Today/Tomorrow/Custom + time picker.
function DischargePlanPopup({ bed, canInitiate, onClose, onDone, onConflict }) {
  useModal(onClose);
  const [mode, setMode] = useState(null); // null | "schedule"
  const [option, setOption] = useState("tomorrow"); // tomorrow | custom
  const [customDate, setCustomDate] = useState(planPopupTodayStr(1));
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const plannedDate = option === "tomorrow" ? planPopupTodayStr(1) : customDate;

  // 409 = someone else already started a discharge (or moved this patient) on
  // this same admission underneath us — same "stale, don't leave a dead form
  // up" case as TransferSection.doSubmit. Reflect the real state automatically
  // instead of showing an inline error the user has to notice and act on.
  function handleError(e) {
    if (e.status === 409 && onConflict) { onConflict(toastErr(e)); return; }
    setError(toastErr(e));
  }

  async function initiateNow() {
    setSaving(true); setError("");
    try {
      const r = await api.dischargePlan(bed.id, planPopupTodayStr(), null);
      await api.dischargeInitiate(r.tracking.admission_id);
      onDone();
    } catch (e) { handleError(e); } finally { setSaving(false); }
  }

  async function schedule() {
    setSaving(true); setError("");
    try {
      await api.dischargePlan(bed.id, plannedDate, time || null);
      onDone();
    } catch (e) { handleError(e); } finally { setSaving(false); }
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
export function BedDetailSheet({ bed, onSave, onClose, onChanged, cfg = PRE_CFG, onToast, onTransferred, payerTypes = [], destinations = [], departments = [] }) {
  const [physical, setPhysical] = useState(bed.physical_status);
  const [reservation, setReservation] = useState(bed.reservation_status);
  const [payer, setPayer] = useState(bed.payer_type || "");
  const [destination, setDestination] = useState(bed.destination || "");
  const [resNote, setResNote] = useState(bed.reservation_note || "");
  const [saving, setSaving] = useState(false);
  const [ipLast6, setIpLast6] = useState("");
  const [patientName, setPatientName] = useState("");
  // "YYYY-MM-DD" throughout — the native date input's own value format, which is
  // also exactly what the API stores, so this never needs parsing or reformatting.
  const [admissionDate, setAdmissionDate] = useState("");
  // Server-supplied date rules: whether a future admission date is allowed, and
  // the server's own today (IST). Both come from /meta rather than being derived
  // from the browser clock, which is the user's timezone and can be wrong.
  const [dateRules, setDateRules] = useState(null);
  const [admissionType, setAdmissionType] = useState("");
  const [consultantName, setConsultantName] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [allDoctors, setAllDoctors] = useState([]);
  const [doctors, setDoctors] = useState([]);
  // Consultant Groups (e.g. "Vijay / Kumari") — an admission owner is either one
  // doctor OR one group, never both; selectedDoctorId/selectedGroupId are kept
  // mutually exclusive throughout (picking one clears the other).
  const [allGroups, setAllGroups] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedDeptId, setSelectedDeptId] = useState(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [deptSearch, setDeptSearch] = useState("");
  const [doctorSearch, setDoctorSearch] = useState("");
  const [deptOpen, setDeptOpen] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);
  // "Discharge Details" replaces this whole bed editor with its own full page —
  // same swap pattern as ward↔bed above, same fix. saveDischargeScroll() must
  // be called at each place that opens it, before setDischargeOpen(true).
  const saveDischargeScroll = useScrollRestore(dischargeOpen);
  const [reservationOpen, setReservationOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [readmitOpen, setReadmitOpen] = useState(false);
  const [dischargeImmediateSaving, setDischargeImmediateSaving] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
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

  useEffect(() => {
    api.doctors().then(r => setAllDoctors(r.doctors || [])).catch(() => { });
    api.consultantGroups().then(r => setAllGroups(r.groups || [])).catch(() => { });
    api.meta().then(setDateRules).catch(() => { });
  }, []);

  // Upper bound for the date picker. Left undefined (no bound) when the server
  // allows future dates, or while /meta is still in flight — guessing a bound
  // from the browser's clock could block a date the server would have accepted.
  // The server validates regardless, so this is a convenience, not the guard.
  const admissionDateMax = dateRules && !dateRules.allowFutureAdmissionDate
    ? dateRules.todayIST
    : undefined;
  const admissionDateValid = /^\d{4}-\d{2}-\d{2}$/.test(admissionDate)
    && (!admissionDateMax || admissionDate <= admissionDateMax);
  const patientNameValid = patientName.trim().length > 0;

  // Single source of truth for the Patient Information edit form's blocking
  // errors — the Save button's disabled state, the field borders and the messages
  // below all read these. Keeping the rule in one place is what stops the button
  // and savePatientInfo's guards from drifting apart: they did once, and clearing
  // an already-set date left Save enabled while the guard silently refused, which
  // reads to the user as a broken button.
  //
  // Null (no error) when the field is blank AND was blank when Edit opened — that
  // is the legacy admission case, which stays saveable so an unrelated correction
  // isn't blocked behind data the user may not have.
  const editSnap = patientInfoSnapshotRef.current;
  const nameError = (editSnap?.patientName || patientName.trim()) && !patientNameValid
    ? "Patient name is required — it can't be left blank."
    : null;
  // A native date input only ever yields "" or a well-formed YYYY-MM-DD, so a
  // non-empty value failing validation can only mean it exceeded the max bound.
  const dateError = (editSnap?.admissionDate || admissionDate) && !admissionDateValid
    ? (admissionDate ? "Date of admission cannot be in the future." : "Date of admission is required — it can't be left blank.")
    : null;
  // Bidirectional filtering: picking a department narrows the consultant/group
  // list to those with that department (below); picking a consultant/group
  // narrows the department list the same way (see availableDepartments in
  // renderDeptDoctorPicker). Because both directions filter their options to
  // stay mutually compatible, an incompatible combo can never be reached via
  // the UI — so neither selection needs to reset the other when the other
  // changes; each dropdown just always offers a valid choice.
  useEffect(() => {
    if (selectedDeptId) {
      setDoctors(allDoctors.filter(d => d.departments?.some(dep => dep.id === selectedDeptId)));
      setGroups(allGroups.filter(g => g.departments?.some(dep => dep.id === selectedDeptId)));
    } else {
      setDoctors(allDoctors);
      setGroups(allGroups);
    }
  }, [selectedDeptId, allDoctors, allGroups]);

  function openEditPatientInfo() {
    const ipLast6Init = bed.ip_last6 || "";
    const admissionTypeInit = bed.admission_type || "";
    const consultantNameInit = bed.consultant_name || "";
    const departmentNameInit = bed.department_name || "";
    const isGroupOwned = bed.owner_type === "GROUP";
    const doctorIdInit = isGroupOwned ? null : (bed.doctor_id || null);
    const groupIdInit = isGroupOwned ? (bed.consultant_group_id || null) : null;
    const deptIdInit = bed.department_id || null;
    const payerInit = bed.payer_type || "";
    // Blank for every admission created before these fields existed. They stay
    // blank — and stay saveable — until someone actually fills them in here.
    const patientNameInit = bed.patient_name || "";
    const admissionDateInit = bed.admission_date || "";
    setIpLast6(ipLast6Init);
    setAdmissionType(admissionTypeInit);
    setConsultantName(consultantNameInit);
    setDepartmentName(departmentNameInit);
    setSelectedDoctorId(doctorIdInit);
    setSelectedGroupId(groupIdInit);
    setSelectedDeptId(deptIdInit);
    setEditPayer(payerInit);
    setPatientName(patientNameInit);
    setAdmissionDate(admissionDateInit);
    patientInfoSnapshotRef.current = {
      ipLast6: ipLast6Init, admissionType: admissionTypeInit,
      consultantName: consultantNameInit, departmentName: departmentNameInit,
      patientName: patientNameInit, admissionDate: admissionDateInit,
      doctorId: doctorIdInit, groupId: groupIdInit, departmentId: deptIdInit, payer: payerInit,
    };
    setEditingPatientInfo(true);
  }

  async function savePatientInfo() {
    if (!/^\d{6}$/.test(ipLast6)) return;
    if (!admissionType || !selectedDeptId || (!selectedDoctorId && !selectedGroupId)) return;

    const snap = patientInfoSnapshotRef.current || {};

    // Same nameError/dateError the Save button reads, so the button can never be
    // enabled for a state this refuses to save. See their definition for the rule:
    // an existing value can't be cleared and an entered value must be complete,
    // but an admission that predates these fields may still be saved with both
    // blank so unrelated corrections aren't gated behind data the user lacks.
    if (nameError || dateError) return;

    // Only send fields that actually changed from the snapshot taken when the
    // edit form opened — avoids resending untouched fields on every save.
    const patch = {};
    if (ipLast6 !== snap.ipLast6) patch.ipLast6 = ipLast6;
    if (admissionType !== snap.admissionType) patch.admissionType = admissionType;
    // Compared against the snapshot, so a still-blank legacy field is simply never
    // sent — which is exactly how the API is told to leave it alone.
    if (patientName.trim() !== (snap.patientName || "")) patch.patientName = patientName.trim();
    if (admissionDate !== (snap.admissionDate || "")) patch.admissionDate = admissionDate;
    if (consultantName !== snap.consultantName) patch.consultantName = consultantName;
    if (departmentName !== snap.departmentName) patch.departmentName = departmentName;
    // doctorId/consultantGroupId are sent together whenever the owner changed —
    // the backend requires both explicitly (even null) so it can tell "unchanged"
    // apart from "switched to the other kind of owner".
    if (selectedDoctorId !== snap.doctorId || selectedGroupId !== snap.groupId) {
      patch.doctorId = selectedDoctorId;
      patch.consultantGroupId = selectedGroupId;
    }
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
    // Bidirectional filtering counterpart: once a consultant/group is selected,
    // the department list narrows to only their departments — same idea as
    // `doctors`/`groups` state already narrowing to the selected department.
    const selectedOwner = selectedGroupId
      ? (allGroups.find(g => g.id === selectedGroupId))
      : selectedDoctorId
        ? (allDoctors.find(d => d.id === selectedDoctorId))
        : null;
    const availableDepartments = selectedOwner
      ? departments.filter(d => selectedOwner.departments?.some(dep => dep.id === d.id))
      : departments;
    const deptResults = availableDepartments.filter(d => !deptSearch || d.name.toLowerCase().includes(deptSearch.toLowerCase()));

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
              {deptResults.map(d => (
                <div key={d.id} onClick={() => { setSelectedDeptId(d.id); setDepartmentName(d.name); setDeptOpen(false); setDeptSearch(""); }}
                  style={{ padding: "10px 14px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--line)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  {d.name}
                </div>
              ))}
              {deptResults.length === 0 && (
                <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--ink-3)" }}>
                  {selectedOwner ? `No departments assigned to ${selectedOwner.name}` : "No departments found"}
                </div>
              )}
            </div>
          )}
        </div>
        {/* Consultant dropdown — individual doctors and Consultant Groups (e.g.
              "Vijay / Kumari") in one combined, searchable list. Picking either
              sets exactly one of selectedDoctorId/selectedGroupId, clearing the
              other — an admission is owned by one or the other, never both. */}
        <div ref={doctorRef} style={{ flex: "1 1 160px", position: "relative" }}>
          <input className="field" style={{ width: "100%", borderColor: (!selectedDoctorId && !selectedGroupId) ? "var(--red)" : undefined }}
            placeholder="Select consultant or group"
            value={doctorOpen ? doctorSearch : (
              selectedGroupId
                ? (groups.find(g => g.id === selectedGroupId)?.name || allGroups.find(g => g.id === selectedGroupId)?.name || "")
                : (doctors.find(d => d.id === selectedDoctorId)?.name || allDoctors.find(d => d.id === selectedDoctorId)?.name || "")
            )}
            onFocus={() => { setDoctorOpen(true); setDoctorSearch(""); }}
            onChange={(e) => setDoctorSearch(e.target.value)} />
          {(selectedDoctorId || selectedGroupId) && !doctorOpen && (
            <span onClick={() => { setSelectedDoctorId(null); setSelectedGroupId(null); setDoctorSearch(""); setConsultantName(""); }}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "var(--ink-3)", fontSize: 16, lineHeight: 1 }}>&times;</span>
          )}
          {doctorOpen && (() => {
            const q = doctorSearch.toLowerCase();
            const doctorOptions = doctors.filter(d => !q || d.name.toLowerCase().includes(q)).map(d => ({ ...d, _kind: "DOCTOR" }));
            const groupOptions = groups.filter(g => !q || g.name.toLowerCase().includes(q)).map(g => ({ ...g, _kind: "GROUP" }));
            const options = [...doctorOptions, ...groupOptions];
            return (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 99, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, maxHeight: 220, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,.12)" }}>
                {options.map(o => (
                  <div key={`${o._kind}-${o.id}`} onClick={() => {
                    if (o._kind === "GROUP") { setSelectedGroupId(o.id); setSelectedDoctorId(null); }
                    else { setSelectedDoctorId(o.id); setSelectedGroupId(null); }
                    setConsultantName(o.name); setDoctorOpen(false); setDoctorSearch("");
                    if (!selectedDeptId && o.departments?.length === 1) {
                      setSelectedDeptId(o.departments[0].id);
                      setDepartmentName(o.departments[0].name);
                    }
                  }}
                    style={{ padding: "10px 14px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--bg)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    {o._kind === "GROUP" && <Ic d={icons.users} s={13} style={{ color: "var(--ink-3)", flexShrink: 0 }} />}
                    {o.name}
                  </div>
                ))}
                {options.length === 0 && (
                  <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--ink-3)" }}>No consultants found</div>
                )}
              </div>
            );
          })()}
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

  const admissionId = bed.admission_id ?? bed.discharge_tracking?.admission_id;

  async function handleDischargeImmediate() {
    const ok = await confirm({
      title: "Discharge Immediate?",
      message: "This marks every remaining discharge step complete and frees this Discharge Lounge bed right away.\n\nThis cannot be undone.",
      confirmLabel: "Yes, discharge now",
      cancelLabel: "Go Back",
      danger: true,
      warning: true,
    });
    if (!ok) return;
    setDischargeImmediateSaving(true);
    try {
      await api.dischargeForceComplete(admissionId);
      onChanged?.();
      onClose();
    } catch (e) {
      onToast?.(toastErr(e));
    } finally {
      setDischargeImmediateSaving(false);
    }
  }

  async function handleSave() {
    if (needsPayer && !payer) return;
    if (!showActionsRow && needsDestination && !destination) return;
    if (!showActionsRow && needsResNote && !resNote.trim()) return;
    if (needsIp && !ipValid) return;
    if (needsIp && !patientNameValid) return;
    if (needsIp && !admissionDateValid) return;
    if (needsIp && !admissionType) return;
    if (needsIp && !selectedDeptId) return;
    if (needsIp && !selectedDoctorId && !selectedGroupId) return;
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
    const consultantGroupIdArg = needsIp ? (selectedGroupId || null) : undefined;
    // Only sent on a fresh admission — a plain status change (e.g. Occupied →
    // Vacant, or a reservation toggle) must not touch the admission's patient
    // fields, and omitting them is how the API is told to leave them alone.
    const admissionArg = needsIp
      ? { patientName: patientName.trim(), admissionDate }
      : {};
    try {
      await onSave(bed.id, physical, reservation, payerArg, destinationArg, resNoteArg, ipArg, admissionTypeArg, consultantArg, departmentArg, doctorIdArg, departmentIdArg, consultantGroupIdArg, admissionArg);
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

      <div className="card dc-shell">
        <DischargeTab bed={bed} role={cfg.role} onChanged={onChanged} />
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
        {/* Discharge Lounge only — which real ward/bed the patient physically
              left before landing here. */}
        {bed.bed_type === "Lounge" && bed.physical_status === "OCCUPIED" && bed.origin_ward_name && (
          <div className="pdlg-row" style={{ padding: "10px 0" }}>
            <span className="k row" style={{ gap: 10 }}><Ic d={icons.grid} s={16} /> From Ward</span>
            <span className="v">{bed.origin_ward_name}</span>
          </div>
        )}
        {bed.bed_type === "Lounge" && bed.physical_status === "OCCUPIED" && bed.origin_bed_name && (
          <div className="pdlg-row" style={{ padding: "10px 0" }}>
            <span className="k row" style={{ gap: 10 }}><Ic d={icons.bed} s={16} /> From Bed</span>
            <span className="v">{bed.origin_bed_name}</span>
          </div>
        )}
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

            {/* Marked required only once there is something to protect: on an
                admission that predates these fields both start blank and may be
                saved that way, so an unrelated correction isn't blocked behind
                details the user may not have to hand. */}
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
              Patient Name {patientInfoSnapshotRef.current?.patientName && <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>}
            </div>
            <input className="field" value={patientName} maxLength={120}
              placeholder="Not recorded — add it here"
              style={{ marginBottom: nameError ? 4 : 14, borderColor: nameError ? "var(--red)" : undefined }}
              onChange={(e) => setPatientName(e.target.value)} />
            {/* Every state that disables Save has to say why here, or the button
                just looks broken. These conditions mirror the disabled prop. */}
            {nameError && (
              <div style={{ fontSize: 11, color: "var(--red)", marginBottom: 14 }}>{nameError}</div>
            )}

            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
              Date of Admission {patientInfoSnapshotRef.current?.admissionDate && <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>}
            </div>
            <input className="field" type="date" value={admissionDate} max={admissionDateMax}
              style={{ marginBottom: admissionDate || dateError ? 4 : 14, borderColor: dateError ? "var(--red)" : undefined }}
              onChange={(e) => setAdmissionDate(e.target.value)} />
            {/* Same DD/MM/YYYY echo as the admission form — see the note there. */}
            {admissionDate && admissionDateValid && (
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 14, fontWeight: 600 }}>
                {fmtDMY(admissionDate)} <span style={{ fontWeight: 500 }}>(DD/MM/YYYY)</span>
              </div>
            )}
            {dateError && (
              <div style={{ fontSize: 11, color: "var(--red)", marginBottom: 14 }}>{dateError}</div>
            )}

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
                disabled={savingPatientInfo || !/^\d{6}$/.test(ipLast6) || !admissionType || !selectedDeptId || (!selectedDoctorId && !selectedGroupId)
                  || Boolean(nameError) || Boolean(dateError)}
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
                <span className="k row" style={{ gap: 10 }}><Ic d={icons.user} s={16} /> IP/OPD</span>
                <span className="v">{bed.ip_last6 || "Not recorded"}</span>
              </div>
            )}
            {/* Always rendered for an occupied bed, blank or not — "Not recorded"
                tells staff the value is genuinely missing (an admission older than
                the field) rather than leaving them to wonder why the row vanished,
                and it's the same wording the IP row above already uses. */}
            {bed.physical_status === "OCCUPIED" && (
              <div className="pdlg-row" style={{ padding: "10px 0" }}>
                <span className="k row" style={{ gap: 10 }}><Ic d={icons.user} s={16} /> Patient Name</span>
                <span className="v">{bed.patient_name || "Not recorded"}</span>
              </div>
            )}
            {bed.physical_status === "OCCUPIED" && (
              <div className="pdlg-row" style={{ padding: "10px 0" }}>
                <span className="k row" style={{ gap: 10 }}><Ic d={icons.clock} s={16} /> Date of Admission</span>
                <span className="v">{fmtDMY(bed.admission_date) || "Not recorded"}</span>
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
                <span className="v">{bed.consultant_name}{bed.department_name ? `${bed.consultant_name ? " " : ""}[${bed.department_name}]` : ""}</span>
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
                return ` ${p.done}/${p.total} done`;
              })()}
            </span>
          </div>
        )}
        {bed.bed_type === "Lounge" && bed.physical_status === "OCCUPIED" && bed.origin_note && (
          <div className="pdlg-row" style={{ padding: "10px 0" }}>
            <span className="k row" style={{ gap: 10 }}><Ic d={icons.fileText} s={16} /> Transfer Note</span>
            <span className="v">{bed.origin_note}</span>
          </div>
        )}
        <div className="pdlg-row" style={{ padding: "10px 0" }}>
          <span className="k row" style={{ gap: 10 }}><Ic d={icons.clock} s={16} /> Last Updated</span>
          <span className="v dim" style={{ fontWeight: 600 }}><RelativeTime ts={bed.updated_at} /></span>
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

        {/* Physical Status — first: this decides what the rest of the form asks for.
              Hidden entirely for Consultants — they can't change bed physical
              status, and even the read-only Vacant/Occupied display isn't
              relevant to what they're here for (planning/viewing a discharge). */}
        {cfg.role !== "CONSULTANT" && (
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
                const vacantDisabled = (val === "VACANT" && bed.physical_status === "OCCUPIED") || (val === "OCCUPIED" && !!bed.housekeeping_status);
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
        )}

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
              Patient Name <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>
            </div>
            <input className="field" value={patientName} maxLength={120}
              placeholder="Full name as per records"
              onChange={(e) => setPatientName(e.target.value)}
              style={{ borderColor: !patientNameValid ? "var(--red)" : undefined }} />
            {!patientNameValid && (
              <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Enter the patient's name.</div>
            )}

            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 16, marginBottom: 10 }}>
              Date of Admission <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>
            </div>
            {/* type="date" gives both entry modes at once: typing, with the browser
                enforcing the format, and the native calendar picker. Its value is
                always YYYY-MM-DD, which is exactly what the API stores. */}
            <input className="field" type="date" value={admissionDate} max={admissionDateMax}
              onChange={(e) => setAdmissionDate(e.target.value)}
              style={{ borderColor: !admissionDateValid ? "var(--red)" : undefined }} />
            {/* A native date input renders in the browser/OS locale, which we can't
                set from HTML — so on a US-locale machine the box itself reads
                mm/dd/yyyy. Echoing the chosen date back as DD/MM/YYYY means the
                user always sees which day they actually picked, whatever the box
                shows. 05/08 vs 08/05 is not a mistake worth risking on a ward. */}
            {admissionDateValid && (
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 5, fontWeight: 600 }}>
                {fmtDMY(admissionDate)} <span style={{ fontWeight: 500 }}>(DD/MM/YYYY)</span>
              </div>
            )}
            {!admissionDateValid && (
              <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>
                {admissionDate && admissionDateMax && admissionDate > admissionDateMax
                  ? "Date of admission cannot be in the future."
                  : "Select the date of admission."}
              </div>
            )}

            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 16, marginBottom: 10 }}>
              Department &amp; Consultant <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>
            </div>
            {renderDeptDoctorPicker()}
            {!selectedDeptId && (
              <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Select a department.</div>
            )}
            {selectedDeptId && !selectedDoctorId && !selectedGroupId && (
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
              {cfg.role === "CONSULTANT" ? "Action" : "Status"}
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
              {(cfg.role === "PRE" || cfg.role === "NURSE" || cfg.role === "FC") && bed.bed_type !== "Lounge" && (
                <button onClick={() => setTransferOpen(true)} style={{
                  display: "flex", alignItems: "center", gap: 8, flex: "1 1 140px",
                  background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 12,
                  padding: "12px 14px", fontSize: 13, fontWeight: 600, color: "var(--ink)", cursor: "pointer",
                }}>
                  <Ic d={icons.exchange} s={15} style={{ color: "var(--primary)" }} />
                  Bed Transfer
                </button>
              )}
              {(cfg.role === "PRE" || cfg.role === "NURSE" || cfg.role === "FC") && bed.bed_type === "Lounge" && (
                <button onClick={() => setReadmitOpen(true)} style={{
                  display: "flex", alignItems: "center", gap: 8, flex: "1 1 140px",
                  background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 12,
                  padding: "12px 14px", fontSize: 13, fontWeight: 600, color: "var(--ink)", cursor: "pointer",
                }}>
                  <Ic d={icons.exchange} s={15} style={{ color: "var(--primary)" }} />
                  Readmit
                </button>
              )}
              {cfg.role === "PRE" && bed.bed_type === "Lounge" && (
                <button onClick={handleDischargeImmediate} disabled={dischargeImmediateSaving} style={{
                  display: "flex", alignItems: "center", gap: 8, flex: "1 1 140px",
                  background: "var(--red-bg, #FEE2E2)", border: "1px solid var(--red, #ef4444)", borderRadius: 12,
                  padding: "12px 14px", fontSize: 13, fontWeight: 600, color: "var(--red, #ef4444)", cursor: "pointer",
                }}>
                  <Ic d={icons.alert} s={15} style={{ color: "var(--red, #ef4444)" }} />
                  {dischargeImmediateSaving ? "Working…" : "Discharge Immediate"}
                </button>
              )}
              {(() => {
                // No plan yet and this role is allowed to make one — ask Initiate
                // Now vs Schedule first, instead of dropping into an empty form.
                // Otherwise (already planned/running, or a role that can't plan
                // e.g. Nurse) go straight to the full Discharge Details page.
                const canPlanRole = cfg.role === "PRE" || cfg.role === "DOCTOR" || cfg.role === "CONSULTANT";
                const notStarted = !bed.discharge_tracking;
                const label = notStarted ? (canPlanRole ? "Plan Discharge" : "Discharge") : "View Discharge";
                return (
                  <button onClick={() => {
                    // dischargePlanOpen is a popup (useModal handles its own scroll
                    // lock) — only the full-page dischargeOpen needs the explicit save.
                    if (notStarted && canPlanRole) setDischargePlanOpen(true);
                    else { saveDischargeScroll(); setDischargeOpen(true); }
                  }} style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: "none", cursor: "pointer",
                    flex: "1 1 100%", borderRadius: 999, padding: "12px 14px", fontSize: 13, fontWeight: 800, letterSpacing: 0.3,
                    background: "var(--blue-bg)", color: "var(--blue)",
                  }}>
                    <Ic d={icons.fileText} s={14} /> {label}
                  </button>
                );
              })()}
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
        <TransferPopup bed={bed} onClose={() => setTransferOpen(false)}
          onSaved={(r) => {
            setTransferOpen(false);
            // Pass the current bed's already-loaded patient data (payer, department,
            // doctor, discharge tracking, etc.) along with the transfer result — a
            // transfer carries all of that over unchanged, so onTransferred can jump
            // straight to the destination bed fully populated, with no refetch (and
            // no intermediate ward-list page) needed first.
            if (onTransferred) onTransferred(r, bed);
            else { onChanged?.(); onClose(); }
          }}
          onConflict={(msg) => {
            // Someone else already changed this patient's bed/discharge state
            // (raced onto the same admission, took the destination bed, etc.) —
            // don't leave the stale form open waiting for a manual refresh:
            // close it, tell the user what happened, and pull the real state.
            setTransferOpen(false);
            onToast?.(msg);
            onChanged?.();
          }} />,
        document.body
      )}
      {dischargePlanOpen && createPortal(
        <DischargePlanPopup bed={bed} canInitiate={cfg.role === "PRE" || cfg.role === "DOCTOR" || cfg.role === "CONSULTANT"} onClose={() => setDischargePlanOpen(false)}
          onDone={() => { setDischargePlanOpen(false); onChanged?.(); saveDischargeScroll(); setDischargeOpen(true); }}
          onConflict={(msg) => {
            setDischargePlanOpen(false);
            onToast?.(msg);
            onChanged?.();
          }} />,
        document.body
      )}
      {readmitOpen && createPortal(
        <ReadmitPopup bed={bed} onClose={() => setReadmitOpen(false)}
          onSaved={(r) => {
            setReadmitOpen(false);
            if (onTransferred) onTransferred(r, bed);
            else { onChanged?.(); onClose(); }
          }}
          onConflict={(msg) => {
            setReadmitOpen(false);
            onToast?.(msg);
            onChanged?.();
          }} />,
        document.body
      )}
      {confirmDialog}

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
              disabled={saving || noChanges || (needsPayer && !payer) || (!showActionsRow && needsDestination && !destination) || (!showActionsRow && needsResNote && !resNote.trim()) || (needsIp && !ipValid) || (needsIp && !admissionType)
                // Kept in step with handleSave's own guards — without these the
                // button would look live, do nothing on click, and give no reason.
                || (needsIp && !patientNameValid) || (needsIp && !admissionDateValid)}
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
export function WardPage({ ward, initialTab, onBack, cfg = PRE_CFG, focusBedId, initialSearch, onBedSaved }) {
  const [tab, setTab] = useState(initialTab || "manage");
  const [beds, setBeds] = useState([]);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState(initialSearch || "");
  const [editingBed, setEditingBed] = useState(null);  // bed object | null
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  // Opening a bed replaces this whole grid with BedDetailSheet — without this,
  // the editor always starts scrolled wherever the grid happened to be, and
  // "Back to beds" drops you at the top of the grid instead of back where you were.
  // saveBedScroll() must be called at each place that OPENS a bed, before
  // setEditingBed — see useScrollRestore's doc comment for why.
  const saveBedScroll = useScrollRestore(!!editingBed);
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

  // Guards against two hazards if WardPage is ever reused across a direct
  // ward-to-ward switch without unmounting (today every switch goes through
  // onBack/null first, so this doesn't fire in practice, but nothing else was
  // stopping it): a stale load for the PREVIOUS ward resolving late and
  // clobbering the new ward's already-loaded beds, and the spinner being
  // wrongly suppressed because loadedAt still held the old ward's timestamp.
  const loadTokenRef = useRef(0);
  useEffect(() => { setBeds([]); setLoadedAt(null); }, [ward.id]);

  const load = useCallback(async () => {
    const myToken = ++loadTokenRef.current;
    setLoading(true);
    try {
      const result = await cfg.listBeds(ward.id);
      if (loadTokenRef.current !== myToken) return; // a newer ward's load has since started
      // Annotate beds with ward-level unit_type so filter + badges work uniformly
      const unitType = ward.unit_type || null;
      const annotated = (result.beds || []).map(b => ({ ...b, unit_type: unitType }));
      setBeds(annotated);
      setLoadedAt(new Date());
      // Share it across mounts so re-entering this ward costs nothing while it
      // stays provably current — lib.js drops it the moment anything could have
      // changed it.
      setWardBeds(ward.id, annotated);
    }
    catch (e) { if (loadTokenRef.current === myToken) showToast(toastErr(e)); }
    finally { if (loadTokenRef.current === myToken) setLoading(false); }
  }, [ward.id, ward.unit_type, showToast]);

  // Re-entering a ward that nothing has happened to since the last visit costs
  // NO request: the cached array is only kept while lib.js can prove it is
  // current (see getWardBeds). Anything else falls through to a normal load.
  useEffect(() => {
    const cached = getWardBeds(ward.id);
    if (cached) { setBeds(cached); setLoadedAt(new Date()); return; }
    load();
  }, [load, ward.id]);

  // Only the very FIRST load has nothing to show yet — every load after that is
  // a background refresh of a grid that's already on screen. Gating the
  // spinner on this (instead of raw `loading`, which also flips true on every
  // background refresh) is what stops those refreshes from tearing the grid
  // down to a spinner and collapsing the page's scroll height each time.
  const firstLoadPending = loading && loadedAt === null;

  // Patches a single bed into the already-loaded array in place — used when a
  // live event already carries that bed's full current row, so one bed
  // changing doesn't require refetching (or blanking) every other bed in the
  // ward. unit_type is a client-only annotation (see load() above), not part
  // of the server row, so it's carried over from the existing entry rather
  // than lost. No-ops if the bed isn't in this ward's array yet (e.g. the
  // initial load hasn't landed); that load will bring it in a moment later.
  const patchBed = useCallback((incoming) => {
    setBeds(prev => {
      const idx = prev.findIndex(b => b.id === incoming.id);
      if (idx === -1) return prev;
      const next = prev.slice();
      next[idx] = { ...incoming, unit_type: prev[idx].unit_type };
      return next;
    });
  }, []);

  const focusedRef = useRef(false);
  useEffect(() => {
    if (focusBedId && beds.length > 0 && !focusedRef.current) {
      const match = beds.find(b => b.id === focusBedId);
      if (match) { setEditingBed(match); focusedRef.current = true; }
    }
  }, [focusBedId, beds]);

  // Live refresh — every bed/discharge change lands here instantly via websocket.
  // Payloads carrying a wardId are filtered to this ward. A bed:update that also
  // carries the bed's full row (every role's status-update route sends one) is
  // applied directly via patchBed — no refetch needed for a change to one bed.
  // Anything else (discharge/operational events, or a payload without a full
  // row) falls back to a full reload, which — thanks to firstLoadPending above —
  // no longer blanks the grid while it runs. The ref keeps the handler on the
  // latest load closure without reconnecting the socket on every render.
  const liveLoadRef = useRef(load);
  liveLoadRef.current = load;
  useEffect(() => {
    const socket = getSocket();
    // Only the RELOAD fallback is coalesced — a payload carrying the full bed
    // row still patches instantly, since that costs no request.
    const reload = coalesce(() => liveLoadRef.current());
    const onData = (p) => {
      if (p && p.wardId != null && Number(p.wardId) !== Number(ward.id)) return;
      if (p?.bed && p.bed.id != null) { patchBed(p.bed); return; }
      reload();
    };
    socket.on("bed:update", onData);
    socket.on("discharge:update", onData);
    socket.on("ward:operational", onData);
    // Reconnect (not first connect) → catch updates missed while disconnected.
    const offReconnect = onReconnect(socket, () => liveLoadRef.current());
    return () => {
      socket.off("bed:update", onData);
      socket.off("discharge:update", onData);
      socket.off("ward:operational", onData);
      offReconnect(); reload.cancel();
    };
  }, [ward.id, patchBed]);

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
  // Separate normalization for the name match: `q` keeps the raw spacing that
  // bed names and IP digits are matched on, while patient names are compared
  // with runs of whitespace collapsed, the same way they're stored.
  const qName = normalizeQuery(search);
  const displayed = sortedBeds.filter(b => {
    if (q && !b.bed_name.toLowerCase().includes(q) && !(b.ip_last6 && b.ip_last6.includes(q)) && !bedMatchesPatientName(b, qName)) return false;
    if (filter === "KIMS") return b.unit_type === "KIMS";
    if (filter === "Renova") return b.unit_type?.includes("Renova");
    if (filter === "Op") return !!b.operational_status;
    if (filter === "Non-Op") return !b.operational_status;
    if (filter === "Vacant") return b.physical_status === "VACANT";
    if (filter === "Occupied") return b.physical_status === "OCCUPIED";
    if (filter === "Reserved") return b.reservation_status === "RESERVED";
    if (filter === "Overstay") return isOverstay(b);
    return true;
  });

  // Optimistic update — snapshot restored on failure; unit_type preserved via spread
  const changeStatus = useCallback(async (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId, consultantGroupId, admission = {}) => {
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
          ...(physicalStatus === "VACANT" ? { ip_last6: null, patient_name: null, admission_date: null, admission_type: null, consultant_name: null, department_name: null, doctor_id: null, department_id: null, discharge_tracking: null } : {}),
          ...(ipLast6 ? { ip_last6: ipLast6 } : {}),
          ...(admission.patientName ? { patient_name: admission.patientName } : {}),
          ...(admission.admissionDate ? { admission_date: admission.admissionDate } : {}),
          ...(admissionType ? { admission_type: admissionType } : {}),
          ...(consultantName !== undefined ? { consultant_name: consultantName } : {}),
          ...(departmentName !== undefined ? { department_name: departmentName } : {}),
          ...(doctorId ? { doctor_id: doctorId } : {}),
          ...(departmentId ? { department_id: departmentId } : {}),
          ...(consultantGroupId ? { consultant_group_id: consultantGroupId, owner_type: "GROUP" } : {}),
          ...(doctorId ? { owner_type: "DOCTOR" } : {}),
        }
        : b);
    });
    try {
      await cfg.updateBedStatus(bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId, consultantGroupId, admission);
      // Only on confirmed success — a failed save (caught below) isn't a sign of
      // real progress, so it shouldn't reset the alarm's idle timer. `onBedSaved`
      // is undefined for every role besides PRE (Doctor/Nurse/FC don't pass it),
      // so this is a no-op everywhere else.
      onBedSaved?.();
    } catch (e) {
      setBeds(snapshot);
      showToast(toastErr(e));
      throw e;  // re-throw so handleSave knows the save failed and skips the success toast
    }
  }, [showToast, onBedSaved]);

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
  const fc = { ALL: sortedBeds.length, KIMS: 0, Renova: 0, "Non-Op": 0, Vacant: 0, Occupied: 0, Reserved: 0, Overstay: 0 };
  for (const b of sortedBeds) {
    if (b.unit_type?.includes("Renova")) fc["Renova"]++;
    else if (b.unit_type === "KIMS") fc["KIMS"]++;
    if (b.operational_status === false) fc["Non-Op"]++;
    if (b.physical_status === "VACANT") fc["Vacant"]++; else fc["Occupied"]++;
    if (b.reservation_status === "RESERVED") fc["Reserved"]++;
    if (isOverstay(b)) fc["Overstay"]++;
  }
  const FILTER_OPTIONS = [
    { key: "ALL", label: "All beds" },
    // Same red flag the bed cards already carry, promoted to a filter — it is
    // the one state in a ward that someone has to go and deal with.
    { key: "Overstay", label: "Overstay", warn: true },
    { key: "Occupied", label: "Occupied" },
    { key: "Vacant", label: "Vacant" },
    { key: "Reserved", label: "Reserved" },
    { key: "Non-Op", label: "Non-operational" },
    { key: "KIMS", label: "KIMS" },
    { key: "Renova", label: "Renova" },
  ].filter(o => o.key === "ALL" || fc[o.key] > 0);

  // Rendered inline in WardPage (NOT as a nested component) so the input keeps
  // focus across keystrokes — a component defined inside render remounts every time.
  const searchBar = (
    <>
      <div className="ward-search-row pill-search" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div className="field-search" style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex" }}>
            <Ic d={icons.search} s={15} />
          </span>
          <input
            className="field"
            value={search}
            placeholder="Search bed, patient, or IP…"
            style={{ paddingLeft: 38, paddingRight: search ? 36 : 15 }}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex", padding: 4 }}
            >
              <Ic d={icons.x} s={14} />
            </button>
          )}
        </div>
      </div>

      {/* Every facet and its count on one scrollable line — what is in this ward
          is readable without opening anything. */}
      <div className="chip-row" role="group" aria-label="Filter beds">
        {FILTER_OPTIONS.map((o) => (
          <button key={o.key}
            className={"fchip" + (o.warn ? " warn" : "") + (filter === o.key ? " on" : "")}
            aria-pressed={filter === o.key}
            onClick={() => setFilter(o.key)}>
            {o.warn && <Ic d={icons.alert} s={13} />}
            {o.label} <span className="n">({fc[o.key] ?? fc.ALL})</span>
          </button>
        ))}
      </div>
    </>
  );

  // ── Shared grid renderer — grid + empty state only ─────────────────────────
  function BedGrid({ clickable }) {
    return displayed.length === 0 ? (
      <div className="card empty" style={{ padding: 24 }}>
        <Ic d={icons.search} s={24} />
        <div style={{ marginTop: 8, fontWeight: 600, fontSize: 13 }}>No beds match</div>
        <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>
          {q ? `No bed, IP or patient matching "${search.trim()}" in this filter.` : "No beds in this filter."}
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
            onClick={clickable && bed.operational_status !== false ? () => { saveBedScroll(); setEditingBed(bed); } : undefined}
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
  // True while DischargesPage has a phase detail open. WardPage then hides its
  // own header and tab bar so the detail is the whole page, rather than a third
  // level stacked under two others with two back controls on screen at once.
  const [dischargeDetail, setDischargeDetail] = useState(false);

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
          onSave={async (bedId, physical, reservation, payer, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId, consultantGroupId, admission = {}) => {
            const stillOccRes = physical === "OCCUPIED" && reservation === "RESERVED";
            const stillVacRes = physical === "VACANT" && reservation === "RESERVED";
            setEditingBed(prev => ({
              ...prev, physical_status: physical, reservation_status: reservation,
              payer_type: physical === "VACANT" ? null : (payer ?? prev.payer_type),
              destination: stillOccRes ? (destination ?? prev.destination) : null,
              reservation_note: stillVacRes ? (reservationNote ?? prev.reservation_note) : null,
              ...(ipLast6 ? { ip_last6: ipLast6 } : {}),
              ...(admission.patientName ? { patient_name: admission.patientName } : {}),
              ...(admission.admissionDate ? { admission_date: admission.admissionDate } : {}),
              ...(admissionType ? { admission_type: admissionType } : {}),
              ...(consultantName !== undefined ? { consultant_name: consultantName } : {}),
              ...(departmentName !== undefined ? { department_name: departmentName } : {}),
              ...(doctorId ? { doctor_id: doctorId } : {}),
              ...(departmentId ? { department_id: departmentId } : {}),
              ...(consultantGroupId ? { consultant_group_id: consultantGroupId, owner_type: "GROUP" } : {}),
              ...(doctorId ? { owner_type: "DOCTOR" } : {}),
            }));
            await changeStatus(bedId, physical, reservation, payer, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId, consultantGroupId, admission);
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
            showToast(`Transferred to ${r.toBedName}${r.toWardName ? ", " + r.toWardName : ""} ✓`);
          }}
        />
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="slide-up">
      {/* Hidden while a discharge detail is open, so that view is the whole
          page rather than a third level under a ward header and a tab bar,
          with two different back controls on screen at once. */}
      {!dischargeDetail && (
      <div className="ward-page-hdr">
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <BackBtn onClick={onBack} />
          <div style={{ minWidth: 0 }}>
            <div className="h1" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ward.ward}</div>
            <div className="ward-sub">
              {beds.length} bed{beds.length !== 1 ? "s" : ""}
              {tab === "manage" && reviewedAt
                ? <>, <span className="ward-reviewed">reviewed <RelativeTime ts={reviewedAt} /></span></>
                : tab === "manage" && cfg.reviewWard ? ", not reviewed yet" : ""}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexShrink: 0 }}>
          {tab === "manage" && cfg.reviewWard && (
            <button className="btn-fly ward-review-btn"
              disabled={reviewing || inCooldown} onClick={reviewWard}
              title={inCooldown ? `Available again in ${Math.ceil(cooldownMsLeft / 60000)}m` : "No changes needed — mark this ward reviewed"}>
              <div className="svg-wrapper"><Ic d={icons.send} s={17} /></div>
              {/* "Wait 3m", not a bare "3m": alone the number read as an unlabelled
                  chip beside the ward name, and it repeated the "Reviewed 3m ago"
                  line directly beneath it. */}
              <span>{reviewing ? "…" : inCooldown ? `Wait ${Math.ceil(cooldownMsLeft / 60000)}m` : "Review"}</span>
            </button>
          )}
        </div>
      </div>
      )}

      {/* Tab bar — Discharges is a first-class tab, not a popup */}
      {!dischargeDetail && (
      <div className="seg-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "manage"} className={tab === "manage" ? "on" : ""} onClick={() => setTab("manage")}>
          <Ic d={icons.bed} s={15} /> Manage beds
        </button>
        <button role="tab" aria-selected={tab === "discharge"} className={tab === "discharge" ? "on" : ""} onClick={() => setTab("discharge")}>
          <Ic d={icons.clipboard} s={15} /> Discharges
        </button>
      </div>
      )}

      {/* Tab content — Discharges reuses the same full page as the left-nav "Discharges"
          tab, just scoped to this ward, so both places show identical planned/in-progress data. */}
      {tab === "discharge" ? (
        <DischargesPage role={cfg.role} wardId={ward.id} onDetailOpen={setDischargeDetail} />
      ) : (
        <>
          {!firstLoadPending && beds.length > 0 && searchBar}
          {firstLoadPending ? spinner : beds.length === 0 ? emptyState : <BedGrid clickable />}
            {/* Summary at the BOTTOM, matching the Discharges tab — the counters
                summarise the grid above them, so they read as its footer. */}
          {!firstLoadPending && beds.length > 0 && summaryStrip}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
