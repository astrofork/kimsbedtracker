import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { api, toastErr, getSocket, onReconnect, coalesce, fmtDateTime, getDoctorBlock, setDoctorBlock } from "./lib.js";
import { RelativeTime } from "./relativeClock.jsx";
import { Ic, icons, useScrollRestore } from "./ui.jsx";
import { AppShell } from "./shell.jsx";
import { bedStateColor, normalizeQuery, wardIdsMatchingPatientName } from "./bedUtils.js";
import { WardPage, ProfileThemeRow, BackBtn } from "./PREApp.jsx";
import DischargesPage from "./DischargesPage.jsx";
import { LiveBedDashboard, useLiveBedDashboardData } from "./COOApp.jsx";

// Doctor endpoints for the shared ward/bed pages (same UI as PRE, doctor APIs + role).
const DOCTOR_CFG = {
  role: "DOCTOR",
  listBeds: (wardId) => api.doctorBeds(wardId),
  updateBedStatus: (...a) => api.doctorUpdateBedStatus(...a),
  payerTypes: () => api.doctorPayerTypes(),
  destinations: () => api.doctorDestinations(),
  reviewWard: (wardId) => api.doctorReviewWard(wardId),
  // Scoped to this doctor's blocks on purpose — an IP search must never resolve
  // to a ward that /doctor/wards/:id/beds will reject with a 403.
  bedDetails: () => api.doctorMyBedDetails(),
};
import DischargeMiniWidget from "./DischargeMiniWidget.jsx";

// ── Small helpers ───────────────────────────────────────────────────────────────
const initialsOf = (s) => (s || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const occOf = (w) => {
  const total = w.total_beds ?? w.total ?? 0;
  const on = w.occupied ?? 0, or = w.occupied_reserved ?? 0, vr = w.reserved ?? 0, vn = w.vacant ?? 0;
  const occ = on + or;
  return { total, on, or, vr, vn, occ, pct: total > 0 ? Math.round((occ / total) * 100) : 0 };
};

// Segmented occupancy bar: occupied · occ+res · vac+res (rest = vacant track)
function OccBar({ w }) {
  const { total, on, or, vr } = occOf(w);
  const p = (n) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="doc-bar" title={`${on} occupied · ${or} occ+res · ${vr} vac+res of ${total}`}>
      <i className="seg-o"  style={{ width: `${p(on)}%` }} />
      <i className="seg-or" style={{ width: `${p(or)}%` }} />
      <i className="seg-vr" style={{ width: `${p(vr)}%` }} />
    </div>
  );
}

// Shared search row — one input + one select, identical markup to the PRE Entry
// page. Rendered inline by its callers (never as a nested component) so the
// input keeps focus across keystrokes.
function searchRow({ value, onChange, placeholder, select }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
      <div style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex" }}>
          <Ic d={icons.search} s={15} />
        </span>
        <input
          className="field"
          value={value}
          placeholder={placeholder}
          style={{ paddingLeft: 36, paddingRight: value ? 36 : 13 }}
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <button
            onClick={() => onChange("")}
            aria-label="Clear search"
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex", padding: 4, background: "none", border: "none", cursor: "pointer" }}
          >
            <Ic d={icons.x} s={14} />
          </button>
        )}
      </div>
      {select}
    </div>
  );
}

// Ward card — shared by BlockDetail's ward grid and the Entry tab's search
// results, so both surfaces look and behave identically. `note` replaces the
// review line for results, which come from /doctor/me and carry no review data.
function WardCard({ w, i = 0, onOpen, note }) {
  const o = occOf(w);
  return (
    // Renders instantly, like BedGridCard — see the note in PREApp's ward grid.
    <div className="doc-ward tap"
      role="button" tabIndex={0}
      onClick={() => w.operational !== false && onOpen()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && w.operational !== false && onOpen()}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          {(w.block_name || w.floor_name) && <div className="doc-ward-loc">{[w.block_name, w.floor_name].filter(Boolean).join(" · ")}</div>}
          <div className="doc-ward-name">{w.name}</div>
          <div className="doc-ward-rev">
            {note !== undefined
              ? note
              : w.reviewedAt
                ? <><Ic d={icons.check} s={11} /> Reviewed <RelativeTime ts={w.reviewedAt} /></>
                : <span style={{ color: "var(--ink-3)" }}>Not reviewed yet</span>}
          </div>
        </div>
        <span className="tag" style={{ background: o.pct >= 90 ? "var(--st-or-bg)" : o.pct >= 60 ? "var(--st-o-bg)" : "var(--st-v-bg)", color: o.pct >= 90 ? "var(--st-or)" : o.pct >= 60 ? "var(--st-o)" : "var(--st-v)" }}>{o.pct}%</span>
      </div>

      <div className="doc-minis">
        {[["Vacant", o.vn, "var(--st-v)"], ["Vac+Res", o.vr, "var(--st-vr)"], ["Occupied", o.on, "var(--st-o)"], ["Occ+Res", o.or, "var(--st-or)"]].map(([l, v, c]) => (
          <div key={l} className="doc-mini">
            <div className="doc-mini-v" style={{ color: c }}>{v}</div>
            <div className="doc-mini-l">{l}</div>
          </div>
        ))}
      </div>
      <OccBar w={w} />

      <div className="row" style={{ gap: 8, marginTop: 14 }}>
        <button className="btn btn-primary" style={{ flex: 1, padding: "10px 0", fontSize: 13 }} disabled={w.operational === false}
          onClick={(e) => { e.stopPropagation(); onOpen(); }}>
          <Ic d={icons.bed} s={14} /> {w.operational === false ? "Non-operational" : "View / Update Beds"}
        </button>
      </div>
    </div>
  );
}

// ── Block detail ─────────────────────────────────────────────────────────────────
function BlockDetail({ blockId, onBack, onOpenWard, showToast, reloadKey, ipIndex, bedRows }) {
  // Seeded from the cache so re-entering a block the doctor just left renders
  // its ward cards immediately instead of a spinner. `load` still runs below on
  // every mount, so what is shown is only ever one request behind.
  const [data,      setData]      = useState(() => getDoctorBlock(blockId));
  const [error,     setError]     = useState(null);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.doctorBlock(blockId)
      .then((d) => { setData(d); setDoctorBlock(blockId, d); })
      .catch((e) => setError(toastErr(e)));
  }, [blockId]);
  // A cached block is only kept while lib.js can still vouch for it: ward:counts
  // patches it with the server's recomputed totals, and anything that cannot be
  // patched drops it. So a surviving entry is current, and re-entering a block
  // costs NO request — the same reasoning WardPage already uses for beds.
  //
  // `reloadKey` still forces a real load, because that is the socket-driven
  // refresh path and it must never be short-circuited.
  const lastReload = useRef(reloadKey);
  useEffect(() => {
    if (reloadKey !== lastReload.current) { lastReload.current = reloadKey; load(); return; }
    if (getDoctorBlock(blockId)) return;   // cached and provably current
    load();
  }, [load, blockId, reloadKey]);

  // While this screen is open, apply the same delta the cache gets, so the cards
  // update live without a request. Guarded on the ward actually being in THIS
  // block — a doctor's other blocks are patched in the cache by lib.js, and
  // touching state for a ward we do not show would re-render for nothing.
  useEffect(() => {
    const socket = getSocket();
    const onCounts = (c) => {
      if (!c || c.wardId == null) return;
      setData((d) => {
        if (!d || !Array.isArray(d.wards)) return d;
        const idx = d.wards.findIndex((w) => Number(w.id) === Number(c.wardId));
        if (idx === -1) return d;
        const wards = d.wards.slice();
        wards[idx] = {
          ...wards[idx],
          total_beds: c.total, vacant: c.vacant, reserved: c.reserved,
          occupied: c.occupied, occupied_reserved: c.occupied_reserved,
        };
        return { ...d, wards };
      });
    };
    socket.on("ward:counts", onCounts);
    return () => socket.off("ward:counts", onCounts);
  }, []);

  // Switching blocks without unmounting would otherwise leave the PREVIOUS
  // block's wards on screen, under the new block's name, until its fetch landed.
  // Swapping to the new block's cached payload (or to nothing) keeps the header
  // and the grid describing the same block at all times.
  useEffect(() => { setData(getDoctorBlock(blockId)); }, [blockId]);

  const [docsOpen, setDocsOpen] = useState(false); // doctors-list dropdown
  const [wardFilter, setWardFilter] = useState("all"); // "all" | ward id
  const [wardSearch, setWardSearch] = useState("");
  const [ipMatch, setIpMatch] = useState(null); // { wardId } | null — resolved IP lookup
  const [ipNotFound, setIpNotFound] = useState(false);

  // A 6-digit search value is treated as an IP lookup instead of a ward-name
  // filter — across every block this doctor can access, not just the currently
  // open one. If the match is a ward inside THIS block, narrow the grid to that
  // one card (user still clicks it, same as any other ward). If the match is in
  // a different block (no card to click here), jump straight there.
  //
  // ipIndex is prefetched and owned by DoctorApp, so this is a synchronous Map
  // hit on every keystroke — no fetch, no wait, and it survives navigating
  // between blocks. `null` means the prefetch is still in flight.
  useEffect(() => {
    const ip = wardSearch.trim();
    setIpNotFound(false);
    if (!/^\d{6}$/.test(ip)) { setIpMatch(null); return; }
    if (ipIndex === null) return; // still loading — effect re-runs when it lands
    const bed = ipIndex.get(ip);
    if (!bed) { setIpMatch(null); setIpNotFound(true); return; }
    if (data?.wards?.some((w) => w.id === bed.ward_id)) setIpMatch({ wardId: bed.ward_id });
    else onOpenWard({ id: bed.ward_id, name: bed.ward, unit_type: bed.unit_type, _search: ip });
  }, [wardSearch, onOpenWard, data, ipIndex]);

  // A 2+ character non-IP query is also matched against patient names, on top of
  // the ward-name match. Unlike the IP path this never auto-navigates: a name can
  // legitimately match several patients across several wards, so the user picks.
  const nameQuery = /^\d{6}$/.test(wardSearch.trim()) ? "" : normalizeQuery(wardSearch);
  const nameWardIds = useMemo(
    () => wardIdsMatchingPatientName(bedRows, nameQuery),
    [bedRows, nameQuery],
  );

  // On phones, hide the app top bar while inside a block — the back button is the
  // way out, and the reclaimed space goes to the ward cards. (CSS: body.ward-focus)
  useEffect(() => {
    document.body.classList.add("ward-focus");
    return () => document.body.classList.remove("ward-focus");
  }, []);

  const review = async () => {
    setReviewing(true);
    try {
      const r = await api.doctorReview(blockId);
      // Block-wide review marks every ward reviewed.
      setData((d) => d ? { ...d, reviewedAt: r.reviewedAt, wards: d.wards.map((w) => ({ ...w, reviewedAt: r.reviewedAt })) } : d);
      showToast("All wards marked reviewed ✓");
    } catch (e) { showToast(toastErr(e)); }
    finally { setReviewing(false); }
  };

  if (error) return (
    <div className="card empty" style={{ marginTop: 20 }}>
      <Ic d={icons.alert} s={28} /><div style={{ marginTop: 10, fontWeight: 600 }}>{error}</div>
      <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={onBack}>Back</button>
    </div>
  );
  if (!data) return <div className="empty" style={{ paddingTop: 60 }}><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={24} /></span></div>;

  const totals = data.wards.reduce((a, w) => {
    const o = occOf(w); a.total += o.total; a.occ += o.occ; return a;
  }, { total: 0, occ: 0 });
  const blockPct = totals.total > 0 ? Math.round((totals.occ / totals.total) * 100) : 0;

  return (
    <div className="slide-up">
      {/* Header — back · block name + meta · doctors dropdown + Mark Reviewed */}
      <div className="row between" style={{ marginBottom: 16, gap: 10, flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 12, minWidth: 0, flex: "1 1 240px" }}>
          <BackBtn onClick={onBack} />
          <div style={{ minWidth: 0 }}>
            <div className="h1" style={{ fontSize: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.name}</div>
            <div className="dim" style={{ fontSize: 11.5 }}>
              {data.wards.length} wards · {totals.total} beds · {blockPct}% occupied
              {data.reviewedAt ? <> · reviewed <RelativeTime ts={data.reviewedAt} /></> : ""}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          {data.doctors.length > 0 && (
            <div style={{ position: "relative" }}>
              <button className="chip" onClick={() => setDocsOpen(o => !o)} aria-expanded={docsOpen}>
                <Ic d={icons.users} s={13} /> {data.doctors.length} doctor{data.doctors.length !== 1 ? "s" : ""}
                <Ic d={icons.chevron} s={12} style={{ transform: docsOpen ? "rotate(-90deg)" : "rotate(90deg)", transition: "transform .15s" }} />
              </button>
              {docsOpen && (
                <div style={{
                  position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 60,
                  minWidth: 200, maxWidth: "calc(100vw - 32px)",
                  background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12,
                  boxShadow: "var(--shadow-md)", padding: 6,
                }}>
                  {data.doctors.map((d) => (
                    <div key={d.id} className="row" style={{ gap: 10, padding: "8px 10px", borderRadius: 8 }}>
                      <span className="doc-chip-av">{initialsOf(d.name)}</span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <button className="btn btn-primary" style={{ padding: "10px 16px", fontSize: 13, whiteSpace: "nowrap" }} disabled={reviewing || data.wards.length === 0} onClick={review}>
            <Ic d={icons.check} s={15} /> {reviewing ? "Saving…" : "Mark Reviewed"}
          </button>
        </div>
      </div>

      {data.description && <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>{data.description}</div>}

      {data.wards.length === 0 ? (
        <div className="card empty"><Ic d={icons.grid} s={28} /><div style={{ marginTop: 8, fontWeight: 600 }}>No wards assigned</div></div>
      ) : (
        <>
          <div className="floor-head">Wards</div>
          {ipNotFound && (
            <div className="dim" style={{ fontSize: 13, padding: "10px 2px", marginBottom: 8 }}>
              No patient found with that IP in your wards.
            </div>
          )}
          {/* Search + ward picker */}
          {searchRow({
            value: wardSearch,
            onChange: setWardSearch,
            placeholder: "Search ward / patient / IP…",
            select: data.wards.length > 1 && (
              <select className="field" aria-label="Filter by ward" value={wardFilter}
                onChange={(e) => setWardFilter(e.target.value)}
                style={{ width: "auto", flex: "0 1 auto", maxWidth: 200, fontWeight: 600 }}>
                <option value="all">All wards ({data.wards.length})</option>
                {data.wards.map((w) => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
              </select>
            ),
          })}
          <div className="card-grid">
            {data.wards.filter((w) => {
              const dq = wardSearch.trim().toLowerCase();
              const isIpSearch = /^\d{6}$/.test(dq);
              // Ward-name and patient-name matches are additive — patient search
              // widens the result, it never hides a ward the old search showed.
              return (wardFilter === "all" || String(w.id) === wardFilter) &&
                (isIpSearch ? ipMatch?.wardId === w.id
                            : (!dq || w.name.toLowerCase().includes(dq) || nameWardIds.has(w.id)));
            }).map((w, i) => {
              const dq = wardSearch.trim();
              // Seed the ward's bed search only when the ward was found VIA a bed
              // — seeding a ward-name query would filter every bed out.
              const seed = /^\d{6}$/.test(dq)
                || (nameWardIds.has(w.id) && !w.name.toLowerCase().includes(nameQuery));
              return (
                <WardCard key={w.id} w={w} i={i}
                  onOpen={() => onOpenWard(seed ? { ...w, _search: dq } : w)} />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────────
function Dashboard({ me, user, onOpenBlock, showSummary, showSearch, onOpenWard, ipIndex, bedRows, search, setSearch, blockFilter, setBlockFilter }) {
  // Every ward this doctor can open, flattened across their blocks and tagged
  // with the block it came from (/doctor/me ships the roster up front).
  const allWards = useMemo(
    () => me.blocks.flatMap((b) => (b.wards || []).map((w) => ({ ...w, _blockId: b.id, _blockName: b.name }))),
    [me.blocks]
  );

  const q = (search || "").trim();
  const ql = q.toLowerCase();
  const isIpSearch = /^\d{6}$/.test(q);
  const searching = showSearch && q.length > 0;

  // Results mode. A 6-digit query is an IP lookup resolved against the prefetched
  // index — a synchronous Map hit, so results land on the keystroke. Anything
  // else is a plain ward-name match. Either way the output is ward cards, so an
  // IP goes straight to its ward in one click instead of block → ward.
  const ipBed = isIpSearch && ipIndex ? ipIndex.get(q) : undefined;
  // Patient-name matches join the existing ward/block name matches as a third
  // additive criterion — a name search surfaces the wards holding that patient.
  const nameQuery = isIpSearch ? "" : normalizeQuery(search);
  const nameWardIds = useMemo(
    () => wardIdsMatchingPatientName(bedRows, nameQuery),
    [bedRows, nameQuery],
  );
  const results = useMemo(() => {
    if (!searching) return [];
    const scoped = allWards.filter((w) => blockFilter === "all" || String(w._blockId) === blockFilter);
    const matched = isIpSearch
      ? (ipBed ? scoped.filter((w) => Number(w.id) === Number(ipBed.ward_id)) : [])
      : scoped.filter((w) =>
        w.name?.toLowerCase().includes(ql) ||
        w._blockName?.toLowerCase().includes(ql) ||
        w.block_name?.toLowerCase().includes(ql) ||
        nameWardIds.has(w.id)
      );
    // A ward can belong to more than one Doctor Block, so it can appear twice in
    // the flattened list — show it once (dedupe after filtering, so the block
    // filter still finds it under either block).
    const seen = new Set();
    return matched.filter((w) => !seen.has(Number(w.id)) && seen.add(Number(w.id)));
  }, [searching, allWards, blockFilter, isIpSearch, ipBed, ql, nameWardIds]);

  const ipStillLoading = isIpSearch && ipIndex === null;

  const s = me.summary || {};
  const totalOcc = (s.occupied || 0) + (s.occupied_reserved || 0);
  const occPct = s.total > 0 ? Math.round((totalOcc / s.total) * 100) : 0;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  // Every tile counts USABLE capacity, so Occupied + Vacant + Reserved add up to
  // Beds. Out-of-service beds are excluded from all of them (a patient cannot be
  // admitted to one) but shown as a note under Beds rather than dropped —
  // "99 beds / 1 out of service" keeps the fact without breaking the arithmetic.
  const outOfService = s.outOfService || 0;
  // Lounge places are kept OUT of the ward tiles — a place in the discharge
  // lounge is not a bed anyone can be admitted to, so folding it into capacity
  // would misstate what is available. But the people waiting there are real
  // patients, so they get their own tile rather than disappearing. Omitted
  // entirely when this doctor has no lounge ward, so nobody reads a bare 0 as
  // "the lounge is empty" when the truth is "you cannot see the lounge".
  const lounge = me.lounge || null;
  // [label, value, accent, note, icon]. The accent is always a THEME TOKEN, never
  // a literal colour — it drives the number, the icon and the underline, so a
  // hard-coded value would look wrong the moment the user switches theme.
  // [label, value, accent, note, icon]. The accent is always a THEME TOKEN, never
  // a literal — it drives the badge and the watermark, so a hard-coded value
  // would look wrong the moment the user switches theme.
  const reserved = (s.reserved || 0) + (s.occupied_reserved || 0);
  // [label, value, accent, note, icon, art]. `art` names a sprite in public/art.
  // Wards and Reserved have no illustration that means the right thing, so they
  // take an abstract wave rather than borrowing a picture that says something
  // else — a first-aid kit on "Reserved" would be worse than no art at all.
  // Every badge takes --primary. The status colours (orange for occupied, green
  // for vacant) were dropped deliberately: a colour that changes per tile invites
  // the reader to decode it, and on this screen the badge is an ornament — the
  // LABEL says what the number is. One theme colour throughout means the row
  // reads as a set, and it follows the active theme with nothing to keep in sync.
  // No art on the capacity row: these seven are the numbers a doctor actually
  // reads, and an illustration behind a figure competes with it. The discharge
  // row below keeps its art — those are lower-traffic counts where the artwork
  // gives the row some weight instead of getting in the way.
  const stats = [
    ["Blocks", me.blocks.length, "var(--primary)", null, "building"],
    ["Wards", me.wardCount, "var(--primary)", null, "grid"],
    ["Beds", s.total, "var(--primary)", null, "bed"],
    ["Occupied", totalOcc, "var(--primary)", null, "user"],
    ["Vacant", s.vacant, "var(--primary)", null, "check"],
    ["Reserved", reserved, "var(--primary)", null, "bookmark"],
    ...(lounge ? [["In Lounge", lounge.patients, "var(--primary)", null, "clock"]] : []),
  ];

  return (
    <div className="slide-up">
      {showSummary && (
        <>
          <div className="doc-hero">
            <div className="doc-ring" style={{ "--pct": occPct }}>
              <div className="doc-ring-in">
                <div className="doc-ring-pct" style={{ color: occPct >= 90 ? "var(--st-or)" : occPct >= 60 ? "var(--st-o)" : "var(--st-v)" }}>{occPct}%</div>
                <div className="doc-ring-lbl">Occupied</div>
              </div>
            </div>
            <div className="doc-hero-text">
              <div className="doc-hello">{greet},</div>
              <div className="doc-name">{user.name || user.username || "Doctor"}</div>
              <div className="doc-sub"><span className="doc-live">Live</span> · {me.wardCount} wards across {me.blocks.length} block{me.blocks.length === 1 ? "" : "s"}</div>
            </div>
            {/* Decorative only. Inline SVG rather than a background image so it
                inherits a theme token — a flat asset would keep its own colours
                when the user switches theme, which is exactly what looks broken.
                aria-hidden because it carries no information. */}
            <span className="doc-hero-art art-hospital" aria-hidden="true" />
          </div>

          <div className="doc-statline">
            {stats.map(([l, v, c, , ic]) => (
              // --accent cascades to the badge and the icon watermark, so one
              // token keeps them in step across every theme.
              <div key={l} className="doc-stat" style={{ "--accent": c }}>
                <span className="doc-stat-head">
                  <span className="doc-stat-ic" aria-hidden="true"><Ic d={icons[ic] || icons.grid} s={13} /></span>
                  <span className="doc-stat-l">{l}</span>
                </span>
                <span className="doc-stat-row"><span className="doc-stat-v">{v}</span></span>
                {/* Decorative. loading="lazy" and aria-hidden: it carries no
                    information, so it should neither block the first paint nor be
                    announced. Tiles without an illustration fall back to a faint
                    copy of their own icon. */}
              </div>
            ))}
          </div>

          {/* Its own row: four discharge counters, deliberately separate from the
              seven capacity tiles above. They answer a different question — what
              is happening today, not what the wards hold — so they read better as
              their own line than mixed into the same run of tiles. */}
          <DischargeMiniWidget rich />
        </>
      )}

      {showSearch && me.blocks.length > 0 && searchRow({
        value: search,
        onChange: setSearch,
        placeholder: "Search ward / patient / IP…",
        select: me.blocks.length > 1 && (
          <select className="field" aria-label="Filter by block" value={blockFilter}
            onChange={(e) => setBlockFilter(e.target.value)}
            style={{ width: "auto", flex: "0 1 auto", maxWidth: 200, fontWeight: 600 }}>
            <option value="all">All blocks ({me.blocks.length})</option>
            {me.blocks.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          </select>
        ),
      })}

      {searching ? (
        <>
          <div className="floor-head">
            {isIpSearch ? "Patient search" : "Matching wards"}
            {results.length > 0 && (
              <span className="chip" style={{ marginLeft: 8, fontSize: 11, verticalAlign: "middle" }}>
                {results.length} ward{results.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {ipStillLoading ? (
            <div className="card empty" style={{ padding: "28px 20px" }}>
              <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={22} /></span>
              <div className="dim" style={{ marginTop: 10, fontSize: 13 }}>Looking up IP {q}…</div>
            </div>
          ) : results.length === 0 ? (
            <div className="card empty" style={{ padding: "28px 20px" }}>
              <Ic d={icons.search} s={26} />
              <div style={{ marginTop: 10, fontWeight: 600, fontSize: 14 }}>
                {isIpSearch ? `No patient with IP ${q} in your wards` : `No ward matches “${q}”`}
              </div>
              <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                {isIpSearch ? "Only wards in your Doctor Blocks are searched." : "Try a ward, block or patient name, or a 6-digit IP."}
              </div>
            </div>
          ) : (
            <div className="card-grid">
              {results.map((w, i) => (
                <WardCard key={w.id} w={w} i={i}
                  note={
                    isIpSearch && ipBed
                      ? <><Ic d={icons.bed} s={11} /> Bed {ipBed.bed_name} · IP {q} · {w._blockName}</>
                      : <span style={{ color: "var(--ink-3)" }}>{w._blockName}</span>
                  }
                  onOpen={() => onOpenWard({ ...w, _search: isIpSearch || (nameWardIds.has(w.id) && !w.name?.toLowerCase().includes(nameQuery)) ? q : undefined })} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="floor-head">My Doctor Blocks</div>
          {me.blocks.length === 0 ? (
            <div className="card empty" style={{ marginTop: 12, padding: "32px 20px" }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--panel-2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
                <Ic d={icons.stethoscope} s={28} />
              </div>
              <div style={{ marginTop: 14, fontWeight: 700, fontSize: 15 }}>No Doctor Blocks Assigned</div>
              <div style={{ fontSize: 13, marginTop: 5, color: "var(--ink-3)" }}>Please contact your administrator to get access.</div>
            </div>
          ) : (
            <div className="card-grid">
              {me.blocks.map((b) => (
                // Renders instantly, like the ward cards it leads to — same
                // staggered slide-up, same "looks like it is still loading".
                <div key={b.id} className="doc-block" role="button" tabIndex={0}
                  onClick={() => onOpenBlock(b.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpenBlock(b.id)}>
                  <div className="doc-block-top">
                    <div className="doc-badge"><Ic d={icons.stethoscope} s={21} /></div>
                    <div className="doc-block-body">
                      <div className="doc-block-name">{b.name}</div>
                      <div className="doc-block-meta">{b.ward_count} ward{b.ward_count === 1 ? "" : "s"} · {b.total_beds} beds</div>
                    </div>
                    <Ic d={icons.chevron} s={18} style={{ color: "var(--ink-3)" }} />
                  </div>
                  {b.description && <div className="dim" style={{ fontSize: 12, padding: "0 16px 12px", marginTop: -4 }}>{b.description}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Activity timeline ─────────────────────────────────────────────────────────────
function ActivityView() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.doctorActivity().then((r) => setRows(r.activity || [])).catch(() => setRows([])); }, []);
  if (rows === null) return <div className="empty" style={{ paddingTop: 60 }}><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={24} /></span></div>;
  if (rows.length === 0) return <div className="card empty" style={{ padding: "32px 20px" }}><Ic d={icons.clock} s={28} /><div style={{ marginTop: 10, fontWeight: 700 }}>No activity yet</div><div className="dim" style={{ fontSize: 12, marginTop: 4 }}>Your bed updates will appear here.</div></div>;
  return (
    <div className="slide-up">
      <div className="floor-head">My Recent Bed Updates</div>
      <div className="doc-tl">
        {rows.map((r) => {
          const c = bedStateColor(r.new_physical, r.new_reservation);
          return (
            <div key={r.id} className="doc-tl-item">
              <span className="doc-tl-dot" style={{ background: c }} />
              <div className="doc-tl-top">
                <div className="doc-tl-bed">{r.bed_name} <span className="dim" style={{ fontWeight: 500, fontSize: 12 }}>· {r.ward_name || "—"}</span></div>
                <div className="doc-tl-time" title={fmtDateTime(r.created_at)}><RelativeTime ts={r.created_at} /></div>
              </div>
              <div className="doc-trans">
                <span className="doc-pill" style={{ background: "var(--panel-2)", color: "var(--ink-3)" }}>{bedStateShort(r.old_physical, r.old_reservation)}</span>
                <Ic d={icons.chevron} s={12} style={{ color: "var(--ink-3)" }} />
                <span className="doc-pill" style={{ background: bedStateBg(r.new_physical, r.new_reservation), color: c }}>{bedStateShort(r.new_physical, r.new_reservation)}</span>
                {r.block_name ? <span className="dim" style={{ fontSize: 11 }}>· {r.block_name}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  DOCTOR APP
// ══════════════════════════════════════════════════════════════════════════════
export default function DoctorApp({ user, onLogout }) {
  const [tab,         setTab]         = useState("dash");
  const [me,          setMe]          = useState(null);
  const [loadError,   setLoadError]   = useState(null);
  const [toast,       setToast]       = useState("");
  const [blockId,     setBlockId]     = useState(null);
  // Opening a block replaces the "My Doctor Blocks" home grid with BlockDetail
  // entirely — same swap pattern as ward↔WardPage below, same fix.
  const saveBlockScroll = useScrollRestore(!!blockId);
  const [ward,        setWard]        = useState(null);
  // Opening a ward replaces the current screen (block detail or search results)
  // with WardPage entirely — save/restore scroll across that swap the same way
  // Entry does in PREApp.jsx.
  const saveWardScroll = useScrollRestore(!!ward);
  // Wraps setWard so every place that opens a ward — BlockDetail's card click,
  // Dashboard's search-result click, or the IP-search effect's auto-jump —
  // saves scroll first, without each of those call sites needing to know that.
  // See useScrollRestore's doc comment for why this has to happen before
  // setWard, not reactively after.
  const openWard = useCallback((w) => { saveWardScroll(); setWard(w); }, [saveWardScroll]);
  // Mirrors `ward` for the socket handler, which must not re-subscribe when it
  // changes. docStaleRef records a refresh skipped while a ward was open.
  const wardOpenRef = useRef(false);
  const docStaleRef = useRef(false);
  useEffect(() => { wardOpenRef.current = !!ward; }, [ward]);
  const [reloadKey,   setReloadKey]   = useState(0);
  // Lives here, above the dash/dashboard/entry/discharges tab switch, so it
  // survives navigating away from and back to the Dashboard tab — see
  // useLiveBedDashboardData. Also gated off while a block/ward is open, same
  // as the tab condition below it's paired with.
  const dashboardData = useLiveBedDashboardData("doctor", !ward && !blockId && tab === "dashboard");
  // Entry search lives here, not in Dashboard, so opening a ward and coming back
  // doesn't wipe what you typed (Dashboard unmounts while a ward is open).
  const [entrySearch, setEntrySearch] = useState("");
  const [entryBlockFilter, setEntryBlockFilter] = useState("all");
  // Bed rows for IP lookup, scoped to this doctor's blocks. Owned here and
  // prefetched on mount so the search is answered from memory on the very first
  // keystroke — the old code fetched lazily on the 6th character, which is what
  // made searching stall, and threw the cache away on every block navigation.
  const [bedDetails,  setBedDetails]  = useState(null);
  const loadRef = useRef(null);

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2400); }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try { const data = await api.doctorMe(); setMe(data); }
    catch (e) { const msg = e?.message ?? ""; if (msg === "Unauthorized") return; setLoadError("Unable to connect to server"); }
  }, []);
  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  // Prefetch + keep fresh. Failures fall back to an empty list rather than null,
  // so the UI reports "not found" instead of spinning forever.
  const loadBedDetails = useCallback(() => {
    DOCTOR_CFG.bedDetails()
      .then((r) => setBedDetails(Array.isArray(r) ? r : []))
      .catch(() => setBedDetails([]));
  }, []);
  useEffect(() => { loadBedDetails(); }, [loadBedDetails]);

  // Upserts one bed into the search list in place — used when a bed:update
  // payload already carries the full row, so a single-bed change doesn't
  // need to refetch this whole doctor-scoped list. Doctor sockets only ever
  // join ward:<id> rooms for wards they're actually assigned (see io.ts),
  // so any bed reaching this handler is already in-scope.
  const patchBedDetail = useCallback((incoming) => {
    setBedDetails((prev) => {
      if (!prev) return prev;
      const idx = prev.findIndex((b) => b.id === incoming.id);
      if (idx === -1) return [...prev, incoming];
      const next = prev.slice();
      next[idx] = incoming;
      return next;
    });
  }, []);

  // ip_last6 → bed, rebuilt only when the rows change. Lookup is O(1) per
  // keystroke instead of a linear scan of every bed.
  const ipIndex = useMemo(() => {
    if (bedDetails === null) return null;
    const m = new Map();
    for (const b of bedDetails) if (b.ip_last6) m.set(String(b.ip_last6), b);
    return m;
  }, [bedDetails]);

  useEffect(() => {
    const socket = getSocket();
    // Bed rows change on the same events, but a full refetch is a heavier
    // payload than /me — coalesce bursts so a busy ward can't fire one per
    // event. Only used as a fallback now: a bed:update that already carries
    // the full row (every role's status-update route sends one) patches
    // patchBedDetail directly instead, no refetch needed.
    let t = null;
    const refetchBeds = () => { clearTimeout(t); t = setTimeout(() => loadBedDetails(), 400); };
    const onWardSummary = coalesce(() => { docStaleRef.current = false; loadRef.current(); setReloadKey((k) => k + 1); });
    // Skipped while a ward is open: WardPage replaces the block/ward view and
    // loads its own beds, so /doctor/me's summary is off screen. Remember the
    // refresh and replay it on the way out. The bed-details list is NOT gated —
    // it backs Entry search and patching it costs no request.
    const gatedSummary = () => { if (wardOpenRef.current) { docStaleRef.current = true; return; } onWardSummary(); };
    const onBedUpdate = (p) => {
      gatedSummary();
      if (p?.bed && p.bed.id != null) patchBedDetail(p.bed);
      else refetchBeds();
    };
    const onOther = () => { gatedSummary(); refetchBeds(); };
    socket.on("bed:update", onBedUpdate);
    socket.on("discharge:update", onOther);
    socket.on("discharge:overstay", onOther);
    // Only a RECONNECT refreshes — the first connect would duplicate the
    // mount-time loads a few hundred ms later. See onReconnect().
    // Never gated: after a disconnect nothing local can be trusted.
    const offReconnect = onReconnect(socket, () => { onWardSummary(); refetchBeds(); });
    return () => {
      clearTimeout(t);
      socket.off("bed:update", onBedUpdate);
      socket.off("discharge:update", onOther);
      socket.off("discharge:overstay", onOther);
      offReconnect(); onWardSummary.cancel();
    };
  }, [loadBedDetails, patchBedDetail]);

  const openBlock = (id) => { saveBlockScroll(); setBlockId(id); setWard(null); };
  const backToBlocks = () => { setBlockId(null); setWard(null); };

  const menu = [
    { key: "dash",       icon: icons.home,      label: "Home" },
    { key: "dashboard",  icon: icons.chart,     label: "Dashboard" },
    { key: "entry",      icon: icons.grid,      label: "Entry" },
    { key: "discharges", icon: icons.clipboard, label: "Discharges" },
  ];

  if (me === null) return (
    <div className="preui">
    <div className="empty" style={{ paddingTop: 120 }}>
      {loadError ? (
        <>
          <div style={{ fontWeight: 600 }}>Unable to connect to server</div>
          <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>Check your network and try again.</div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={load}><Ic d={icons.refresh} s={15} /> Retry</button>
        </>
      ) : (
        <>
          <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
          <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>Loading…</div>
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
    </div>
  );

  const title = ward ? ward.name : blockId ? "Entry" : menu.find((m) => m.key === tab)?.label || "Doctor";

  return (
    <div className="preui">
    <AppShell
      menu={menu}
      active={tab}
      onSelect={(k) => { setTab(k); setBlockId(null); setWard(null); setEntrySearch(""); setEntryBlockFilter("all"); }}
      title={title}
      user={{ name: user.name || user.username || "Doctor", role: "DOCTOR" }}
      onLogout={onLogout}
      topExtra={null}
    >
      {ward ? (
        <WardPage
          ward={{ ...ward, ward: ward.name }}
          initialTab="manage"
          initialSearch={ward._search}
          cfg={DOCTOR_CFG}
          onBack={() => {
            setWard(null);
            // Replay only what was skipped while inside the ward.
            if (docStaleRef.current) { docStaleRef.current = false; loadRef.current(); setReloadKey((k) => k + 1); }
          }}
        />
      ) : blockId ? (
        <BlockDetail blockId={blockId} reloadKey={reloadKey} onBack={backToBlocks} onOpenWard={openWard} showToast={showToast} ipIndex={ipIndex} bedRows={bedDetails} />
      ) : tab === "dashboard" ? (
        <LiveBedDashboard data={dashboardData} userName={user.name || user.username || "Doctor"} scope="doctor" />
      ) : tab === "discharges" ? (
        <DischargesPage role="DOCTOR" />
      ) : (
        <Dashboard me={me} user={user} onOpenBlock={openBlock} showSummary={tab === "dash"}
          showSearch={tab === "entry"} onOpenWard={openWard} ipIndex={ipIndex} bedRows={bedDetails}
          search={entrySearch} setSearch={setEntrySearch}
          blockFilter={entryBlockFilter} setBlockFilter={setEntryBlockFilter} />
      )}

      {toast && <div className="toast">{toast}</div>}
      <ProfileThemeRow />
    </AppShell>
    </div>
  );
}
