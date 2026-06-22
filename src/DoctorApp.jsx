import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { api, toastErr, createSocket, fmtRelative, fmtDateTime } from "./lib.js";
import { Ic, icons, useModal } from "./ui.jsx";
import { AppShell } from "./shell.jsx";
import { naturalSort, bedStateColor, bedStateBg, bedStateShort } from "./bedUtils.js";

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

// ── Bed tile ────────────────────────────────────────────────────────────────────
const BedCard = React.memo(function BedCard({ bed, onClick }) {
  const color = bedStateColor(bed.physical_status, bed.reservation_status);
  const bg    = bedStateBg(bed.physical_status, bed.reservation_status);
  const dimmed = bed.operational_status === false;
  return (
    <div
      className={"bed-tile" + (onClick ? " tap" : "")}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      style={{ borderColor: color, background: bg, opacity: dimmed ? 0.5 : 1, cursor: onClick ? undefined : "default" }}
    >
      <span className="bname">{bed.bed_name}</span>
      <span className="bstate" style={{ color }}>{bedStateShort(bed.physical_status, bed.reservation_status)}</span>
      {bed.physical_status === "OCCUPIED" && bed.payer_type && (
        <span style={{ fontSize: 9, fontWeight: 700, color: "var(--primary)", lineHeight: 1.1,
          maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {bed.payer_type}
        </span>
      )}
      {bed.reservation_status === "RESERVED" && bed.physical_status === "OCCUPIED" && bed.destination && (
        <span style={{ fontSize: 9, fontWeight: 700, color: "var(--st-or)", lineHeight: 1.1,
          maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          → {bed.destination}
        </span>
      )}
      {bed.reservation_status === "RESERVED" && bed.physical_status === "VACANT" && bed.reservation_note && (
        <span title={bed.reservation_note} style={{ fontSize: 9, fontWeight: 700, color: "var(--st-vr)", lineHeight: 1.1,
          maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          📝 {bed.reservation_note}
        </span>
      )}
    </div>
  );
});

// ── Bed status update dialog ────────────────────────────────────────────────────
function BedDetailSheet({ bed, onSave, onClose }) {
  useModal(onClose);
  const [physical,     setPhysical]     = useState(bed.physical_status);
  const [reservation,  setReservation]  = useState(bed.reservation_status);
  const [payer,        setPayer]        = useState(bed.payer_type || "");
  const [payerTypes,   setPayerTypes]   = useState([]);
  const [destination,  setDestination]  = useState(bed.destination || "");
  const [destinations, setDestinations] = useState([]);
  const [resNote,      setResNote]      = useState(bed.reservation_note || "");
  const [saving,       setSaving]       = useState(false);
  const [noteOpen,     setNoteOpen]     = useState(false);
  const color = bedStateColor(physical, reservation);

  useEffect(() => { api.doctorPayerTypes().then(r => setPayerTypes(r.payerTypes || [])).catch(() => {}); }, []);
  useEffect(() => { api.doctorDestinations().then(r => setDestinations(r.destinations || [])).catch(() => {}); }, []);

  const handleSetPhysical = (val) => { setPhysical(val); if (val === "VACANT") setPayer(""); };
  const needsPayer  = physical === "OCCUPIED";
  const payerLocked = physical === "OCCUPIED" && reservation === "RESERVED" && bed.physical_status === "OCCUPIED";

  // OCC+RES = patient temporarily away at a destination (OT, Scanning) — bed
  // held for them. Destination is required to enter/stay in this state.
  const needsDestination = physical === "OCCUPIED" && reservation === "RESERVED";

  // VAC+RES = bed held for an incoming patient. Note describing why is required.
  const needsResNote = physical === "VACANT" && reservation === "RESERVED";

  const handleSave = async () => {
    if (needsPayer && !payer && !payerLocked) return;
    if (needsDestination && !destination) return;
    if (needsResNote && !resNote.trim()) return;
    setSaving(true);
    const payerArg = physical === "VACANT" ? null : (payerLocked && payer === (bed.payer_type || "") ? undefined : payer || null);
    const destinationArg = needsDestination ? destination : undefined;
    const resNoteArg = needsResNote ? resNote : undefined;
    try { await onSave(bed.id, physical, reservation, payerArg, destinationArg, resNoteArg); onClose(); }
    catch { /* parent toasts + rolls back */ }
    finally { setSaving(false); }
  };

  const info = [
    ["Bed Type", bed.bed_type || "Census", "var(--ink)"],
    ["Operational", bed.operational_status !== false ? "Yes" : "No", bed.operational_status !== false ? "var(--st-v)" : "var(--st-or)"],
    ["Current", bedStateShort(physical, reservation), color],
  ];

  // Portal to <body>: the bed grid sits inside a `.slide-up` wrapper whose
  // transform would otherwise trap this position:fixed overlay inside the
  // content column (off-centre, scrim not covering the sidebar).
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          <div className="row between" style={{ marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{bed.bed_name}</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 1 }}>Update bed status</div>
            </div>
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          <div className="doc-info-strip">
            {info.map(([label, val, c]) => (
              <div key={label} className="doc-info-cell">
                <div className="doc-info-l">{label}</div>
                <div className="doc-info-v" style={{ color: c }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Read-only callouts — always reflect what's actually saved on the bed
              right now, regardless of which toggle is currently selected below. */}
          {bed.physical_status === "OCCUPIED" && bed.reservation_status === "RESERVED" && bed.destination && (
            <div style={{
              background: "var(--st-or-bg, rgba(255,59,138,.1))", border: "1px solid var(--st-or)",
              borderRadius: 10, padding: "10px 12px", marginBottom: 16,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--st-or)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
                Sent to
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", wordBreak: "break-word", overflowWrap: "anywhere" }}>{bed.destination}</div>
            </div>
          )}
          {bed.physical_status === "VACANT" && bed.reservation_status === "RESERVED" && bed.reservation_note && (
            <div onClick={() => setNoteOpen(o => !o)} role="button" tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setNoteOpen(o => !o)}
              style={{
                background: "var(--st-vr-bg, rgba(124,58,237,.1))", border: "1px solid var(--st-vr)",
                borderRadius: 10, padding: "10px 12px", marginBottom: 16, cursor: "pointer",
              }}>
              <div className="row between" style={{ alignItems: "baseline" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--st-vr)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
                  Reservation Note
                </div>
                <span className="dim" style={{ fontSize: 10, flexShrink: 0 }}>{noteOpen ? "tap to collapse" : "tap to view full"}</span>
              </div>
              <div style={{
                fontSize: 13, fontWeight: 600, color: "var(--ink)",
                wordBreak: "break-word", overflowWrap: "anywhere",
                display: noteOpen ? "block" : "-webkit-box",
                WebkitLineClamp: noteOpen ? "unset" : 2,
                WebkitBoxOrient: "vertical",
                overflow: noteOpen ? "visible" : "hidden",
              }}>{bed.reservation_note}</div>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <div className="doc-field-lbl">Physical Status</div>
            <div className="doc-toggle">
              {[["VACANT", "var(--st-v)", "Vacant"], ["OCCUPIED", "var(--st-o)", "Occupied"]].map(([val, c, lbl]) => (
                <button key={val} onClick={() => handleSetPhysical(val)} className="doc-toggle-btn"
                  style={{ borderColor: physical === val ? c : "var(--line)", background: physical === val ? c : "transparent", color: physical === val ? "#fff" : "var(--ink-2)" }}>{lbl}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: physical === "OCCUPIED" ? 16 : 22 }}>
            <div className="doc-field-lbl">Reservation Status</div>
            <div className="doc-toggle">
              {[["NONE", "var(--ink-2)", "None"], ["RESERVED", "var(--st-vr)", "Reserved"]].map(([val, c, lbl]) => (
                <button key={val} onClick={() => setReservation(val)} className="doc-toggle-btn"
                  style={{ borderColor: reservation === val ? c : "var(--line)", background: reservation === val ? c : "transparent", color: reservation === val ? "#fff" : "var(--ink-2)" }}>{lbl}</button>
              ))}
            </div>
          </div>

          {physical === "OCCUPIED" && (
            <div style={{ marginBottom: 22 }}>
              <div className="doc-field-lbl">Payer Type {!payerLocked && <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>}</div>
              <select className="field" value={payer} onChange={(e) => setPayer(e.target.value)}
                style={{ borderColor: needsPayer && !payer && !payerLocked ? "var(--red)" : undefined }}>
                <option value="">{payerLocked ? `— Keep current (${bed.payer_type || "—"}) —` : "— Select payer type —"}</option>
                {payerTypes.map(pt => <option key={pt.id} value={pt.name}>{pt.name}</option>)}
              </select>
              {needsPayer && !payer && !payerLocked && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Payer type is required for occupied beds.</div>
              )}
            </div>
          )}

          {needsDestination && (
            <div style={{ marginBottom: 22 }}>
              <div className="doc-field-lbl">Current Location <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span></div>
              <select className="field" value={destination} onChange={(e) => setDestination(e.target.value)}
                style={{ borderColor: !destination ? "var(--red)" : undefined }}>
                <option value="">— Choose Location —</option>
                {destinations.map(dt => <option key={dt.id} value={dt.name}>{dt.name}</option>)}
              </select>
              {!destination && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Current location is required for Occupied + Reserved beds.</div>
              )}
            </div>
          )}

          {needsResNote && (
            <div style={{ marginBottom: 22 }}>
              <div className="doc-field-lbl">Note <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span></div>
              <textarea className="field" value={resNote} maxLength={255} rows={2}
                placeholder="e.g. Reserved for incoming transfer from ICU"
                onChange={(e) => setResNote(e.target.value)}
                style={{ resize: "vertical", fontSize: 13, fontFamily: "inherit", wordBreak: "break-word", overflowWrap: "anywhere", borderColor: !resNote.trim() ? "var(--red)" : undefined }} />
              {!resNote.trim() && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>A note is required for Vacant + Reserved beds.</div>
              )}
            </div>
          )}

          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 1.5 }} disabled={saving || (needsPayer && !payer && !payerLocked) || (needsDestination && !destination) || (needsResNote && !resNote.trim())} onClick={handleSave}>
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

// ── Ward bed view ────────────────────────────────────────────────────────────────
const BED_LEGEND = [
  ["Vacant", "var(--st-v)"], ["Vac+Res", "var(--st-vr)"], ["Occupied", "var(--st-o)"], ["Occ+Res", "var(--st-or)"],
];
function WardBedView({ ward, beds, loading, onBack, onSave }) {
  const [filter,     setFilter]     = useState("ALL");
  const [editingBed, setEditingBed] = useState(null);

  const sorted = useMemo(() => [...beds].sort((a, b) => naturalSort(a.bed_name, b.bed_name)), [beds]);
  // Live occupancy derived from the current bed list (stays correct after edits).
  const live = useMemo(() => {
    const c = { total: sorted.length, vacant: 0, reserved: 0, occupied: 0, occupied_reserved: 0 };
    for (const b of sorted) {
      const o = b.physical_status === "OCCUPIED", r = b.reservation_status === "RESERVED";
      if (o && r) c.occupied_reserved++; else if (o) c.occupied++; else if (r) c.reserved++; else c.vacant++;
    }
    return c;
  }, [sorted]);
  const fc = { ALL: sorted.length, Vacant: 0, Occupied: 0, Reserved: 0 };
  for (const b of sorted) {
    if (b.physical_status === "VACANT") fc.Vacant++; else fc.Occupied++;
    if (b.reservation_status === "RESERVED") fc.Reserved++;
  }
  const displayed = sorted.filter((b) =>
    filter === "Vacant"   ? b.physical_status === "VACANT" :
    filter === "Occupied" ? b.physical_status === "OCCUPIED" :
    filter === "Reserved" ? b.reservation_status === "RESERVED" : true);
  const FILTERS = [["ALL", "All"], ["Vacant", "Vacant"], ["Occupied", "Occupied"], ["Reserved", "Reserved"]];

  return (
    <div className="slide-up">
      <button className="doc-back" onClick={onBack}>
        <Ic d={icons.chevron} s={15} style={{ transform: "rotate(180deg)" }} /> Back
      </button>
      <div className="row between" style={{ alignItems: "flex-end", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 19, letterSpacing: "-.01em" }}>{ward.name}</div>
          <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{sorted.length} beds · {fc.Vacant} vacant · {fc.Occupied} occupied</div>
        </div>
      </div>
      <OccBar w={live} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, margin: "16px 0 14px" }}>
        {FILTERS.map(([key, label]) => (
          <button key={key} className={"fchip" + (filter === key ? " on" : "")} onClick={() => setFilter(key)}>
            {label}{fc[key] > 0 ? ` ${fc[key]}` : ""}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="dim" style={{ textAlign: "center", padding: "32px 0" }}>
          <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={22} /></span>
        </div>
      ) : displayed.length === 0 ? (
        <div className="card empty"><Ic d={icons.bed} s={26} /><div style={{ marginTop: 8, fontWeight: 600 }}>No beds match this filter.</div></div>
      ) : (
        <div className="bed-grid">
          {displayed.map((bed) => (
            <BedCard key={bed.id} bed={bed} onClick={bed.operational_status !== false ? () => setEditingBed(bed) : undefined} />
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 14, marginTop: 16, flexWrap: "wrap" }}>
        {BED_LEGEND.map(([lbl, c]) => (
          <span key={lbl} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-2)", fontWeight: 600 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: c }} />{lbl}
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

  const [reviewingWard, setReviewingWard] = useState(null);

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

  const reviewWard = async (wardId) => {
    setReviewingWard(wardId);
    try {
      const r = await api.doctorReviewWard(wardId);
      setData((d) => d ? { ...d, wards: d.wards.map((w) => w.id === wardId ? { ...w, reviewedAt: r.reviewedAt } : w) } : d);
      showToast("Ward marked reviewed ✓");
    } catch (e) { showToast(toastErr(e)); }
    finally { setReviewingWard(null); }
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
      <button className="doc-back" onClick={onBack}>
        <Ic d={icons.chevron} s={15} style={{ transform: "rotate(180deg)" }} /> All blocks
      </button>

      <div className="doc-review-bar">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: "-.02em" }}>{data.name}</div>
          <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
            {data.wards.length} wards · {totals.total} beds · {blockPct}% occupied
            {data.reviewedAt ? <> · reviewed {fmtRelative(data.reviewedAt)}</> : ""}
          </div>
        </div>
        <button className="btn btn-primary" style={{ padding: "10px 16px", fontSize: 13, whiteSpace: "nowrap" }} disabled={reviewing || data.wards.length === 0} onClick={review}>
          <Ic d={icons.check} s={15} /> {reviewing ? "Saving…" : "Mark Reviewed"}
        </button>
      </div>

      {data.description && <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>{data.description}</div>}

      {data.doctors.length > 0 && (
        <div className="doc-chips">
          {data.doctors.map((d) => (
            <span key={d.id} className="doc-chip"><span className="doc-chip-av">{initialsOf(d.name)}</span>{d.name}</span>
          ))}
        </div>
      )}

      {data.wards.length === 0 ? (
        <div className="card empty"><Ic d={icons.grid} s={28} /><div style={{ marginTop: 8, fontWeight: 600 }}>No wards assigned</div></div>
      ) : (
        <>
          <div className="floor-head">Wards</div>
          <div className="card-grid">
            {data.wards.map((w, i) => {
              const o = occOf(w);
              return (
                <div key={w.id} className="doc-ward slide-up" style={{ animationDelay: i * 0.03 + "s" }}>
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
                    <button className="btn btn-primary" style={{ flex: 1, padding: "10px 0", fontSize: 13 }} disabled={w.operational === false} onClick={() => onOpenWard(w)}>
                      <Ic d={icons.bed} s={14} /> {w.operational === false ? "Non-operational" : "View / Update Beds"}
                    </button>
                    <button className="btn btn-ghost" style={{ padding: "10px 12px", fontSize: 13, whiteSpace: "nowrap" }}
                      disabled={reviewingWard === w.id} onClick={() => reviewWard(w.id)} title="Mark this ward reviewed">
                      <Ic d={icons.check} s={14} /> {reviewingWard === w.id ? "…" : "Review"}
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
  const [wardBeds,    setWardBeds]    = useState([]);
  const [bedsLoading, setBedsLoading] = useState(false);
  const [reloadKey,   setReloadKey]   = useState(0);
  const loadRef = useRef(null);

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2400); }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try { const data = await api.doctorMe(); setMe(data); setLastSync(new Date()); }
    catch (e) { const msg = e?.message ?? ""; if (msg === "Unauthorized") return; setLoadError(msg || "Unable to connect to server"); }
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
    const onChange = () => { loadRef.current(); setReloadKey((k) => k + 1); setLastSync(new Date()); };
    socket.on("bed:update", onChange);
    socket.on("connect", onChange);
    return () => { socket.disconnect(); };
  }, []);

  useEffect(() => { if (ward) loadWardBeds(ward.id); /* eslint-disable-next-line */ }, [ward?.id, reloadKey]);

  const handleSave = async (bedId, physical, reservation, payer, destination, reservationNote) => {
    const prev = wardBeds;
    const stillOccRes = physical === "OCCUPIED" && reservation === "RESERVED";
    const stillVacRes = physical === "VACANT" && reservation === "RESERVED";
    setWardBeds((bs) => bs.map((b) => b.id !== bedId ? b : {
      ...b, physical_status: physical, reservation_status: reservation,
      payer_type: physical === "VACANT" ? null : (payer !== undefined ? payer : b.payer_type),
      destination: stillOccRes ? (destination !== undefined ? destination : b.destination) : null,
      reservation_note: stillVacRes ? (reservationNote !== undefined ? reservationNote : b.reservation_note) : null,
    }));
    try { await api.doctorUpdateBedStatus(bedId, physical, reservation, payer, destination, reservationNote); showToast("Saved ✓"); }
    catch (e) { setWardBeds(prev); showToast(toastErr(e)); throw e; }
  };

  const openBlock = (id) => { setBlockId(id); setWard(null); };
  const backToBlocks = () => { setBlockId(null); setWard(null); };

  const menu = [
    { key: "dash",     icon: icons.home,        label: "Dashboard" },
    { key: "blocks",   icon: icons.grid,        label: "My Blocks" },
    { key: "activity", icon: icons.clock,       label: "Activity" },
    { key: "profile",  icon: icons.user,        label: "Profile" },
  ];

  if (me === null) return (
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
  );

  const title = ward ? ward.name : blockId ? "Block Details" : menu.find((m) => m.key === tab)?.label || "Doctor";

  return (
    <AppShell
      menu={menu}
      active={tab}
      onSelect={(k) => { setTab(k); setBlockId(null); setWard(null); }}
      title={title}
      user={{ name: user.name || user.username || "Doctor", role: "DOCTOR" }}
      onLogout={onLogout}
      topExtra={<button onClick={load} className="appbar-btn" title="Refresh"><Ic d={icons.refresh} s={17} /></button>}
    >
      {ward ? (
        <WardBedView ward={ward} beds={wardBeds} loading={bedsLoading} onBack={() => setWard(null)} onSave={handleSave} />
      ) : blockId ? (
        <BlockDetail blockId={blockId} reloadKey={reloadKey} onBack={backToBlocks} onOpenWard={setWard} showToast={showToast} />
      ) : tab === "activity" ? (
        <ActivityView />
      ) : tab === "profile" ? (
        <div className="slide-up">
          <div className="card" style={{ padding: 22, maxWidth: 440 }}>
            <div className="row" style={{ gap: 14, marginBottom: 18 }}>
              <div className="doc-profile-av">{initialsOf(user.name || user.username)}</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-.01em" }}>{user.name || "—"}</div>
                <div className="dim" style={{ fontSize: 13 }}>@{user.username}</div>
                <span className="tag v" style={{ marginTop: 6 }}><Ic d={icons.stethoscope} s={12} /> Doctor</span>
              </div>
            </div>
            {[["Assigned blocks", me.blocks.length], ["Assigned wards", me.wardCount], ["Total beds", me.summary.total]].map(([l, v]) => (
              <div key={l} className="row between" style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                <span className="dim" style={{ fontSize: 13 }}>{l}</span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{v}</span>
              </div>
            ))}
            <button className="btn btn-ghost btn-block" style={{ marginTop: 18 }} onClick={onLogout}>
              <Ic d={icons.logout} s={15} /> Logout
            </button>
          </div>
        </div>
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
    </AppShell>
  );
}
