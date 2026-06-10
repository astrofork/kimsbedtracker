import React, { useState, useEffect, useRef, useCallback } from "react";
import { api, toastErr } from "./lib.js";
import { Ic, icons, ThemeToggle } from "./ui.jsx";

// ── helpers ────────────────────────────────────────────────────────────────────
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

// ── Bed grid card ──────────────────────────────────────────────────────────────
const BedCard = React.memo(function BedCard({ bed, onClick }) {
  const p = bed.physical_status, r = bed.reservation_status;
  const color = bedStateColor(p, r);
  const code  = bedStateCode(p, r);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
      style={{
        background: "var(--panel-2)",
        border: `2px solid ${color}`,
        borderRadius: 10,
        padding: "7px 4px 8px",
        textAlign: "center",
        cursor: "pointer",
        transition: "transform 0.1s, opacity 0.1s",
        userSelect: "none",
        minWidth: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      onMouseDown={(e) => { e.currentTarget.style.opacity = "0.75"; }}
      onMouseUp={(e) => { e.currentTarget.style.opacity = "1"; }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)", marginBottom: 3, lineHeight: 1.2 }}>
        {bed.bed_name}
      </div>
      <div style={{ fontSize: 12, fontWeight: 900, color, lineHeight: 1 }}>{code}</div>
    </div>
  );
});

// ── Bed edit dialog ────────────────────────────────────────────────────────────
function BedEditDialog({ bed, onSave, onClose }) {
  const [physical,    setPhysical]    = useState(bed.physical_status);
  const [reservation, setReservation] = useState(bed.reservation_status);
  const [saving,      setSaving]      = useState(false);

  const color = bedStateColor(physical, reservation);
  const code  = bedStateCode(physical, reservation);

  const handleSave = async () => {
    setSaving(true);
    await onSave(bed.id, physical, reservation);
    setSaving(false);
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1100, padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--panel)", borderRadius: 18, padding: "22px 20px 18px",
          width: "100%", maxWidth: 300, boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
          animation: "slideUp .18s both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between" style={{ marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>Bed {bed.bed_name}</div>
            <div style={{ fontSize: 12, color, fontWeight: 700, marginTop: 2 }}>
              {code} · {bedStateLabel(physical, reservation)}
            </div>
          </div>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: color + "22", border: `2px solid ${color}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 900, fontSize: 12, color,
          }}>{code}</div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
            Physical Status
          </div>
          <div className="row" style={{ gap: 8 }}>
            {[["VACANT", "var(--green)", "Vacant"], ["OCCUPIED", "var(--red)", "Occupied"]].map(([val, c, lbl]) => (
              <button key={val} onClick={() => setPhysical(val)} style={{
                flex: 1, padding: "9px 0", borderRadius: 10, fontSize: 13, fontWeight: 700,
                border: `2px solid ${c}`,
                background: physical === val ? c : "transparent",
                color: physical === val ? "#fff" : c,
                cursor: "pointer", transition: "all 0.15s",
              }}>{lbl}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
            Reservation
          </div>
          <div className="row" style={{ gap: 8 }}>
            {[["NONE", "var(--ink-3)", "None"], ["RESERVED", "var(--amber)", "Reserved"]].map(([val, c, lbl]) => (
              <button key={val} onClick={() => setReservation(val)} style={{
                flex: 1, padding: "9px 0", borderRadius: 10, fontSize: 13, fontWeight: 700,
                border: `2px solid ${c}`,
                background: reservation === val ? c : "transparent",
                color: reservation === val ? "#fff" : c,
                cursor: "pointer", transition: "all 0.15s",
              }}>{lbl}</button>
            ))}
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="chip" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 1, padding: "10px 0", borderRadius: 10, fontWeight: 700,
            fontSize: 14, background: "var(--teal)", color: "#fff",
            border: "none", cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.7 : 1, transition: "opacity 0.15s",
          }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Ward section — shows bed grid for one ward ─────────────────────────────────
function WardSection({ ward, filter, onBedClick }) {
  const sorted = [...(ward.beds || [])].sort((a, b) => naturalSort(a.bed_name, b.bed_name));
  const displayed = sorted.filter((b) => {
    if (filter === "V")   return b.physical_status === "VACANT"   && b.reservation_status === "NONE";
    if (filter === "V+R") return b.physical_status === "VACANT"   && b.reservation_status === "RESERVED";
    if (filter === "O")   return b.physical_status === "OCCUPIED" && b.reservation_status === "NONE";
    if (filter === "O+R") return b.physical_status === "OCCUPIED" && b.reservation_status === "RESERVED";
    return true;
  });

  const counts = { V: 0, "V+R": 0, O: 0, "O+R": 0 };
  for (const b of sorted) counts[bedStateCode(b.physical_status, b.reservation_status)]++;
  const total   = sorted.length;
  const vacant  = counts.V + counts["V+R"];

  if (displayed.length === 0 && filter !== "ALL") return null;

  return (
    <div className="card" style={{ padding: 16, marginBottom: 14 }}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{ward.name}</div>
          <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
            {vacant} vacant · {counts.O + counts["O+R"]} occupied · {total} total
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span className="tag v">{counts.V} V</span>
          <span className="tag b">{counts["V+R"]} V+R</span>
          <span className="tag r">{counts.O} O</span>
        </div>
      </div>

      {displayed.length === 0 ? (
        <div className="dim" style={{ fontSize: 13, textAlign: "center", padding: "12px 0" }}>
          No beds in this ward yet.
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))",
          gap: 7,
        }}>
          {displayed.map((bed) => (
            <BedCard key={bed.id} bed={bed} onClick={() => onBedClick(bed)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  NURSE APP  — scoped to the nurse's nursing station
// ══════════════════════════════════════════════════════════════════════════════
export default function NurseApp({ user, onLogout }) {
  const [wards,      setWards]      = useState(null);   // null = loading
  const [editingBed, setEditingBed] = useState(null);
  const [filter,     setFilter]     = useState("ALL");
  const [toast,      setToast]      = useState("");
  const pollRef = useRef(null);

  const showToast = useCallback((m) => {
    setToast(m); setTimeout(() => setToast(""), 2200);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.nurseMe();
      // nurseMe returns { wards: [{ id, name, beds: [...] }] }
      setWards(data.wards || []);
    } catch (e) {
      showToast(toastErr(e));
    }
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
      await load();
    } catch (e) {
      showToast(toastErr(e));
    }
  };

  // Loading spinner
  if (wards === null) return (
    <div className="app">
      <div className="empty" style={{ paddingTop: 120 }}>
        <span className="spin" style={{ display: "inline-block" }}>
          <Ic d={icons.refresh} s={26} />
        </span>
        <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>Loading beds…</div>
      </div>
    </div>
  );

  const allBeds = wards.flatMap((w) => w.beds || []);
  const totalVacant   = allBeds.filter((b) => b.physical_status === "VACANT").length;
  const totalOccupied = allBeds.filter((b) => b.physical_status === "OCCUPIED").length;
  const totalBeds     = allBeds.length;

  const FILTERS = [
    { key: "ALL",  label: "All" },
    { key: "V",    label: "Vacant" },
    { key: "V+R",  label: "Vacant · Rsv" },
    { key: "O",    label: "Occupied" },
    { key: "O+R",  label: "Occ · Rsv" },
  ];

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
                {totalVacant} vacant · {totalOccupied} occupied · {totalBeds} total
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={load} className="chip">
              <Ic d={icons.refresh} s={15} />
            </button>
            <ThemeToggle />
            <button className="chip" onClick={onLogout}>Logout</button>
          </div>
        </div>

        {/* Filter row */}
        <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 2 }}>
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                padding: "5px 11px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                border: "1.5px solid " + (filter === key ? "var(--teal)" : "var(--line)"),
                background: filter === key ? "var(--teal)" : "transparent",
                color: filter === key ? "#fff" : "var(--ink-2)",
                cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s", flexShrink: 0,
              }}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* Wards */}
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
          wards.map((ward) => (
            <WardSection
              key={ward.id}
              ward={ward}
              filter={filter}
              onBedClick={setEditingBed}
            />
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

      {/* Bed edit dialog */}
      {editingBed && (
        <BedEditDialog
          bed={editingBed}
          onSave={handleSave}
          onClose={() => setEditingBed(null)}
        />
      )}
    </div>
  );
}
