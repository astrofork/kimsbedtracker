import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { api, toastErr, createSocket, fmtRelative, fmtDateTime } from "./lib.js";
import { Ic, icons, useModal } from "./ui.jsx";
import { AppShell } from "./shell.jsx";
import { naturalSort, bedStateColor, bedStateBg, bedStateShort } from "./bedUtils.js";

// ── helpers ──────────────────────────────────────────────────────────────────────
const initialsOf = (s) => (s || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const occOf = (w) => {
  const total = w.total_beds ?? w.total ?? 0;
  const on = w.occupied ?? 0, or = w.occupied_reserved ?? 0, vr = w.reserved ?? 0, vn = w.vacant ?? 0;
  const occ = on + or;
  return { total, on, or, vr, vn, occ, pct: total > 0 ? Math.round((occ / total) * 100) : 0 };
};
const pctColor = (pct) => pct >= 90 ? "var(--st-or)" : pct >= 60 ? "var(--st-o)" : "var(--st-v)";
const pctBg    = (pct) => pct >= 90 ? "rgba(255,59,138,.12)" : pct >= 60 ? "rgba(249,115,22,.12)" : "rgba(34,197,94,.12)";

// ── OccBar ───────────────────────────────────────────────────────────────────────
function OccBar({ w, hero }) {
  const { total, on, or, vr } = occOf(w);
  const p = (n) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className={hero ? "doc-blk-hero-bar" : "doc-bar"} title={`${on} occupied · ${or} occ+res · ${vr} vac+res of ${total}`}>
      <i className="seg-o"  style={{ width: `${p(on)}%` }} />
      <i className="seg-or" style={{ width: `${p(or)}%` }} />
      <i className="seg-vr" style={{ width: `${p(vr)}%` }} />
    </div>
  );
}

// ── BedCard ──────────────────────────────────────────────────────────────────────
const BedCard = React.memo(function BedCard({ bed, onClick }) {
  const color  = bedStateColor(bed.physical_status, bed.reservation_status);
  const bg     = bedStateBg(bed.physical_status, bed.reservation_status);
  const dimmed = bed.operational_status === false;
  return (
    <div className={"bed-tile" + (onClick ? " tap" : "")}
      role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      style={{ borderColor: color, background: bg, opacity: dimmed ? 0.5 : 1, cursor: onClick ? undefined : "default" }}>
      <span className="bname">{bed.bed_name}</span>
      <span className="bstate" style={{ color }}>{bedStateShort(bed.physical_status, bed.reservation_status)}</span>
      {bed.physical_status === "OCCUPIED" && bed.payer_type && (
        <span style={{ fontSize: 9, fontWeight: 700, color: "var(--primary)", lineHeight: 1.1, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {bed.payer_type}
        </span>
      )}
      {bed.reservation_status === "RESERVED" && bed.physical_status === "OCCUPIED" && bed.destination && (
        <span style={{ fontSize: 9, fontWeight: 700, color: "var(--st-or)", lineHeight: 1.1, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>→ {bed.destination}</span>
      )}
      {bed.reservation_status === "RESERVED" && bed.physical_status === "VACANT" && bed.reservation_note && (
        <span title={bed.reservation_note} style={{ fontSize: 9, fontWeight: 700, color: "var(--st-vr)", lineHeight: 1.1, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          📝 {bed.reservation_note}
        </span>
      )}
    </div>
  );
});

// ── BedDetailSheet ───────────────────────────────────────────────────────────────
function BedDetailSheet({ bed, onSave, onClose }) {
  useModal(onClose);
  const [physical,    setPhysical]    = useState(bed.physical_status);
  const [reservation, setReservation] = useState(bed.reservation_status);
  const [payer,       setPayer]       = useState(bed.payer_type || "");
  const [payerTypes,  setPayerTypes]  = useState([]);
  const [destination, setDestination] = useState(bed.destination || "");
  const [destinations,setDestinations]= useState([]);
  const [resNote,     setResNote]     = useState(bed.reservation_note || "");
  const [saving,      setSaving]      = useState(false);
  const [noteOpen,    setNoteOpen]    = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const color = bedStateColor(physical, reservation);
  const bg    = bedStateBg(physical, reservation);

  useEffect(() => {
    api.doctorPayerTypes().then(r => setPayerTypes(r.payerTypes || [])).catch(() => {});
    api.doctorDestinations().then(r => setDestinations(r.destinations || [])).catch(() => {});
  }, []);

  const handleSetPhysical = (val) => { setPhysical(val); if (val === "VACANT") setPayer(""); };
  const needsPayer       = physical === "OCCUPIED";
  const payerLocked      = physical === "OCCUPIED" && reservation === "RESERVED" && bed.physical_status === "OCCUPIED";
  const needsDestination = physical === "OCCUPIED" && reservation === "RESERVED";
  const needsResNote     = physical === "VACANT"   && reservation === "RESERVED";
  const canSave          = !(needsPayer && !payer && !payerLocked) && !(needsDestination && !destination) && !(needsResNote && !resNote.trim());

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const payerArg       = physical === "VACANT" ? null : (payerLocked && payer === (bed.payer_type || "") ? undefined : payer || null);
    const destinationArg = needsDestination ? destination : undefined;
    const resNoteArg     = needsResNote ? resNote : undefined;
    try { await onSave(bed.id, physical, reservation, payerArg, destinationArg, resNoteArg); onClose(); }
    catch { /* parent toasts */ }
    finally { if (mountedRef.current) setSaving(false); }
  };

  const physOpts = [
    { val: "VACANT",   color: "var(--st-v)",  icon: icons.check, lbl: "Vacant",   sub: "Bed is empty"   },
    { val: "OCCUPIED", color: "var(--st-o)",  icon: icons.bed,   lbl: "Occupied", sub: "Patient in bed" },
  ];
  const resOpts = [
    { val: "NONE",     color: "var(--ink-2)", icon: icons.x,     lbl: "None",     sub: "No reservation" },
    { val: "RESERVED", color: "var(--st-vr)", icon: icons.clock, lbl: "Reserved", sub: "Bed reserved"   },
  ];

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">

          {/* Colored status header */}
          <div className="doc-bed-hdr" style={{ background: bg, border: `1.5px solid ${color}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div className="doc-bed-hdr-name" style={{ color }}>{bed.bed_name}</div>
                <div className="doc-bed-hdr-sub" style={{ color }}>Update bed status</div>
              </div>
              <button className="chip" onClick={onClose} style={{ flexShrink: 0 }}>Close</button>
            </div>
            <div className="doc-bed-state-badge" style={{ color }}>
              <Ic d={icons.bed} s={12} />
              {bedStateShort(physical, reservation)}
            </div>
          </div>

          {/* Existing reservation context */}
          {bed.physical_status === "OCCUPIED" && bed.reservation_status === "RESERVED" && bed.destination && (
            <div style={{ background: "rgba(255,59,138,.08)", border: "1px solid var(--st-or)", borderRadius: 12, padding: "10px 14px", marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "var(--st-or)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Current Location</div>
              <div style={{ fontSize: 13, fontWeight: 700, wordBreak: "break-word" }}>{bed.destination}</div>
            </div>
          )}
          {bed.physical_status === "VACANT" && bed.reservation_status === "RESERVED" && bed.reservation_note && (
            <div onClick={() => setNoteOpen(o => !o)} role="button" tabIndex={0}
              onKeyDown={e => (e.key === "Enter" || e.key === " ") && setNoteOpen(o => !o)}
              style={{ background: "rgba(124,58,237,.08)", border: "1px solid var(--st-vr)", borderRadius: 12, padding: "10px 14px", marginBottom: 16, cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "var(--st-vr)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Reservation Note</div>
                <span className="dim" style={{ fontSize: 10 }}>{noteOpen ? "collapse" : "expand"}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, wordBreak: "break-word",
                display: noteOpen ? "block" : "-webkit-box", WebkitLineClamp: noteOpen ? "unset" : 2,
                WebkitBoxOrient: "vertical", overflow: noteOpen ? "visible" : "hidden" }}>{bed.reservation_note}</div>
            </div>
          )}

          {/* Physical status card selectors */}
          <div className="doc-field-lbl">Physical Status</div>
          <div className="doc-status-grid">
            {physOpts.map(({ val, color: c, icon, lbl, sub }) => (
              <div key={val} className={"doc-status-card" + (physical === val ? " active" : "")}
                style={{ color: physical === val ? c : "var(--ink-2)" }}
                onClick={() => handleSetPhysical(val)} role="button" tabIndex={0}
                onKeyDown={e => (e.key === "Enter" || e.key === " ") && handleSetPhysical(val)}>
                <div className="doc-status-card-icon"
                  style={{ background: physical === val ? `${c}22` : "var(--line)", color: physical === val ? c : "var(--ink-3)" }}>
                  <Ic d={icon} s={18} />
                </div>
                <div className="doc-status-card-lbl">{lbl}</div>
                <div className="doc-status-card-sub">{sub}</div>
              </div>
            ))}
          </div>

          {/* Reservation status card selectors */}
          <div className="doc-field-lbl">Reservation Status</div>
          <div className="doc-status-grid" style={{ marginBottom: 18 }}>
            {resOpts.map(({ val, color: c, icon, lbl, sub }) => (
              <div key={val} className={"doc-status-card" + (reservation === val ? " active" : "")}
                style={{ color: reservation === val ? c : "var(--ink-2)" }}
                onClick={() => setReservation(val)} role="button" tabIndex={0}
                onKeyDown={e => (e.key === "Enter" || e.key === " ") && setReservation(val)}>
                <div className="doc-status-card-icon"
                  style={{ background: reservation === val ? `${c}22` : "var(--line)", color: reservation === val ? c : "var(--ink-3)" }}>
                  <Ic d={icon} s={18} />
                </div>
                <div className="doc-status-card-lbl">{lbl}</div>
                <div className="doc-status-card-sub">{sub}</div>
              </div>
            ))}
          </div>

          {needsPayer && (
            <div style={{ marginBottom: 18 }}>
              <div className="doc-field-lbl">Payer Type {!payerLocked && <span style={{ color: "var(--red)" }}>*</span>}</div>
              <select className="field" value={payer} onChange={e => setPayer(e.target.value)}
                style={{ borderColor: needsPayer && !payer && !payerLocked ? "var(--red)" : undefined }}>
                <option value="">{payerLocked ? `Keep current (${bed.payer_type || "—"})` : "— Select payer type —"}</option>
                {payerTypes.map(pt => <option key={pt.id} value={pt.name}>{pt.name}</option>)}
              </select>
              {needsPayer && !payer && !payerLocked && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Required for occupied beds.</div>}
            </div>
          )}
          {needsDestination && (
            <div style={{ marginBottom: 18 }}>
              <div className="doc-field-lbl">Current Location <span style={{ color: "var(--red)" }}>*</span></div>
              <select className="field" value={destination} onChange={e => setDestination(e.target.value)}
                style={{ borderColor: !destination ? "var(--red)" : undefined }}>
                <option value="">— Choose Location —</option>
                {destinations.map(dt => <option key={dt.id} value={dt.name}>{dt.name}</option>)}
              </select>
              {!destination && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Required for Occupied + Reserved beds.</div>}
            </div>
          )}
          {needsResNote && (
            <div style={{ marginBottom: 18 }}>
              <div className="doc-field-lbl">Reservation Note <span style={{ color: "var(--red)" }}>*</span></div>
              <textarea className="field" value={resNote} maxLength={255} rows={2}
                placeholder="e.g. Reserved for incoming transfer from ICU"
                onChange={e => setResNote(e.target.value)}
                style={{ resize: "vertical", fontSize: 13, fontFamily: "inherit", borderColor: !resNote.trim() ? "var(--red)" : undefined }} />
              {!resNote.trim() && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Required for Vacant + Reserved beds.</div>}
            </div>
          )}

          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 1.5 }} disabled={saving || !canSave} onClick={handleSave}>
              {saving ? "Saving…" : "Update Status"}
            </button>
          </div>
          <div style={{ height: 8 }} />
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── WardBedView ──────────────────────────────────────────────────────────────────
function WardBedView({ ward, beds, loading, onBack, onSave }) {
  const [filter,     setFilter]     = useState("ALL");
  const [editingBed, setEditingBed] = useState(null);

  const sorted = useMemo(() => [...beds].sort((a, b) => naturalSort(a.bed_name, b.bed_name)), [beds]);
  const live = useMemo(() => {
    const c = { total: sorted.length, vacant: 0, reserved: 0, occupied: 0, occupied_reserved: 0 };
    for (const b of sorted) {
      const o = b.physical_status === "OCCUPIED", r = b.reservation_status === "RESERVED";
      if (o && r) c.occupied_reserved++; else if (o) c.occupied++; else if (r) c.reserved++; else c.vacant++;
    }
    return c;
  }, [sorted]);

  const fc = { ALL: sorted.length, Vacant: live.vacant, Occupied: live.occupied + live.occupied_reserved, Reserved: live.reserved + live.occupied_reserved };
  const displayed = sorted.filter(b =>
    filter === "Vacant"   ? b.physical_status === "VACANT" :
    filter === "Occupied" ? b.physical_status === "OCCUPIED" :
    filter === "Reserved" ? b.reservation_status === "RESERVED" : true);

  const LEGEND = [
    { lbl: "Vacant",   color: "var(--st-v)"  },
    { lbl: "Vac+Res",  color: "var(--st-vr)" },
    { lbl: "Occupied", color: "var(--st-o)"  },
    { lbl: "Occ+Res",  color: "var(--st-or)" },
  ];

  return (
    <div className="slide-up">
      <button className="doc-back" onClick={onBack}>
        <Ic d={icons.chevron} s={15} style={{ transform: "rotate(180deg)" }} /> Back to Wards
      </button>

      {/* Ward header card */}
      <div className="doc-ward-hdr">
        <div className="doc-ward-hdr-name">{ward.name}</div>
        <div className="doc-ward-hdr-meta">{live.total} beds total</div>
        <div style={{ margin: "12px 0 0" }}><OccBar w={live} /></div>
        <div className="doc-ward-hdr-stats">
          {[
            { lbl: "Vacant",   val: live.vacant,            color: "var(--st-v)"  },
            { lbl: "Vac+Res",  val: live.reserved,          color: "var(--st-vr)" },
            { lbl: "Occupied", val: live.occupied,           color: "var(--st-o)"  },
            { lbl: "Occ+Res",  val: live.occupied_reserved,  color: "var(--st-or)" },
          ].map(({ lbl, val, color }) => (
            <div key={lbl} className="doc-ward-hdr-stat">
              <div className="doc-ward-hdr-stat-v" style={{ color }}>{val}</div>
              <div className="doc-ward-hdr-stat-l">{lbl}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter chips */}
      <div className="doc-filter-bar">
        {[["ALL","All"],["Vacant","Vacant"],["Occupied","Occupied"],["Reserved","Reserved"]].map(([key, label]) => (
          <button key={key} className={"doc-filter-chip" + (filter === key ? " on" : "")} onClick={() => setFilter(key)}>
            {label}{fc[key] > 0 && <span className="doc-filter-count">{fc[key]}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
        </div>
      ) : displayed.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 20px", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16 }}>
          <Ic d={icons.bed} s={28} style={{ color: "var(--ink-3)" }} />
          <div style={{ marginTop: 10, fontWeight: 700 }}>No beds match this filter.</div>
        </div>
      ) : (
        <div className="bed-grid">
          {displayed.map(bed => (
            <BedCard key={bed.id} bed={bed} onClick={bed.operational_status !== false ? () => setEditingBed(bed) : undefined} />
          ))}
        </div>
      )}

      <div className="doc-legend">
        {LEGEND.map(({ lbl, color }) => (
          <span key={lbl} className="doc-legend-item">
            <span className="doc-legend-swatch" style={{ background: color }} />{lbl}
          </span>
        ))}
      </div>

      {editingBed && (
        <BedDetailSheet bed={editingBed}
          onSave={async (...a) => { await onSave(...a); setEditingBed(null); }}
          onClose={() => setEditingBed(null)} />
      )}
    </div>
  );
}

// ── BlockDetail ──────────────────────────────────────────────────────────────────
function BlockDetail({ blockId, onBack, onOpenWard, showToast, reloadKey }) {
  const [data,          setData]          = useState(null);
  const [error,         setError]         = useState(null);
  const [reviewing,     setReviewing]     = useState(false);
  const [reviewingWard, setReviewingWard] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.doctorBlock(blockId).then(setData).catch(e => setError(toastErr(e)));
  }, [blockId]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const review = async () => {
    setReviewing(true);
    try {
      const r = await api.doctorReview(blockId);
      setData(d => d ? { ...d, reviewedAt: r.reviewedAt, wards: d.wards.map(w => ({ ...w, reviewedAt: r.reviewedAt })) } : d);
      showToast("All wards marked reviewed ✓");
    } catch (e) { showToast(toastErr(e)); }
    finally { setReviewing(false); }
  };

  const reviewWard = async (wardId) => {
    setReviewingWard(wardId);
    try {
      const r = await api.doctorReviewWard(wardId);
      setData(d => d ? { ...d, wards: d.wards.map(w => w.id === wardId ? { ...w, reviewedAt: r.reviewedAt } : w) } : d);
      showToast("Ward marked reviewed ✓");
    } catch (e) { showToast(toastErr(e)); }
    finally { setReviewingWard(null); }
  };

  if (error) return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <Ic d={icons.alert} s={32} style={{ color: "var(--red)" }} />
      <div style={{ fontWeight: 700, fontSize: 16, marginTop: 12 }}>{error}</div>
      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onBack}>Go Back</button>
    </div>
  );
  if (!data) return (
    <div className="empty" style={{ paddingTop: 80 }}>
      <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
      <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>Loading block…</div>
    </div>
  );

  const totals   = data.wards.reduce((a, w) => { const o = occOf(w); return { total: a.total + o.total, occ: a.occ + o.occ, on: a.on + o.on, or: a.or + o.or, vr: a.vr + o.vr }; }, { total: 0, occ: 0, on: 0, or: 0, vr: 0 });
  const blockPct = totals.total > 0 ? Math.round((totals.occ / totals.total) * 100) : 0;
  const blockBarW = { total: totals.total, occupied: totals.on, occupied_reserved: totals.or, reserved: totals.vr };

  return (
    <div className="slide-up">
      <button className="doc-back" onClick={onBack}>
        <Ic d={icons.chevron} s={15} style={{ transform: "rotate(180deg)" }} /> All Blocks
      </button>

      {/* Premium gradient hero */}
      <div className="doc-blk-hero">
        <div className="doc-blk-hero-top">
          <div>
            <div className="doc-blk-hero-name">{data.name}</div>
            <div className="doc-blk-hero-sub">
              {data.wards.length} ward{data.wards.length !== 1 ? "s" : ""} &nbsp;·&nbsp; {totals.total} beds
            </div>
          </div>
          <div className="doc-blk-hero-right">
            <div className="doc-blk-hero-pct">{blockPct}%</div>
            <div className="doc-blk-hero-pct-lbl">occupied</div>
          </div>
        </div>
        <OccBar w={blockBarW} hero />
        <div className="doc-blk-rev-row">
          <div className="doc-blk-rev-text">
            {data.reviewedAt ? <>Reviewed {fmtRelative(data.reviewedAt)}</> : "Not reviewed yet"}
          </div>
          <button className="doc-blk-rev-btn" disabled={reviewing || data.wards.length === 0} onClick={review}>
            <Ic d={icons.check} s={13} />
            {reviewing ? "Saving…" : "Mark All Reviewed"}
          </button>
        </div>
      </div>

      {/* Doctor chips */}
      {data.doctors.length > 0 && (
        <div className="doc-doc-chips">
          {data.doctors.map(d => (
            <span key={d.id} className="doc-doc-chip">
              <span className="doc-doc-av">{initialsOf(d.name)}</span>{d.name}
            </span>
          ))}
        </div>
      )}

      {data.description && (
        <div className="dim" style={{ fontSize: 13, marginBottom: 16 }}>{data.description}</div>
      )}

      {data.wards.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 18 }}>
          <Ic d={icons.grid} s={28} style={{ color: "var(--ink-3)" }} />
          <div style={{ marginTop: 10, fontWeight: 700 }}>No wards assigned</div>
        </div>
      ) : (
        <>
          <div className="floor-head">Wards</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.wards.map((w, i) => {
              const o = occOf(w);
              const c = pctColor(o.pct);
              return (
                <div key={w.id} className="doc-ward-v3 slide-up" style={{ animationDelay: i * 0.04 + "s" }}>
                  <div className="doc-ward-v3-top">
                    <div className="doc-ward-v3-info">
                      {(w.block_name || w.floor_name) && <div className="doc-ward-v3-loc">{[w.block_name, w.floor_name].filter(Boolean).join(" · ")}</div>}
                      <div className="doc-ward-v3-name">{w.name}</div>
                      <div className="doc-ward-v3-rev" style={{ color: w.reviewedAt ? "var(--st-v)" : "var(--ink-3)" }}>
                        {w.reviewedAt
                          ? <><Ic d={icons.check} s={11} /> Reviewed {fmtRelative(w.reviewedAt)}</>
                          : "Not reviewed yet"}
                      </div>
                    </div>
                    <div className="doc-ward-v3-pct-col">
                      <div className="doc-ward-v3-pct" style={{ color: c }}>{o.pct}%</div>
                      <div className="doc-ward-v3-pct-lbl">occupied</div>
                    </div>
                  </div>

                  <OccBar w={w} />

                  <div className="doc-ward-v3-stats">
                    {[
                      { lbl: "Vacant",   val: o.vn, color: "var(--st-v)"  },
                      { lbl: "Vac+Res",  val: o.vr, color: "var(--st-vr)" },
                      { lbl: "Occupied", val: o.on,  color: "var(--st-o)"  },
                      { lbl: "Occ+Res",  val: o.or,  color: "var(--st-or)" },
                    ].map(({ lbl, val, color }) => (
                      <div key={lbl} className="doc-ward-v3-stat">
                        <div className="doc-ward-v3-stat-v" style={{ color }}>{val}</div>
                        <div className="doc-ward-v3-stat-l">{lbl}</div>
                      </div>
                    ))}
                  </div>

                  <div className="doc-ward-v3-acts">
                    <button className="doc-ward-v3-act-p" disabled={w.operational === false} onClick={() => onOpenWard(w)}>
                      <Ic d={icons.bed} s={14} />
                      {w.operational === false ? "Non-operational" : "View / Update Beds"}
                    </button>
                    <button className="doc-ward-v3-act-s" disabled={reviewingWard === w.id} onClick={() => reviewWard(w.id)}>
                      <Ic d={icons.check} s={14} />
                      {reviewingWard === w.id ? "…" : "Review"}
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

// ── ActivityView ─────────────────────────────────────────────────────────────────
function ActivityView({ activity }) {
  if (!activity || activity.length === 0) return (
    <div className="slide-up">
      <div className="floor-head">Recent Activity</div>
      <div style={{ textAlign: "center", padding: "48px 20px", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 18, boxShadow: "var(--shadow)" }}>
        <Ic d={icons.clock} s={32} style={{ color: "var(--ink-3)" }} />
        <div style={{ marginTop: 12, fontWeight: 800, fontSize: 16 }}>No activity yet</div>
        <div className="dim" style={{ fontSize: 13, marginTop: 4 }}>Bed updates will appear here in real time.</div>
      </div>
    </div>
  );

  return (
    <div className="slide-up">
      <div className="floor-head">Recent Bed Updates</div>
      <div className="doc-act-v3">
        {activity.map(r => {
          const c  = bedStateColor(r.new_physical, r.new_reservation);
          const bg = bedStateBg(r.new_physical, r.new_reservation);
          return (
            <div key={r.id} className="doc-act-v3-card">
              <span className="doc-act-v3-dot" style={{ background: c }} />
              <div className="doc-act-v3-body">
                <div className="doc-act-v3-bed">{r.bed_name}</div>
                <div className="doc-act-v3-loc">{[r.ward_name, r.block_name].filter(Boolean).join(" · ") || "—"}</div>
                <div className="doc-act-v3-trans" style={{ marginTop: 6 }}>
                  <span className="doc-act-v3-from">{bedStateShort(r.old_physical, r.old_reservation)}</span>
                  <Ic d={icons.chevron} s={12} style={{ color: "var(--ink-3)" }} />
                  <span className="doc-act-v3-pill" style={{ background: bg, color: c }}>{bedStateShort(r.new_physical, r.new_reservation)}</span>
                </div>
              </div>
              <div className="doc-act-v3-right">
                <div className="doc-act-v3-time" title={fmtDateTime(r.created_at)}>{fmtRelative(r.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── NotifBell ────────────────────────────────────────────────────────────────────
function NotifBell({ activity, notifOpen, onToggle, onMarkSeen, lastSeen }) {
  const wrapRef = useRef(null);
  const unseen  = (activity || []).filter(r => !lastSeen || new Date(r.created_at) > lastSeen).length;
  const handleToggle = () => { if (!notifOpen) onMarkSeen(); onToggle(); };

  useEffect(() => {
    if (!notifOpen) return;
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) onToggle(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [notifOpen, onToggle]);

  return (
    <div ref={wrapRef} className="doc-notif-wrap">
      <button className="doc-notif-btn" onClick={handleToggle} title="Notifications" aria-label="Notifications" aria-haspopup="true" aria-expanded={notifOpen}>
        <Ic d={icons.bell} s={17} />
        {unseen > 0 && <span className="doc-notif-badge">{unseen > 9 ? "9+" : unseen}</span>}
      </button>
      {notifOpen && (
        <div className="doc-notif-drop">
          <div className="doc-notif-head">
            Notifications
            <span style={{ fontSize: 11, textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "var(--ink-3)" }}>{(activity || []).length} recent</span>
          </div>
          {(activity || []).length === 0 ? (
            <div className="doc-side-empty">No recent activity</div>
          ) : (
            (activity || []).slice(0, 8).map(r => {
              const c = bedStateColor(r.new_physical, r.new_reservation);
              return (
                <div key={r.id} className="doc-notif-item">
                  <span className="doc-notif-dot" style={{ background: c }} />
                  <div className="doc-notif-body">
                    <div className="doc-notif-bed">{r.bed_name} · {r.ward_name || "—"}</div>
                    <div className="doc-notif-sub">{bedStateShort(r.new_physical, r.new_reservation)} · {fmtRelative(r.created_at)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── StepTracker ──────────────────────────────────────────────────────────────────
function StepTracker({ current, total }) {
  return (
    <div className="doc-step-track">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="doc-step-item">
          <div className={"doc-step-circle " + (i < current - 1 ? "done" : i === current - 1 ? "active" : "future")}>
            {i < current - 1 ? <Ic d={icons.check} s={13} /> : i + 1}
          </div>
          {i < total - 1 && <div className={"doc-step-line" + (i < current - 1 ? " done" : "")} />}
        </div>
      ))}
    </div>
  );
}

// ── AddAdmissionModal ────────────────────────────────────────────────────────────
function AddAdmissionModal({ me, onClose, showToast }) {
  useModal(onClose);
  const [step,       setStep]       = useState(1);
  const [blockId,    setBlockId]    = useState(null);
  const [wardId,     setWardId]     = useState(null);
  const [bedId,      setBedId]      = useState(null);
  const [blockData,  setBlockData]  = useState(null);
  const [beds,       setBeds]       = useState([]);
  const [payerTypes, setPayerTypes] = useState([]);
  const [payer,      setPayer]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);

  const selBlock = me.blocks.find(b => b.id === blockId);
  const selWard  = blockData?.wards?.find(w => w.id === wardId);
  const selBed   = beds.find(b => b.id === bedId);

  useEffect(() => { api.doctorPayerTypes().then(r => setPayerTypes(r.payerTypes || [])).catch(() => {}); }, []);

  const pickBlock = async (id) => {
    setBlockId(id); setLoading(true);
    try { const d = await api.doctorBlock(id); setBlockData(d); setStep(2); }
    catch { showToast("Failed to load block."); }
    finally { setLoading(false); }
  };

  const pickWard = async (id) => {
    setWardId(id); setLoading(true);
    try { const r = await api.doctorBeds(id, { physical_status: "VACANT" }); setBeds(r.beds || []); setStep(3); }
    catch { showToast("Failed to load beds."); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!payer) return;
    setSaving(true);
    try { await api.doctorUpdateBedStatus(bedId, "OCCUPIED", "NONE", payer); showToast("Admission added ✓"); onClose(); }
    catch (e) { showToast(toastErr(e)); setSaving(false); }
  };

  const stepLabels = ["Select Block", "Select Ward", "Select Bed", "Set Payer Type"];

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 18 }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.01em" }}>Add Admission</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{stepLabels[step - 1]}</div>
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>
          <StepTracker current={step} total={4} />

          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {me.blocks.map(b => (
                <button key={b.id} className="doc-opt-card" onClick={() => pickBlock(b.id)} disabled={loading}>
                  <div className="doc-opt-icon"><Ic d={icons.stethoscope} s={20} /></div>
                  <div className="doc-opt-body">
                    <div className="doc-opt-name">{b.name}</div>
                    <div className="doc-opt-sub">{b.ward_count} ward{b.ward_count !== 1 ? "s" : ""} · {b.total_beds} beds</div>
                  </div>
                  <div className="doc-opt-arrow"><Ic d={icons.chevron} s={16} /></div>
                </button>
              ))}
            </div>
          )}

          {step === 2 && loading && (
            <div className="empty" style={{ padding: "48px 0" }}><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={24} /></span></div>
          )}
          {step === 2 && !loading && (
            <>
              <button className="doc-back" style={{ marginBottom: 12 }} onClick={() => setStep(1)}><Ic d={icons.chevron} s={14} style={{ transform: "rotate(180deg)" }} /> Back</button>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(blockData?.wards || []).map(w => {
                  const o = occOf(w); const noVacant = o.vn === 0;
                  return (
                    <button key={w.id} className="doc-opt-card" disabled={noVacant || loading} onClick={() => pickWard(w.id)}>
                      <div className="doc-opt-icon" style={{ background: noVacant ? "var(--panel-2)" : "rgba(34,197,94,.12)", color: noVacant ? "var(--ink-3)" : "var(--st-v)" }}>
                        <Ic d={icons.grid} s={20} />
                      </div>
                      <div className="doc-opt-body">
                        <div className="doc-opt-name">{w.name}</div>
                        <div className="doc-opt-sub" style={{ color: noVacant ? "var(--st-or)" : "var(--st-v)", fontWeight: 700 }}>
                          {noVacant ? "Full — no vacant beds" : `${o.vn} vacant of ${o.total}`}
                        </div>
                      </div>
                      {!noVacant && <div className="doc-opt-arrow"><Ic d={icons.chevron} s={16} /></div>}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 3 && loading && (
            <div className="empty" style={{ padding: "48px 0" }}><span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={24} /></span></div>
          )}
          {step === 3 && !loading && (
            <>
              <button className="doc-back" style={{ marginBottom: 12 }} onClick={() => setStep(2)}><Ic d={icons.chevron} s={14} style={{ transform: "rotate(180deg)" }} /> Back</button>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: "var(--ink-2)" }}>{selWard?.name} — tap a vacant bed</div>
              {beds.length === 0
                ? <div style={{ textAlign: "center", padding: 24, background: "var(--panel-2)", borderRadius: 14 }}>No vacant beds in this ward.</div>
                : <div className="bed-grid">{beds.map(bed => <BedCard key={bed.id} bed={bed} onClick={() => { setBedId(bed.id); setStep(4); }} />)}</div>}
            </>
          )}

          {step === 4 && (
            <>
              <button className="doc-back" style={{ marginBottom: 14 }} onClick={() => setStep(3)}><Ic d={icons.chevron} s={14} style={{ transform: "rotate(180deg)" }} /> Back</button>
              <div style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", marginBottom: 18 }}>
                {[["Block", selBlock?.name], ["Ward", selWard?.name], ["Bed", selBed?.bed_name]].map(([l, v]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)" }}>{l}</span>
                    <span style={{ fontSize: 12, fontWeight: 800 }}>{v || "—"}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: 20 }}>
                <div className="doc-field-lbl">Payer Type <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span></div>
                <select className="field" value={payer} onChange={e => setPayer(e.target.value)}
                  style={{ borderColor: !payer ? "var(--red)" : undefined }}>
                  <option value="">— Select payer type —</option>
                  {payerTypes.map(pt => <option key={pt.id} value={pt.name}>{pt.name}</option>)}
                </select>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 1.5 }} disabled={!payer || saving} onClick={handleSave}>
                  {saving ? "Saving…" : "Confirm Admission"}
                </button>
              </div>
            </>
          )}
          <div style={{ height: 8 }} />
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── FindBedModal ─────────────────────────────────────────────────────────────────
function FindBedModal({ me, onClose, onNavigateToWard }) {
  useModal(onClose);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled(me.blocks.map(b => api.doctorBlock(b.id))).then(results => {
      const d = {};
      results.forEach((r, i) => { if (r.status === "fulfilled") d[me.blocks[i].id] = r.value; });
      setData(d); setLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasAny = !loading && me.blocks.some(b => data?.[b.id]?.wards?.some(w => occOf(w).vn > 0));

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 18 }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.01em" }}>Find Vacant Bed</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>Tap a ward to view its beds</div>
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          {loading ? (
            <div className="empty" style={{ padding: "48px 0" }}>
              <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
              <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>Scanning all blocks…</div>
            </div>
          ) : !hasAny ? (
            <div style={{ textAlign: "center", padding: "40px 20px", background: "var(--panel-2)", borderRadius: 16, border: "1px solid var(--line)" }}>
              <Ic d={icons.bed} s={32} style={{ color: "var(--ink-3)" }} />
              <div style={{ marginTop: 12, fontWeight: 800, fontSize: 16 }}>No vacant beds found</div>
              <div className="dim" style={{ fontSize: 13, marginTop: 4 }}>All beds are currently occupied or reserved.</div>
            </div>
          ) : (
            me.blocks.map(b => {
              const vacantWards = (data?.[b.id]?.wards || []).filter(w => occOf(w).vn > 0);
              if (vacantWards.length === 0) return null;
              return (
                <div key={b.id} className="doc-find-v3-block">
                  <div className="doc-find-v3-blk-hdr">{b.name}</div>
                  {vacantWards.map(w => {
                    const o = occOf(w);
                    return (
                      <div key={w.id} className="doc-find-v3-row">
                        <div>
                          <div className="doc-find-v3-name">{w.name}</div>
                          <div className="doc-find-v3-cnt">{o.vn} vacant of {o.total}</div>
                        </div>
                        <button className="doc-find-v3-btn" onClick={() => { onNavigateToWard(w, b.id); onClose(); }}>View Beds</button>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
          <div style={{ height: 8 }} />
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── ReportsModal ─────────────────────────────────────────────────────────────────
function ReportsModal({ me, onClose }) {
  useModal(onClose);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled(me.blocks.map(b => api.doctorBlock(b.id))).then(results => {
      const d = {};
      results.forEach((r, i) => { if (r.status === "fulfilled") d[me.blocks[i].id] = r.value; });
      setData(d); setLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 18 }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.01em" }}>Block Reports</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>Current occupancy snapshot</div>
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          {loading ? (
            <div className="empty" style={{ padding: "48px 0" }}>
              <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
              <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>Loading reports…</div>
            </div>
          ) : (
            me.blocks.map(b => {
              const detail = data?.[b.id];
              if (!detail) return null;
              const totals = detail.wards.reduce((a, w) => {
                const o = occOf(w); return { total: a.total + o.total, occ: a.occ + o.occ, vacant: a.vacant + o.vn };
              }, { total: 0, occ: 0, vacant: 0 });
              const pct = totals.total > 0 ? Math.round((totals.occ / totals.total) * 100) : 0;
              const c   = pctColor(pct);
              const bg  = pctBg(pct);
              return (
                <div key={b.id} className="doc-rep-block">
                  <div className="doc-rep-block-hdr">
                    <div className="doc-rep-block-name">{b.name}</div>
                    <span style={{ background: bg, color: c, borderRadius: 99, padding: "4px 11px", fontSize: 12, fontWeight: 800 }}>{pct}% occupied</span>
                  </div>
                  <OccBar w={{ total: totals.total, occupied: totals.occ, occupied_reserved: 0, reserved: 0 }} />
                  <div className="doc-rep-tiles">
                    {[["Total Beds", totals.total, "var(--primary)"], ["Occupied", totals.occ, "var(--st-o)"], ["Vacant", totals.vacant, "var(--st-v)"]].map(([l, v, co]) => (
                      <div key={l} className="doc-rep-tile">
                        <div className="doc-rep-tile-v" style={{ color: co }}>{v}</div>
                        <div className="doc-rep-tile-l">{l}</div>
                      </div>
                    ))}
                  </div>
                  {detail.wards.map(w => {
                    const o = occOf(w);
                    return (
                      <div key={w.id} className="doc-rep-ward-row">
                        <span className="doc-rep-ward-name">{w.name}</span>
                        <span className="doc-rep-ward-meta">{o.occ}/{o.total}</span>
                        <span className="doc-rep-ward-pct" style={{ color: pctColor(o.pct) }}>{o.pct}%</span>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
          <div style={{ height: 8 }} />
        </div>
      </div>
    </div>,
    document.body
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════════
function Dashboard({ me, user, activity, onQuickAction }) {
  const s        = me.summary;
  const totalOcc = (s.occupied || 0) + (s.occupied_reserved || 0);
  const occPct   = s.total > 0 ? Math.round((totalOcc / s.total) * 100) : 0;
  const hour     = new Date().getHours();
  const greet    = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today    = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const kpis = [
    { val: s.total,                                         lbl: "Total Beds", icon: icons.bed,       color: "var(--primary)" },
    { val: `${occPct}%`,                                    lbl: "Occupied",   icon: icons.clipboard, color: "var(--st-o)"    },
    { val: s.vacant,                                        lbl: "Vacant",     icon: icons.check,     color: "var(--st-v)"    },
    { val: (s.reserved || 0) + (s.occupied_reserved || 0), lbl: "Reserved",   icon: icons.clock,     color: "var(--st-vr)"   },
  ];

  const quickActions = [
    { key: "add",     icon: icons.plus,   label: "Add Admission", desc: "Mark a bed occupied"  },
    { key: "find",    icon: icons.search, label: "Find Bed",      desc: "Locate vacant beds"   },
    { key: "blocks",  icon: icons.grid,   label: "Block Overview",desc: "View all your blocks" },
    { key: "reports", icon: icons.chart,  label: "Reports",       desc: "Occupancy snapshot"   },
  ];

  return (
    <div className="slide-up">
      <div className="doc-hero-card">
        <div className="doc-hero-left">
          <div className="doc-hero-greet">{greet}</div>
          <div className="doc-hero-name">{user.name || user.username || "Doctor"}</div>
          <div className="doc-hero-meta">
            {me.blocks.length} block{me.blocks.length !== 1 ? "s" : ""} &nbsp;·&nbsp;
            {me.wardCount} ward{me.wardCount !== 1 ? "s" : ""} &nbsp;·&nbsp;
            {s.total} beds
          </div>
        </div>
        <div className="doc-hero-right">
          <div className="doc-live-pill"><span className="doc-live-dot" />Live</div>
          <div className="doc-hero-date">{today}</div>
        </div>
      </div>

      <div className="doc-kpi-row">
        {kpis.map(({ val, lbl, icon, color }) => (
          <div key={lbl} className="doc-kpi">
            <div className="doc-kpi-icon" style={{ color }}><Ic d={icon} s={18} /></div>
            <div className="doc-kpi-val" style={{ color }}>{val}</div>
            <div className="doc-kpi-lbl">{lbl}</div>
          </div>
        ))}
      </div>

      <div className="floor-head" style={{ marginTop: 4 }}>Quick Actions</div>
      <div className="doc-qa-row">
        {quickActions.map(({ key, icon, label, desc }) => (
          <button key={key} className="doc-qa-card" onClick={() => onQuickAction(key)}>
            <div className="doc-qa-card-icon"><Ic d={icon} s={20} /></div>
            <div className="doc-qa-card-label">{label}</div>
            <div className="doc-qa-card-desc">{desc}</div>
          </button>
        ))}
      </div>

      <div className="floor-head" style={{ marginTop: 8 }}>Live Activity</div>
      {(activity || []).length === 0 ? (
        <div style={{ textAlign: "center", padding: "28px 20px", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "var(--shadow)" }}>
          <Ic d={icons.clock} s={26} style={{ color: "var(--ink-3)" }} />
          <div style={{ marginTop: 10, fontWeight: 700 }}>No activity yet</div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>Bed updates will appear here in real time.</div>
        </div>
      ) : (
        <div className="doc-act-feed">
          {(activity || []).slice(0, 8).map(r => {
            const c = bedStateColor(r.new_physical, r.new_reservation);
            return (
              <div key={r.id} className="doc-act-item">
                <span className="doc-act-dot" style={{ background: c }} />
                <div className="doc-act-main">
                  <span className="doc-act-bed">{r.bed_name}</span>
                  <span className="doc-act-ward">· {r.ward_name || "—"}</span>
                </div>
                <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, background: bedStateBg(r.new_physical, r.new_reservation), color: c, whiteSpace: "nowrap" }}>
                  {bedStateShort(r.new_physical, r.new_reservation)}
                </span>
                <div className="doc-act-time">{fmtRelative(r.created_at)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
//  MY BLOCKS
// ══════════════════════════════════════════════════════════════════════════════════
function BlocksView({ me, blockDetails, onOpenBlock }) {
  if (me.blocks.length === 0) return (
    <div className="slide-up" style={{ textAlign: "center", paddingTop: 60 }}>
      <Ic d={icons.stethoscope} s={36} style={{ color: "var(--ink-3)" }} />
      <div style={{ fontWeight: 800, fontSize: 17, marginTop: 14 }}>No Blocks Assigned</div>
      <div className="dim" style={{ fontSize: 13, marginTop: 5 }}>Contact your administrator for access.</div>
    </div>
  );

  return (
    <div className="slide-up">
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 900, fontSize: 20, letterSpacing: "-.01em" }}>My Blocks</div>
        <div className="dim" style={{ fontSize: 12.5, marginTop: 3 }}>{me.blocks.length} block{me.blocks.length !== 1 ? "s" : ""} assigned</div>
      </div>
      <div className="doc-blocks-list">
        {me.blocks.map((b, i) => {
          const det    = blockDetails?.[b.id];
          const totals = det ? det.wards.reduce((a, w) => { const o = occOf(w); return { total: a.total + o.total, occ: a.occ + o.occ }; }, { total: 0, occ: 0 }) : null;
          const pct  = totals?.total > 0 ? Math.round((totals.occ / totals.total) * 100) : null;
          const barW = totals ? { total: totals.total, occupied: totals.occ, occupied_reserved: 0, reserved: 0 } : null;
          const c    = pct !== null ? pctColor(pct) : "var(--ink-3)";
          return (
            <div key={b.id} className="doc-block-row slide-up" style={{ animationDelay: i * 0.04 + "s" }}
              role="button" tabIndex={0}
              onClick={() => onOpenBlock(b.id)}
              onKeyDown={e => (e.key === "Enter" || e.key === " ") && onOpenBlock(b.id)}>
              <div className="doc-block-row-left">
                <div className="doc-block-row-badge"><Ic d={icons.stethoscope} s={20} /></div>
                <div>
                  <div className="doc-block-row-name">{b.name}</div>
                  <div className="doc-block-row-meta">{b.ward_count} ward{b.ward_count !== 1 ? "s" : ""} · {b.total_beds} beds</div>
                </div>
              </div>
              <div className="doc-block-row-right">
                <div className="doc-block-row-pct" style={{ color: c }}>
                  {pct !== null ? `${pct}%` : <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-3)" }}>—</span>}
                </div>
                <div style={{ width: 80 }}>{barW ? <OccBar w={barW} /> : <div className="doc-bar" style={{ opacity: 0.2 }} />}</div>
              </div>
              <Ic d={icons.chevron} s={18} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
//  PROFILE
// ══════════════════════════════════════════════════════════════════════════════════
function ProfileView({ me, user, onLogout }) {
  const s   = me.summary;
  const occ = (s.occupied || 0) + (s.occupied_reserved || 0);
  const pct = s.total > 0 ? Math.round((occ / s.total) * 100) : 0;

  return (
    <div className="slide-up">
      <div className="doc-prof-hero">
        <div className="doc-prof-av">{initialsOf(user.name || user.username)}</div>
        <div className="doc-prof-info">
          <div className="doc-prof-name">{user.name || "—"}</div>
          <div className="doc-prof-user">@{user.username}</div>
          <div className="doc-prof-badge"><Ic d={icons.stethoscope} s={11} /> Doctor</div>
        </div>
      </div>

      <div className="doc-prof-kpis">
        {[{ val: me.blocks.length, lbl: "Blocks" }, { val: me.wardCount, lbl: "Wards" }, { val: s.total, lbl: "Beds" }].map(({ val, lbl }) => (
          <div key={lbl} className="doc-prof-kpi">
            <div className="doc-prof-kpi-val">{val}</div>
            <div className="doc-prof-kpi-lbl">{lbl}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 18, padding: 18, marginBottom: 14, boxShadow: "var(--shadow)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Current Occupancy</div>
          <span style={{ fontSize: 22, fontWeight: 900, color: pctColor(pct) }}>{pct}%</span>
        </div>
        <OccBar w={{ total: s.total, occupied: s.occupied || 0, occupied_reserved: s.occupied_reserved || 0, reserved: s.reserved || 0 }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, gap: 6 }}>
          {[["Occupied", occ, "var(--st-o)"], ["Vacant", s.vacant || 0, "var(--st-v)"], ["Reserved", (s.reserved || 0) + (s.occupied_reserved || 0), "var(--st-vr)"]].map(([l, v, c]) => (
            <div key={l} style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: c }}>{v}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".04em", marginTop: 3 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      <button className="btn btn-ghost btn-block" style={{ padding: "13px 0" }} onClick={onLogout}>
        <Ic d={icons.logout} s={16} /> Logout
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
//  DOCTOR APP ROOT
// ══════════════════════════════════════════════════════════════════════════════════
export default function DoctorApp({ user, onLogout }) {
  const [tab,           setTab]           = useState("dash");
  const [me,            setMe]            = useState(null);
  const [loadError,     setLoadError]     = useState(null);
  const [toast,         setToast]         = useState("");
  const [lastSync,      setLastSync]      = useState(null);
  const [blockId,       setBlockId]       = useState(null);
  const [ward,          setWard]          = useState(null);
  const [wardBeds,      setWardBeds]      = useState([]);
  const [bedsLoading,   setBedsLoading]   = useState(false);
  const [reloadKey,     setReloadKey]     = useState(0);
  const [activity,      setActivity]      = useState([]);
  const [blockDetails,  setBlockDetails]  = useState({});
  const [notifOpen,     setNotifOpen]     = useState(false);
  const [notifLastSeen, setNotifLastSeen] = useState(null);
  const [quickAction,   setQuickAction]   = useState(null);
  const loadRef = useRef(null);

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2400); }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [meData, actData] = await Promise.all([
        api.doctorMe(),
        api.doctorActivity().catch(() => ({ activity: [] })),
      ]);
      setMe(meData);
      setActivity(actData.activity || []);
      setLastSync(new Date());
      if (meData.blocks?.length) {
        Promise.allSettled(meData.blocks.map(b => api.doctorBlock(b.id))).then(results => {
          const d = {};
          results.forEach((r, i) => { if (r.status === "fulfilled") d[meData.blocks[i].id] = r.value; });
          setBlockDetails(d);
        });
      }
    } catch (e) {
      const msg = e?.message ?? "";
      if (msg === "Unauthorized") return;
      setLoadError(msg || "Unable to connect to server");
    }
  }, []);
  loadRef.current = load;

  const loadWardBeds = useCallback(async (wardId) => {
    setBedsLoading(true);
    try { const r = await api.doctorBeds(wardId); setWardBeds(r.beds || []); }
    catch (e) { showToast(toastErr(e)); }
    finally { setBedsLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const socket = createSocket();
    let timer = null;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        loadRef.current();
        setReloadKey(k => k + 1);
        setLastSync(new Date());
      }, 300);
    };
    socket.on("bed:update", onChange);
    socket.on("connect", onChange);
    return () => { clearTimeout(timer); socket.disconnect(); };
  }, []);

  useEffect(() => { if (ward) loadWardBeds(ward.id); }, [ward?.id, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (bedId, physical, reservation, payer, destination, reservationNote) => {
    const prev = wardBeds;
    const stillOccRes = physical === "OCCUPIED" && reservation === "RESERVED";
    const stillVacRes = physical === "VACANT"   && reservation === "RESERVED";
    setWardBeds(bs => bs.map(b => b.id !== bedId ? b : {
      ...b, physical_status: physical, reservation_status: reservation,
      payer_type: physical === "VACANT" ? null : (payer !== undefined ? payer : b.payer_type),
      destination: stillOccRes ? (destination !== undefined ? destination : b.destination) : null,
      reservation_note: stillVacRes ? (reservationNote !== undefined ? reservationNote : b.reservation_note) : null,
    }));
    try { await api.doctorUpdateBedStatus(bedId, physical, reservation, payer, destination, reservationNote); showToast("Saved ✓"); }
    catch (e) { setWardBeds(prev); showToast(toastErr(e)); throw e; }
  };

  const openBlock      = (id) => { setBlockId(id); setWard(null); };
  const backToBlocks   = ()   => { setBlockId(null); setWard(null); };
  const navigateToWard = (w, bId) => { setBlockId(bId); setWard(w); setTab("blocks"); };
  const handleQuickAction = (key) => {
    if (key === "blocks" && me.blocks.length === 1) { openBlock(me.blocks[0].id); return; }
    setQuickAction(key);
  };

  const menu = [
    { key: "dash",     icon: icons.home,        label: "Dashboard" },
    { key: "blocks",   icon: icons.stethoscope, label: "My Blocks" },
    { key: "activity", icon: icons.clock,       label: "Activity"  },
    { key: "profile",  icon: icons.user,        label: "Profile"   },
  ];

  if (me === null) return (
    <div className="empty" style={{ paddingTop: 120 }}>
      {loadError ? (
        <>
          <Ic d={icons.alert} s={32} style={{ color: "var(--red)" }} />
          <div style={{ fontWeight: 700, marginTop: 14, fontSize: 16 }}>Unable to connect</div>
          <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>Check your network and try again.</div>
          <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={load}><Ic d={icons.refresh} s={15} /> Retry</button>
        </>
      ) : (
        <>
          <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={28} /></span>
          <div className="dim" style={{ marginTop: 14, fontSize: 13 }}>Loading your workspace…</div>
        </>
      )}
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  );

  const title = ward ? ward.name : blockId ? "Block Details" : menu.find(m => m.key === tab)?.label || "Doctor";

  return (
    <AppShell
      menu={menu}
      active={tab}
      onSelect={k => { setTab(k); setBlockId(null); setWard(null); }}
      title={title}
      user={{ name: user.name || user.username || "Doctor", role: "DOCTOR" }}
      onLogout={onLogout}
      topExtra={<>
        <NotifBell
          activity={activity}
          notifOpen={notifOpen}
          onToggle={() => setNotifOpen(o => !o)}
          onMarkSeen={() => setNotifLastSeen(new Date())}
          lastSeen={notifLastSeen}
        />
        <button onClick={load} className="appbar-btn" title="Refresh"><Ic d={icons.refresh} s={17} /></button>
      </>}
    >
      {ward ? (
        <WardBedView ward={ward} beds={wardBeds} loading={bedsLoading} onBack={() => setWard(null)} onSave={handleSave} />
      ) : blockId ? (
        <BlockDetail blockId={blockId} reloadKey={reloadKey} onBack={backToBlocks} onOpenWard={setWard} showToast={showToast} />
      ) : tab === "activity" ? (
        <ActivityView activity={activity} />
      ) : tab === "profile" ? (
        <ProfileView me={me} user={user} onLogout={onLogout} />
      ) : tab === "blocks" ? (
        <BlocksView me={me} blockDetails={blockDetails} onOpenBlock={openBlock} />
      ) : (
        <Dashboard me={me} user={user} activity={activity} onQuickAction={handleQuickAction} />
      )}

      {lastSync && !ward && !blockId && (
        <div className="dim" style={{ fontSize: 11, textAlign: "center", marginTop: 22, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--st-v)", display: "inline-block" }} />
          Live sync · last updated {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </div>
      )}

      {quickAction === "add"     && <AddAdmissionModal me={me} onClose={() => setQuickAction(null)} showToast={showToast} />}
      {quickAction === "find"    && <FindBedModal me={me} onClose={() => setQuickAction(null)} onNavigateToWard={navigateToWard} />}
      {quickAction === "reports" && <ReportsModal me={me} onClose={() => setQuickAction(null)} />}
      {quickAction === "blocks"  && createPortal(
        <div className="overlay" onClick={() => setQuickAction(null)}>
          <div className="sheet" role="dialog" aria-modal="true" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="grab" />
            <div className="pad">
              <div className="row between" style={{ marginBottom: 18 }}>
                <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.01em" }}>Block Overview</div>
                <button className="chip" onClick={() => setQuickAction(null)}>Close</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {me.blocks.map(b => (
                  <button key={b.id} className="doc-opt-card" onClick={() => { openBlock(b.id); setQuickAction(null); }}>
                    <div className="doc-opt-icon"><Ic d={icons.stethoscope} s={20} /></div>
                    <div className="doc-opt-body">
                      <div className="doc-opt-name">{b.name}</div>
                      <div className="doc-opt-sub">{b.ward_count} wards · {b.total_beds} beds</div>
                    </div>
                    <div className="doc-opt-arrow"><Ic d={icons.chevron} s={16} /></div>
                  </button>
                ))}
              </div>
              <div style={{ height: 8 }} />
            </div>
          </div>
        </div>,
        document.body
      )}

      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </AppShell>
  );
}
