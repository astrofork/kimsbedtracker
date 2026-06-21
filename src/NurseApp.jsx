import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { api, toastErr, createSocket } from "./lib.js";
import { Ic, icons, useModal } from "./ui.jsx";
import { AppShell } from "./shell.jsx";
import { naturalSort, bedStateColor, bedStateBg, bedStateShort, calculateWardTotals } from "./bedUtils.js";

// ── Bed tile — name + status label, status-tinted ─────────────────────────────
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

// ── Bed status dialog — centered popup ────────────────────────────────────────
function BedDetailSheet({ bed, onSave, onClose }) {
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

  useEffect(() => {
    api.nursePayerTypes().then(r => setPayerTypes(r.payerTypes || [])).catch(() => {});
    api.nurseDestinations().then(r => setDestinations(r.destinations || [])).catch(() => {});
  }, []);

  // When switching to VACANT clear the payer selection
  const handleSetPhysical = (val) => {
    setPhysical(val);
    if (val === "VACANT") setPayer("");
  };

  const needsPayer = physical === "OCCUPIED";
  // If bed was already occupied+reserved (patient in OT), payer was set on admission
  const payerLocked = physical === "OCCUPIED" && reservation === "RESERVED" && bed.physical_status === "OCCUPIED";

  // OCC+RES = patient temporarily away at a destination (OT, Scanning) — bed
  // held for them. Destination is required to enter/stay in this state.
  const needsDestination = physical === "OCCUPIED" && reservation === "RESERVED";

  // VAC+RES = bed held for an incoming patient (transfer, scheduled admission).
  // Note describing why is required.
  const needsResNote = physical === "VACANT" && reservation === "RESERVED";
  const showResNote = needsResNote;

  const handleSave = async () => {
    if (needsPayer && !payer && !payerLocked) return;
    if (needsDestination && !destination) return;
    if (needsResNote && !resNote.trim()) return;
    setSaving(true);
    // pass payer as null when vacating so backend clears it; undefined when locked (no change)
    const payerArg = physical === "VACANT" ? null : (payerLocked && payer === (bed.payer_type || "") ? undefined : payer || null);
    const destinationArg = needsDestination ? destination : undefined;
    const resNoteArg = showResNote ? resNote : undefined;
    try {
      await onSave(bed.id, physical, reservation, payerArg, destinationArg, resNoteArg);
      onClose();
    } catch { /* parent shows toast */ }
    finally { setSaving(false); }
  };

  const infoCols = [
    ["Bed Type",    bed.bed_type || "Census"],
    ...(bed.unit_type ? [["Unit", bed.unit_type]] : []),
    ["Operational", bed.operational_status !== false ? "Yes" : "No"],
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1200, padding: 20,
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

          {/* Physical status */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
              Physical Status
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["VACANT", "var(--st-v)", "Vacant"], ["OCCUPIED", "var(--st-o)", "Occupied"]].map(([val, c, lbl]) => (
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

          {/* Physical status button uses handleSetPhysical */}

          {/* Reservation status */}
          <div style={{ marginBottom: physical === "OCCUPIED" ? 16 : 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
              Reservation Status
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["NONE", "var(--ink-2)", "None"], ["RESERVED", "var(--st-vr)", "Reserved"]].map(([val, c, lbl]) => (
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

          {/* Payer type — shown only when OCCUPIED */}
          {physical === "OCCUPIED" && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
                Payer Type {!payerLocked && <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>}
              </div>
              {payerLocked ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: "var(--primary)" }}>{payer || "—"}</span>
                  <span className="dim" style={{ fontSize: 11 }}>(same patient — tap to change)</span>
                  <select className="field" value={payer} style={{ flex: 1, fontSize: 13 }}
                    onChange={(e) => setPayer(e.target.value)}>
                    <option value="">— Keep current —</option>
                    {payerTypes.map(pt => <option key={pt.id} value={pt.name}>{pt.name}</option>)}
                  </select>
                </div>
              ) : (
                <select className="field" value={payer}
                  onChange={(e) => setPayer(e.target.value)}
                  style={{ fontSize: 14, borderColor: needsPayer && !payer ? "var(--red)" : undefined }}>
                  <option value="">— Select payer type —</option>
                  {payerTypes.map(pt => <option key={pt.id} value={pt.name}>{pt.name}</option>)}
                </select>
              )}
              {needsPayer && !payer && !payerLocked && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Payer type is required for occupied beds.</div>
              )}
            </div>
          )}

          {/* Destination — shown only for Occupied + Reserved (patient sent to OT/Scanning etc.) */}
          {needsDestination && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
                Destination <span style={{ color: "var(--red)", fontWeight: 900 }}>*</span>
              </div>
              <select className="field" value={destination}
                onChange={(e) => setDestination(e.target.value)}
                style={{ fontSize: 14, borderColor: !destination ? "var(--red)" : undefined }}>
                <option value="">— Where is the patient going? —</option>
                {destinations.map(dt => <option key={dt.id} value={dt.name}>{dt.name}</option>)}
              </select>
              {!destination && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>Destination is required for Occupied + Reserved beds.</div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" style={{ padding: "10px 18px" }} onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" style={{ padding: "10px 18px" }}
              disabled={saving || (needsPayer && !payer && !payerLocked) || (needsDestination && !destination) || (needsResNote && !resNote.trim())}
              onClick={handleSave}>
              {saving ? "Saving…" : "Update Status"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Bed manage modal — full bed grid for one ward ──────────────────────────────
function NurseBedModal({ ward, onSave, onClose }) {
  useModal(onClose);
  const [filter,     setFilter]     = useState("ALL");
  const [editingBed, setEditingBed] = useState(null);
  const [beds,       setBeds]       = useState([]);
  const [bedsLoading, setBedsLoading] = useState(true);

  // Fetch fresh beds on open (avoids stale data from previous opens)
  useEffect(() => {
    setBedsLoading(true);
    api.nurseBeds(ward.id)
      .then(r => setBeds(r.beds || []))
      .catch(() => {})
      .finally(() => setBedsLoading(false));
  }, [ward.id]);

  const sorted = useMemo(() =>
    [...beds]
      .sort((a, b) => naturalSort(a.bed_name, b.bed_name))
      .map(b => ({ ...b, unit_type: ward.unit_type || null })),
    [beds, ward.unit_type]
  );

  const displayed = sorted.filter((b) => {
    if (filter === "KIMS")     return b.unit_type === "KIMS";
    if (filter === "Renova")   return b.unit_type?.includes("Renova");
    if (filter === "Op")       return !!b.operational_status;
    if (filter === "Non-Op")   return !b.operational_status;
    if (filter === "Vacant")   return b.physical_status === "VACANT";
    if (filter === "Occupied") return b.physical_status === "OCCUPIED";
    if (filter === "Reserved") return b.reservation_status === "RESERVED";
    return true;
  });

  const fc = { ALL: sorted.length, KIMS: 0, Renova: 0, Op: 0, "Non-Op": 0, Vacant: 0, Occupied: 0, Reserved: 0 };
  for (const b of sorted) {
    if (b.unit_type?.includes("Renova")) fc["Renova"]++;
    else if (b.unit_type === "KIMS") fc["KIMS"]++;
    if (b.operational_status !== false) fc["Op"]++; else fc["Non-Op"]++;
    if (b.physical_status === "VACANT") fc["Vacant"]++; else fc["Occupied"]++;
    if (b.reservation_status === "RESERVED") fc["Reserved"]++;
  }

  const handleSave = async (bedId, physical, reservation, payer, destination, reservationNote) => {
    await onSave(bedId, physical, reservation, payer, destination, reservationNote);
    const stillOccRes = physical === "OCCUPIED" && reservation === "RESERVED";
    const stillVacRes = physical === "VACANT" && reservation === "RESERVED";
    setBeds(prev => prev.map(b =>
      b.id !== bedId ? b : {
        ...b, physical_status: physical, reservation_status: reservation,
        payer_type: physical === "VACANT" ? null : (payer !== undefined ? payer : b.payer_type),
        destination: stillOccRes ? (destination !== undefined ? destination : b.destination) : null,
        reservation_note: stillVacRes ? (reservationNote !== undefined ? reservationNote : b.reservation_note) : null,
      }
    ));
  };

  const FILTERS = [
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
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="pad">
          {/* Header */}
          <div className="row between" style={{ marginBottom: 4 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{ward.name}</div>
              <div className="dim" style={{ fontSize: 12 }}>
                {sorted.length} beds · {fc.Vacant} vacant · {fc.Occupied} occupied
              </div>
            </div>
            <button className="chip" onClick={onClose}>✕ Close</button>
          </div>

          {/* Filter chips — compact, wrap automatically */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10, marginBottom: 14 }}>
            {FILTERS.map(({ key, label }) => (
              <button key={key} className={"fchip" + (filter === key ? " on" : "")} onClick={() => setFilter(key)}>
                {label}{fc[key] > 0 ? ` (${fc[key]})` : ""}
              </button>
            ))}
          </div>

          {/* Bed grid */}
          {bedsLoading ? (
            <div className="dim" style={{ textAlign: "center", padding: "24px 0", fontSize: 13 }}>
              <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={20} /></span>
            </div>
          ) : displayed.length === 0 ? (
            <div className="dim" style={{ textAlign: "center", padding: "24px 0", fontSize: 13 }}>
              No beds match this filter.
            </div>
          ) : (
            <div className="bed-grid">
              {displayed.map((bed) => (
                <BedCard key={bed.id} bed={bed}
                  onClick={bed.operational_status !== false ? () => setEditingBed(bed) : undefined} />
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
          <div style={{ height: 16 }} />
        </div>
      </div>

      {editingBed && (
        <BedDetailSheet
          bed={editingBed}
          onSave={handleSave}
          onClose={() => setEditingBed(null)}
        />
      )}
    </div>
  );
}

// ── Ward summary card ──────────────────────────────────────────────────────────
function WardCard({ ward, index, onManage }) {
  const counts = { vn: ward.vacant ?? 0, vr: ward.reserved ?? 0, on: ward.occupied ?? 0 };
  const total  = ward.total_beds ?? 0;
  const allVacant = counts.vn === total && total > 0;

  // Ward is non-operational — show warning, block manage
  if (ward.operational === false) {
    return (
      <div className="ward-card slide-up" style={{
        animationDelay: index * 0.03 + "s",
        padding: 16, display: "flex", flexDirection: "column",
        opacity: 0.75,
      }}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <div>
            {(ward.block_name || ward.floor_name) && (
              <div className="dim" style={{ fontSize: 11, marginBottom: 2 }}>
                {[ward.block_name, ward.floor_name].filter(Boolean).join(" · ")}
              </div>
            )}
            <div style={{ fontWeight: 700, fontSize: 15 }}>{ward.name}</div>
            <div className="dim" style={{ fontSize: 12 }}>{ward.total_beds ?? 0} beds</div>
          </div>
          <span className="tag" style={{ background: "var(--warn-bg, #fff3cd)", color: "var(--warn, #b45309)" }}>
            <Ic d={icons.alert} s={12} /> Non-op
          </span>
        </div>
        <div style={{
          background: "var(--panel-2)", borderRadius: 10, padding: "14px 16px",
          display: "flex", alignItems: "flex-start", gap: 10,
        }}>
          <Ic d={icons.alert} s={16} style={{ color: "var(--warn, #b45309)", flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--warn, #b45309)" }}>Ward non-operational</div>
            <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>
              This ward has been marked non-operational by the manager. Beds cannot be updated.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // No beds assigned to this nurse for this ward — show warning, block manage
  if (ward.beds_warning) {
    return (
      <div className="ward-card slide-up" style={{
        animationDelay: index * 0.03 + "s",
        padding: 16,
        display: "flex", flexDirection: "column",
      }}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <div>
            {(ward.block_name || ward.floor_name) && (
              <div className="dim" style={{ fontSize: 11, marginBottom: 2 }}>
                {[ward.block_name, ward.floor_name].filter(Boolean).join(" · ")}
              </div>
            )}
            <div style={{ fontWeight: 700, fontSize: 15 }}>{ward.name}</div>
            <div className="dim" style={{ fontSize: 12 }}>{total} beds</div>
          </div>
          <span className="tag" style={{ background: "var(--warn-bg, #fff3cd)", color: "var(--warn, #b45309)" }}>
            <Ic d={icons.alert} s={12} /> No access
          </span>
        </div>
        <div style={{
          background: "var(--panel-2)", borderRadius: 10, padding: "14px 16px",
          display: "flex", alignItems: "flex-start", gap: 10,
        }}>
          <Ic d={icons.alert} s={16} style={{ color: "var(--warn, #b45309)", flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--warn, #b45309)" }}>No beds assigned</div>
            <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>
              Contact your manager to assign beds to your account for this ward.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ward-card slide-up" style={{
      animationDelay: index * 0.03 + "s",
      padding: 16,
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          {(ward.block_name || ward.floor_name) && (
            <div className="dim" style={{ fontSize: 11, marginBottom: 2 }}>
              {[ward.block_name, ward.floor_name].filter(Boolean).join(" · ")}
            </div>
          )}
          <div style={{ fontWeight: 700, fontSize: 15 }}>{ward.name}</div>
          <div className="dim" style={{ fontSize: 12 }}>
            {total} beds
            {allVacant
              ? <span style={{ color: "var(--st-v)" }}> · all vacant</span>
              : <span style={{ color: "var(--primary)" }}> · complete</span>}
          </div>
        </div>
        <span className="tag v"><Ic d={icons.check} s={12} /> ok</span>
      </div>

      {/* Stats block */}
      <div style={{
        display: "flex", background: "var(--panel-2)",
        borderRadius: 10, overflow: "hidden", marginBottom: 14,
      }}>
        {[
          { label: "Vacant",   val: counts.vn, color: "var(--st-v)"  },
          { label: "Vac+Res",  val: counts.vr, color: "var(--st-vr)" },
          { label: "Occupied", val: counts.on, color: "var(--st-o)"  },
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

      {/* Action buttons */}
      <div className="row" style={{ gap: 8, marginTop: "auto" }}>
        <button className="btn btn-primary" style={{ flex: 1, padding: "9px 0", fontSize: 13 }}
          onClick={() => onManage(ward)}>
          <Ic d={icons.bed} s={13} /> Manage Beds
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  NURSE APP
// ══════════════════════════════════════════════════════════════════════════════
export default function NurseApp({ user, onLogout }) {
  const [wards,       setWards]       = useState(null);
  const [loadError,   setLoadError]   = useState(null); // null | string — real network errors only
  const [configError, setConfigError] = useState(null); // null | string — account config issues
  const [modalWardId, setModalWardId] = useState(null);
  const [stationName, setStationName] = useState(user.nursing_station || "");
  const [stations,    setStations]    = useState([]); // [{id, name}] — every station this nurse covers
  const [toast,       setToast]       = useState("");
  const [lastSync,    setLastSync]    = useState(null);
  // Ref so the socket event handler always calls the latest load without recreating the socket
  const loadRef = useRef(null);

  // Derived: always the current ward object from live wards state
  const modalWard = modalWardId !== null ? (wards || []).find(w => w.id === modalWardId) ?? null : null;

  const showToast = useCallback((m) => {
    setToast(m); setTimeout(() => setToast(""), 2200);
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await api.nurseMe();
      setConfigError(null);
      setWards(data.wards || []);
      setStationName(data.nursing_station || "");
      setStations(data.stations || []);
      setLastSync(new Date());
    } catch (e) {
      const msg = e?.message ?? "";
      if (msg === "Unauthorized") return;
      if (msg.includes("No nursing station")) {
        setConfigError(msg);
        setWards([]);
      } else {
        setLoadError(msg || "Unable to connect to server");
      }
    }
  }, []);

  // Always keep loadRef pointing at the current load function
  loadRef.current = load;

  // Initial data fetch
  useEffect(() => { load(); }, [load]);

  // Real-time updates via WebSocket — replaces 15-second polling
  useEffect(() => {
    const socket = createSocket();

    socket.on("bed:update", (payload) => {
      const { bedId, wardId } = payload ?? {};
      // Ward-level edits (rename/delete/operational toggle) only carry wardId,
      // bed-level edits only carry bedId — require at least one, not both.
      if (!bedId && !wardId) return;
      // Reload to get fresh aggregate counts (vacant/reserved/occupied) for the ward cards
      loadRef.current();
      setLastSync(new Date());
    });

    // On reconnect, do a full reload to catch any updates missed while disconnected
    socket.on("connect", () => { loadRef.current(); });

    return () => { socket.disconnect(); };
  }, []); // socket created once per mount; loadRef keeps the callback fresh

  // If the open ward was removed (manager reassigned it), close the modal
  useEffect(() => {
    if (modalWardId !== null && modalWard === null && wards !== null) {
      setModalWardId(null);
    }
  }, [modalWardId, modalWard, wards]);

  const handleSave = async (bedId, physical, reservation, payer, destination, reservationNote) => {
    try {
      await api.nurseUpdateBedStatus(bedId, physical, reservation, payer, destination, reservationNote);
      showToast("Saved");
    } catch (e) { showToast(toastErr(e)); }
  };

  if (wards === null) return (
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
          <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>Loading…</div>
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );

  const totalBeds   = wards.reduce((s, w) => s + (w.total_beds ?? 0), 0); // capacity (not categorized sum)
  const { totalVacant, totalOccupied: totalOcc } = calculateWardTotals(wards);

  return (
    <AppShell
      menu={[{ key: "dash", icon: icons.home, label: "Dashboard" }]}
      active="dash"
      onSelect={() => {}}
      title={stationName || "Nurse Dashboard"}
      user={{ name: user.name || user.username || "Nurse", role: "NURSE" }}
      onLogout={onLogout}
      topExtra={
        <button onClick={load} className="appbar-btn" title="Refresh">
          <Ic d={icons.refresh} s={17} />
        </button>
      }
    >
      {/* Row 1 — context info cards */}
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="n" style={{ fontSize: 18 }}>{stationName || "—"}</div>
          <div className="l">NURSING STATION</div>
        </div>
        <div className="stat">
          <div className="n" style={{ fontSize: 18 }}>{wards.length}</div>
          <div className="l">TOTAL WARDS</div>
        </div>
        <div className="stat">
          <div className="n" style={{ fontSize: 18 }}>{totalBeds}</div>
          <div className="l">TOTAL BEDS · {totalVacant} vacant · {totalOcc} occ</div>
        </div>
        <div className="stat">
          <div className="n" style={{ fontSize: 18 }}>
            {lastSync ? lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
          </div>
          <div className="l">LAST UPDATE</div>
        </div>
      </div>

      {/* Ward cards */}
      {wards.length === 0 ? (
        <div className="card empty" style={{ marginTop: 20 }}>
          <Ic d={icons.grid} s={32} />
          <div style={{ marginTop: 10, fontWeight: 600 }}>
            {configError ? "No nursing station assigned" : "No wards in this station"}
          </div>
          <div style={{ fontSize: 12, marginTop: 4, color: "var(--ink-3)" }}>
            {configError ?? `Ask the Manager to assign wards to ${stationName || "your nursing station"}.`}
          </div>
        </div>
      ) : stations.length > 1 ? (
        stations.map((st) => {
          const list = wards.filter((w) => w.station_id === st.id);
          if (list.length === 0) return null;
          const beds = list.reduce((s, w) => s + (w.total_beds ?? 0), 0);
          return (
            <div key={st.id} style={{ marginBottom: 18 }}>
              <div className="floor-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{st.name}</span>
                <span className="dim" style={{ fontSize: 11, fontWeight: 600 }}>
                  {list.length} ward{list.length !== 1 ? "s" : ""} · {beds} beds
                </span>
              </div>
              <div className="card-grid">
                {list.map((ward, i) => (
                  <WardCard key={ward.id} ward={ward} index={i} onManage={(w) => setModalWardId(w.id)} />
                ))}
              </div>
            </div>
          );
        })
      ) : (
        <>
          <div className="floor-head">Ward summary</div>
          <div className="card-grid">
            {wards.map((ward, i) => (
              <WardCard key={ward.id} ward={ward} index={i} onManage={(w) => setModalWardId(w.id)} />
            ))}
          </div>
        </>
      )}

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* Bed manage modal */}
      {modalWard && (
        <NurseBedModal
          ward={modalWard}
          onSave={handleSave}
          onClose={() => setModalWardId(null)}
        />
      )}
    </AppShell>
  );
}
