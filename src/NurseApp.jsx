import React, { useState, useEffect, useRef, useCallback } from "react";
import { api, toastErr } from "./lib.js";
import { Ic, icons, ThemeToggle, useModal } from "./ui.jsx";

// ── helpers ────────────────────────────────────────────────────────────────────

function BedBadges({ bed }) {
  if (!bed) return null;
  const isNC  = bed.bed_type === "Non-Census";
  const isRv  = bed.unit_type === "Renova";
  const notOp = !bed.operational_status;
  return (
    <div style={{ display: "flex", gap: 2, justifyContent: "center", marginTop: 3, alignItems: "center" }}>
      <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "-0.3px", color: isNC ? "var(--ink-3)" : "#0EA5E9" }}>
        {isNC ? "NC" : "C"}
      </span>
      {bed.unit_type && (
        <>
          <span style={{ fontSize: 6, color: "var(--line)" }}>·</span>
          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "-0.3px", color: isRv ? "#F59E0B" : "var(--teal)" }}>
            {isRv ? "Rv" : "K"}
          </span>
        </>
      )}
      {notOp && (
        <>
          <span style={{ fontSize: 6, color: "var(--line)" }}>·</span>
          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "-0.3px", color: "var(--red)" }}>N/O</span>
        </>
      )}
    </div>
  );
}

function naturalSort(a, b) {
  const re = /(\d+)/g;
  const ap = a.split(re), bp = b.split(re);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const ai = ap[i] ?? "", bi = bp[i] ?? "";
    const an = parseInt(ai, 10), bn = parseInt(bi, 10);
    if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
    if (ai !== bi) return ai.localeCompare(bi);
  }
  return 0;
}

function bedStateColor(physical, reservation) {
  if (physical === "VACANT"   && reservation === "NONE")     return "var(--green)";
  if (physical === "VACANT"   && reservation === "RESERVED") return "var(--amber)";
  if (physical === "OCCUPIED" && reservation === "NONE")     return "var(--red)";
  if (physical === "OCCUPIED" && reservation === "RESERVED") return "#8B5CF6";
  return "var(--ink-3)";
}
function bedStateLabel(physical, reservation) {
  if (physical === "VACANT"   && reservation === "NONE")     return "Vacant";
  if (physical === "VACANT"   && reservation === "RESERVED") return "Vacant · Reserved";
  if (physical === "OCCUPIED" && reservation === "NONE")     return "Occupied";
  if (physical === "OCCUPIED" && reservation === "RESERVED") return "Occupied · Reserved";
  return "Unknown";
}
function bedStateCode(physical, reservation) {
  if (physical === "VACANT"   && reservation === "NONE")     return "V";
  if (physical === "VACANT"   && reservation === "RESERVED") return "V+R";
  if (physical === "OCCUPIED" && reservation === "NONE")     return "O";
  if (physical === "OCCUPIED" && reservation === "RESERVED") return "O+R";
  return "?";
}

function wardCounts(beds) {
  let vn = 0, vr = 0, on_ = 0, or_ = 0;
  for (const b of beds) {
    const code = bedStateCode(b.physical_status, b.reservation_status);
    if (code === "V")   vn++;
    if (code === "V+R") vr++;
    if (code === "O")   on_++;
    if (code === "O+R") or_++;
  }
  return { vn, vr, on: on_, or: or_ };
}

// ── Bed row cell — colored icon circle + name ─────────────────────────────────
const BedCard = React.memo(function BedCard({ bed, onClick }) {
  const color = bedStateColor(bed.physical_status, bed.reservation_status);
  const dimmed = bed.operational_status === false;
  return (
    <div role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 8px",
        borderRight: "1px solid var(--line)",
        borderBottom: "1px solid var(--line)",
        cursor: "pointer",
        userSelect: "none",
        opacity: dimmed ? 0.5 : 1,
        WebkitTapHighlightColor: "transparent",
        transition: "background 0.1s",
      }}
      onTouchStart={(e) => { e.currentTarget.style.background = "var(--panel-2)"; }}
      onTouchEnd={(e)   => { e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{
        width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
        background: color,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: `0 2px 6px ${color}55`,
      }}>
        <Ic d={icons.bed} s={14} style={{ color: "#fff" }} />
      </div>
      <span style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {bed.bed_name}
      </span>
    </div>
  );
});

// ── Bed detail bottom sheet ────────────────────────────────────────────────────
function BedDetailSheet({ bed, onSave, onClose }) {
  const [physical,    setPhysical]    = useState(bed.physical_status);
  const [reservation, setReservation] = useState(bed.reservation_status);
  const [saving,      setSaving]      = useState(false);
  const color = bedStateColor(physical, reservation);

  const handleSave = async () => {
    setSaving(true);
    await onSave(bed.id, physical, reservation);
    setSaving(false);
    onClose();
  };

  const classificationBadges = [
    [bed.bed_type || "Census", bed.bed_type === "Non-Census" ? "var(--ink-3)" : "#0EA5E9"],
    ...(bed.unit_type ? [[bed.unit_type, bed.unit_type === "Renova" ? "#F59E0B" : "var(--teal)"]] : []),
    [bed.operational_status !== false ? "Operational" : "Non-Operational",
     bed.operational_status !== false ? "var(--green)" : "var(--red)"],
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1200, padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: "var(--panel)",
        borderRadius: 20,
        width: "100%", maxWidth: 340,
        padding: "24px 20px 20px",
        maxHeight: "90vh", overflowY: "auto",
        animation: "slideUp .18s both",
        boxShadow: "0 8px 40px rgba(0,0,0,0.22)",
      }} onClick={(e) => e.stopPropagation()}>

        {/* Bed hero */}
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            minWidth: 72, height: 72, borderRadius: 18, padding: "0 12px",
            background: color + "1a", border: `3px solid ${color}`,
            fontSize: 26, fontWeight: 900, color, marginBottom: 10,
            letterSpacing: "-0.5px",
          }}>{bed.bed_name}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color }}>{bedStateLabel(physical, reservation)}</div>
        </div>

        {/* Classification badges — read-only */}
        <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap", justifyContent: "center" }}>
          {classificationBadges.map(([label, badgeColor]) => (
            <span key={label} style={{
              fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 8,
              background: badgeColor + "18", color: badgeColor, border: `1px solid ${badgeColor}40`,
            }}>{label}</span>
          ))}
        </div>

        {/* Physical status */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
            Physical Status
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[["VACANT", "var(--green)", "Vacant"], ["OCCUPIED", "var(--red)", "Occupied"]].map(([val, c, lbl]) => (
              <button key={val} onClick={() => setPhysical(val)} style={{
                flex: 1, padding: "11px 0", borderRadius: 12, fontSize: 14, fontWeight: 700,
                border: `2px solid ${c}`,
                background: physical === val ? c : "transparent",
                color: physical === val ? "#fff" : c,
                cursor: "pointer", transition: "all 0.15s",
              }}>{lbl}</button>
            ))}
          </div>
        </div>

        {/* Reservation status */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
            Reservation
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[["NONE", "var(--ink-3)", "None"], ["RESERVED", "var(--amber)", "Reserved"]].map(([val, c, lbl]) => (
              <button key={val} onClick={() => setReservation(val)} style={{
                flex: 1, padding: "11px 0", borderRadius: 12, fontSize: 14, fontWeight: 700,
                border: `2px solid ${c}`,
                background: reservation === val ? c : "transparent",
                color: reservation === val ? "#fff" : c,
                cursor: "pointer", transition: "all 0.15s",
              }}>{lbl}</button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button className="chip" style={{ flex: 1, justifyContent: "center", padding: "11px 0", fontSize: 14 }} onClick={onClose}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 2, padding: "11px 0", borderRadius: 12, fontWeight: 700,
            fontSize: 14, background: "var(--teal)", color: "#fff",
            border: "none", cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.7 : 1, transition: "opacity 0.15s",
          }}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Bed manage modal — full bed grid for one ward ──────────────────────────────
function NurseBedModal({ ward, onSave, onClose }) {
  useModal(onClose);
  // Annotate each bed with ward-level unit_type so badges + filters work uniformly
  const [beds, setBeds] = useState(() =>
    (ward.beds || []).map(b => ({ ...b, unit_type: ward.unit_type || null }))
  );
  const [filter,     setFilter]     = useState("ALL");
  const [editingBed, setEditingBed] = useState(null);

  const sorted = [...beds].sort((a, b) => naturalSort(a.bed_name, b.bed_name));

  const displayed = sorted.filter((b) => {
    if (filter === "KIMS")     return b.unit_type === "KIMS";
    if (filter === "Renova")   return b.unit_type === "Renova";
    if (filter === "Op")       return !!b.operational_status;
    if (filter === "Non-Op")   return !b.operational_status;
    if (filter === "Vacant")   return b.physical_status === "VACANT";
    if (filter === "Occupied") return b.physical_status === "OCCUPIED";
    if (filter === "Reserved") return b.reservation_status === "RESERVED";
    return true;
  });

  const fc = { ALL: sorted.length, KIMS: 0, Renova: 0, Op: 0, "Non-Op": 0, Vacant: 0, Occupied: 0, Reserved: 0 };
  for (const b of sorted) {
    if (b.unit_type === "Renova") fc["Renova"]++;
    else if (b.unit_type === "KIMS") fc["KIMS"]++;
    if (b.operational_status !== false) fc["Op"]++; else fc["Non-Op"]++;
    if (b.physical_status === "VACANT") fc["Vacant"]++; else fc["Occupied"]++;
    if (b.reservation_status === "RESERVED") fc["Reserved"]++;
  }

  const handleSave = async (bedId, physical, reservation) => {
    await onSave(bedId, physical, reservation);
    // Preserve unit_type and other master fields via spread
    setBeds((prev) => prev.map((b) =>
      b.id === bedId ? { ...b, physical_status: physical, reservation_status: reservation } : b
    ));
  };

  const FILTERS = [
    { key: "ALL",      label: "All",         color: "var(--ink)"  },
    { key: "KIMS",     label: "KIMS",        color: "var(--teal)" },
    { key: "Renova",   label: "Renova",      color: "#F59E0B"     },
    { key: "Op",       label: "Operational", color: "var(--green)"},
    { key: "Non-Op",   label: "Non-Op",      color: "var(--red)"  },
    { key: "Vacant",   label: "Vacant",      color: "var(--green)"},
    { key: "Occupied", label: "Occupied",    color: "var(--red)"  },
    { key: "Reserved", label: "Reserved",    color: "var(--amber)"},
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
            <button className="chip" onClick={onClose}>Close</button>
          </div>

          {/* Filter pills — wrap, evenly spaced */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10, marginBottom: 14 }}>
            {FILTERS.map(({ key, label, color }) => (
              <button key={key} onClick={() => setFilter(key)} style={{
                padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600,
                border: `1.5px solid ${color}`,
                background: filter === key ? color : "transparent",
                color: filter === key ? "#fff" : color,
                cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
              }}>
                {label}{fc[key] > 0 ? ` (${fc[key]})` : ""}
              </button>
            ))}
          </div>

          {/* Bed grid */}
          {displayed.length === 0 ? (
            <div className="dim" style={{ textAlign: "center", padding: "24px 0", fontSize: 13 }}>
              No beds match this filter.
            </div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              borderTop: "1px solid var(--line)",
              borderLeft: "1px solid var(--line)",
            }}>
              {displayed.map((bed) => (
                <BedCard key={bed.id} bed={bed} onClick={() => setEditingBed(bed)} />
              ))}
            </div>
          )}
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

// ── Ward summary card — matches PRE card style ─────────────────────────────────
function WardCard({ ward, index, onManage }) {
  const counts = wardCounts(ward.beds || []);
  const total  = (ward.beds || []).length;
  const allVacant = counts.vn === total && total > 0;

  return (
    <div className="ward-card slide-up" style={{
      animationDelay: index * 0.03 + "s",
      borderColor: "var(--teal-deep)",
      padding: 16, marginBottom: 12,
    }}>
      {/* Header */}
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{ward.name}</div>
          <div className="dim" style={{ fontSize: 12 }}>
            {total} beds
            {allVacant
              ? <span style={{ color: "var(--green)" }}> · all vacant</span>
              : <span style={{ color: "var(--teal)" }}> · complete</span>}
          </div>
        </div>
        <span className="tag v"><Ic d={icons.check} s={12} /> ok</span>
      </div>

      {/* Stats block */}
      <div style={{
        display: "flex", background: "var(--panel-2)",
        borderRadius: 12, overflow: "hidden", marginBottom: 14,
      }}>
        {[
          { label: "Vacant",   val: counts.vn,  color: "var(--green)" },
          { label: "Vac+Res",  val: counts.vr,  color: "var(--amber)" },
          { label: "Occupied", val: counts.on,  color: "var(--red)"   },
          { label: "Occ+Res",  val: counts.or,  color: "#8B5CF6"      },
        ].map(({ label, val, color }, idx) => (
          <div key={label} style={{
            flex: 1, textAlign: "center", padding: "12px 6px",
            borderLeft: idx > 0 ? "1px solid var(--line)" : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-2)" }}>{label}</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="row" style={{ gap: 8 }}>
        <button className="chip" style={{ flex: 1, justifyContent: "center", color: "var(--teal)" }}
          onClick={() => onManage(ward)}>
          <Ic d={icons.bed} s={13} /> Manage beds
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  NURSE APP
// ══════════════════════════════════════════════════════════════════════════════
export default function NurseApp({ user, onLogout }) {
  const [wards,      setWards]      = useState(null);
  const [modalWard,  setModalWard]  = useState(null);
  const [toast,      setToast]      = useState("");
  const pollRef = useRef(null);

  const showToast = useCallback((m) => {
    setToast(m); setTimeout(() => setToast(""), 2200);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.nurseMe();
      setWards(data.wards || []);
    } catch (e) { showToast(toastErr(e)); }
  }, [showToast]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 15000);
    return () => clearInterval(pollRef.current);
  }, [load]);

  const handleSave = async (bedId, physical, reservation) => {
    try {
      await api.nurseUpdateBedStatus(bedId, physical, reservation);
      showToast("Saved");
      // Update local state so card counts refresh immediately
      setWards((prev) => prev.map((w) => ({
        ...w,
        beds: (w.beds || []).map((b) =>
          b.id === bedId
            ? { ...b, physical_status: physical, reservation_status: reservation }
            : b
        ),
      })));
    } catch (e) { showToast(toastErr(e)); }
  };

  if (wards === null) return (
    <div className="app">
      <div className="empty" style={{ paddingTop: 120 }}>
        <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
        <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>Loading…</div>
      </div>
    </div>
  );

  const allBeds     = wards.flatMap((w) => w.beds || []);
  const totalBeds   = allBeds.length;
  const totalVacant = allBeds.filter((b) => b.physical_status === "VACANT").length;
  const totalOcc    = allBeds.filter((b) => b.physical_status === "OCCUPIED").length;

  return (
    <div className="app">
      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "var(--panel)", borderBottom: "1px solid var(--line)",
        padding: "12px 16px 10px",
      }}>
        <div className="row between">
          <div className="row" style={{ gap: 10 }}>
            <div className="logo" style={{ fontSize: 16, width: 32, height: 32 }}>B</div>
            <div>
              <div className="h1" style={{ fontSize: 16, lineHeight: 1.1 }}>
                {user.nursing_station || "Nurse"}
              </div>
              <div className="dim" style={{ fontSize: 11 }}>
                {totalVacant} vacant · {totalOcc} occupied · {totalBeds} beds
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={load} className="chip"><Ic d={icons.refresh} s={15} /></button>
            <ThemeToggle />
            <button className="chip" onClick={onLogout}>Logout</button>
          </div>
        </div>
      </div>

      {/* Ward cards */}
      <div className="pad" style={{ paddingTop: 16 }}>
        {wards.length === 0 ? (
          <div className="card empty" style={{ marginTop: 20 }}>
            <Ic d={icons.grid} s={32} />
            <div style={{ marginTop: 10, fontWeight: 600 }}>No wards in this station</div>
            <div style={{ fontSize: 12, marginTop: 4, color: "var(--ink-3)" }}>
              Ask the Manager to assign wards to {user.nursing_station || "your nursing station"}.
            </div>
          </div>
        ) : (
          wards.map((ward, i) => (
            <WardCard key={ward.id} ward={ward} index={i} onManage={setModalWard} />
          ))
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "var(--ink)", color: "var(--bg)", padding: "9px 18px",
          borderRadius: 20, fontSize: 13, fontWeight: 600,
          zIndex: 2000, pointerEvents: "none", animation: "slideUp .18s both",
        }}>{toast}</div>
      )}

      {/* Bed manage modal */}
      {modalWard && (
        <NurseBedModal
          ward={modalWard}
          onSave={handleSave}
          onClose={() => setModalWard(null)}
        />
      )}
    </div>
  );
}
