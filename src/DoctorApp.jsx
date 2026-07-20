import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { api, toastErr, createSocket, fmtRelative, fmtDateTime } from "./lib.js";
import { Ic, icons } from "./ui.jsx";
import { AppShell } from "./shell.jsx";
import { bedStateColor } from "./bedUtils.js";
import { WardPage, ProfileThemeRow, BackBtn } from "./PREApp.jsx";
import DischargesPage from "./DischargesPage.jsx";
import { LiveBedDashboard } from "./COOApp.jsx";

// Doctor endpoints for the shared ward/bed pages (same UI as PRE, doctor APIs + role).
const DOCTOR_CFG = {
  role: "DOCTOR",
  listBeds: (wardId) => api.doctorBeds(wardId),
  updateBedStatus: (...a) => api.doctorUpdateBedStatus(...a),
  payerTypes: () => api.doctorPayerTypes(),
  destinations: () => api.doctorDestinations(),
  reviewWard: (wardId) => api.doctorReviewWard(wardId),
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

// ── Block detail ─────────────────────────────────────────────────────────────────
function BlockDetail({ blockId, onBack, onOpenWard, showToast, reloadKey }) {
  const [data,      setData]      = useState(null);
  const [error,     setError]     = useState(null);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.doctorBlock(blockId).then(setData).catch((e) => setError(toastErr(e)));
  }, [blockId]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const [docsOpen, setDocsOpen] = useState(false); // doctors-list dropdown
  const [wardFilter, setWardFilter] = useState("all"); // "all" | ward id

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
              {data.reviewedAt ? <> · reviewed {fmtRelative(data.reviewedAt)}</> : ""}
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
          {/* Ward picker — jump straight to one ward when the list is long */}
          {data.wards.length > 1 && (
            <select className="field" aria-label="Filter by ward" value={wardFilter}
              onChange={(e) => setWardFilter(e.target.value)}
              style={{ marginBottom: 14, maxWidth: 380, fontWeight: 600 }}>
              <option value="all">All wards ({data.wards.length})</option>
              {data.wards.map((w) => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
            </select>
          )}
          <div className="card-grid">
            {data.wards.filter((w) => wardFilter === "all" || String(w.id) === wardFilter).map((w, i) => {
              const o = occOf(w);
              return (
                <div key={w.id} className="doc-ward slide-up tap" style={{ animationDelay: i * 0.03 + "s" }}
                  role="button" tabIndex={0}
                  onClick={() => w.operational !== false && onOpenWard(w)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && w.operational !== false && onOpenWard(w)}>
                  <div className="row between" style={{ alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      {(w.block_name || w.floor_name) && <div className="doc-ward-loc">{[w.block_name, w.floor_name].filter(Boolean).join(" · ")}</div>}
                      <div className="doc-ward-name">{w.name}</div>
                      <div className="doc-ward-rev">
                        {w.reviewedAt
                          ? <><Ic d={icons.check} s={11} /> Reviewed {fmtRelative(w.reviewedAt)}</>
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
                      onClick={(e) => { e.stopPropagation(); onOpenWard(w); }}>
                      <Ic d={icons.bed} s={14} /> {w.operational === false ? "Non-operational" : "View / Update Beds"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────────
function Dashboard({ me, user, onOpenBlock, showSummary }) {
  const s = me.summary;
  const totalOcc = (s.occupied || 0) + (s.occupied_reserved || 0);
  const occPct = s.total > 0 ? Math.round((totalOcc / s.total) * 100) : 0;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const stats = [
    ["Blocks", me.blocks.length, "var(--ink)"], ["Wards", me.wardCount, "var(--ink)"],
    ["Beds", s.total, "var(--ink)"], ["Occupied", totalOcc, "var(--st-o)"],
    ["Vacant", s.vacant, "var(--st-v)"], ["Reserved", (s.reserved || 0) + (s.occupied_reserved || 0), "var(--st-vr)"],
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
          </div>

          <div className="doc-statline">
            {stats.map(([l, v, c]) => (
              <div key={l} className="doc-stat"><div className="doc-stat-v" style={{ color: c }}>{v}</div><div className="doc-stat-l">{l}</div></div>
            ))}
          </div>

          <DischargeMiniWidget />
        </>
      )}

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
          {me.blocks.map((b, i) => {
            return (
              <div key={b.id} className="doc-block slide-up" role="button" tabIndex={0}
                style={{ animationDelay: i * 0.03 + "s" }}
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
            );
          })}
        </div>
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
                <div className="doc-tl-time" title={fmtDateTime(r.created_at)}>{fmtRelative(r.created_at)}</div>
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
  const [lastSync,    setLastSync]    = useState(null);
  const [blockId,     setBlockId]     = useState(null);
  const [ward,        setWard]        = useState(null);
  const [reloadKey,   setReloadKey]   = useState(0);
  const loadRef = useRef(null);

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2400); }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try { const data = await api.doctorMe(); setMe(data); setLastSync(new Date()); }
    catch (e) { const msg = e?.message ?? ""; if (msg === "Unauthorized") return; setLoadError(msg || "Unable to connect to server"); }
  }, []);
  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const socket = createSocket();
    const onChange = () => { loadRef.current(); setReloadKey((k) => k + 1); setLastSync(new Date()); };
    socket.on("bed:update", onChange);
    socket.on("discharge:update", onChange);
    socket.on("discharge:overstay", onChange);
    socket.on("connect", onChange);
    return () => { socket.disconnect(); };
  }, []);

  const openBlock = (id) => { setBlockId(id); setWard(null); };
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
      onSelect={(k) => { setTab(k); setBlockId(null); setWard(null); }}
      title={title}
      user={{ name: user.name || user.username || "Doctor", role: "DOCTOR" }}
      onLogout={onLogout}
      topExtra={null}
    >
      {ward ? (
        <WardPage
          ward={{ ...ward, ward: ward.name }}
          initialTab="manage"
          cfg={DOCTOR_CFG}
          allWards={[]}
          onBack={() => setWard(null)}
        />
      ) : blockId ? (
        <BlockDetail blockId={blockId} reloadKey={reloadKey} onBack={backToBlocks} onOpenWard={setWard} showToast={showToast} />
      ) : tab === "dashboard" ? (
        <LiveBedDashboard refreshKey={reloadKey} userName={user.name || user.username || "Doctor"} scope="doctor" />
      ) : tab === "discharges" ? (
        <DischargesPage role="DOCTOR" />
      ) : (
        <Dashboard me={me} user={user} onOpenBlock={openBlock} showSummary={tab === "dash"} />
      )}

      {lastSync && !ward && !blockId && (
        <div className="dim" style={{ fontSize: 11, textAlign: "center", marginTop: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--st-v)" }} />
          Updates instantly · last sync {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
      <ProfileThemeRow />
    </AppShell>
    </div>
  );
}
