import React, { useState, useEffect, useMemo } from "react";
import { api, fmtRelative, friendlyError } from "./lib.js";
import { Ic, icons, useModal, AppError } from "./ui.jsx";
import { dischargeBadge } from "./bedUtils.js";

// Five mutually-exclusive buckets, checked in priority order so a bed is
// only ever counted once (a non-operational bed is "Out of Service" first,
// regardless of whatever physical/reservation state it was last left in).
const STATUS_META = {
  VACANT:  { label: "Vacant",              color: "#16a34a", bg: "rgba(22,163,74,.13)" },
  ON_BED:  { label: "On Bed",              color: "#db2777", bg: "rgba(219,39,119,.13)" },
  OCC_RES: { label: "Occupied + Reserved", color: "#ea580c", bg: "rgba(234,88,12,.13)" },
  VAC_RES: { label: "Vacant + Reserved",   color: "#2563eb", bg: "rgba(37,99,235,.13)" },
  OOS:     { label: "Out of Service",      color: "#6b7280", bg: "rgba(107,114,128,.13)" },
};

function classify(bed) {
  if (bed.operational_status === false) return "OOS";
  if (bed.physical_status === "VACANT") return bed.reservation_status === "RESERVED" ? "VAC_RES" : "VACANT";
  return bed.reservation_status === "RESERVED" ? "OCC_RES" : "ON_BED";
}

// System Checkout done but the patient hasn't actually left yet — a plain
// Occupied bed (classify() still calls it ON_BED) but the admin dashboard's
// per-type "Overstay" cards need to tell it apart from a regular on-bed
// patient. Keyed off patient_left, not physical_checkout_status — Physical
// Checkout can be marked COMPLETED with "Patient left: No", which still means
// the patient is physically in the bed. Mirrors bedService.ts's
// bedStateBreakdown() CASE exactly.
function isOverstay(bed) {
  return bed.physical_status === "OCCUPIED" && bed.reservation_status === "NONE"
    && bed.discharge_tracking?.system_checkout_status === "COMPLETED"
    && bed.discharge_tracking?.patient_left !== true;
}

const ALL_STATUSES        = ["VACANT", "ON_BED", "OCC_RES", "VAC_RES", "OOS"];
const OPERATIONAL_STATUSES = ["VACANT", "ON_BED", "OCC_RES", "VAC_RES"];

// Maps a clicked dashboard card to the fixed set of beds it shows — this is
// a plain viewer, not a filterable explorer, so there's nothing to pivot.
// Note: classify() doesn't distinguish Lounge beds or "overstay" (System
// Checkout done, Physical pending) from a plain Occupied bed — so "On Bed"
// here already includes both, same as the admin dashboard's "Total Patients"
// (onbed + overstay + lounge) — no separate status needed for that card.
const ENTRY_PRESETS = {
  "Vacant":              { statuses: ["VACANT"] },
  "On Bed":              { statuses: ["ON_BED"] },
  "OCC + RES":           { statuses: ["OCC_RES"] },
  "VAC + RES":           { statuses: ["VAC_RES"] },
  "Total Occupied":      { statuses: ["ON_BED", "OCC_RES"] },
  "Total Vacant":        { statuses: ["VACANT", "VAC_RES"] },
  "Census Occupied":     { statuses: ["ON_BED", "OCC_RES"], bedType: "Census" },
  "Non-Census Occupied": { statuses: ["ON_BED", "OCC_RES"], bedType: "Non-Census" },

  // Admin dashboard — Hospital Snapshot / Occupancy Board. New keys, distinct
  // from the ones above, so nothing here can change what an old card shows.
  // "Lounge" beds are deliberately excluded from every one of these except
  // Total Patients and the card that's specifically about the lounge — matches
  // adminDashboard()'s own scoping exactly (see bedService.ts).
  "admin:Total Beds":           { statuses: ALL_STATUSES, excludeBedType: "Lounge" },
  "admin:Operational Beds":     { statuses: OPERATIONAL_STATUSES, excludeBedType: "Lounge" },
  "admin:Census Beds":          { statuses: ALL_STATUSES, bedType: "Census" },
  "admin:Non-Census Beds":      { statuses: ALL_STATUSES, bedType: "Non-Census" },
  "admin:Total Patients":       { statuses: ["ON_BED"] },
  "admin:Total Occ Census":     { statuses: ["ON_BED", "OCC_RES"], bedType: "Census" },
  "admin:Total Occ Non-Census": { statuses: ["ON_BED", "OCC_RES"], bedType: "Non-Census" },
  "admin:In Discharge Lounge":  { statuses: ["ON_BED", "OCC_RES"], bedType: "Lounge" },
  "admin:Vacant":               { statuses: ["VACANT", "VAC_RES"], excludeBedType: "Lounge" },
  "admin:Census Daycare":       { statuses: ["ON_BED", "OCC_RES"], bedType: "Census", admissionType: "DAYCARE" },
  "admin:Non-Census Daycare":   { statuses: ["ON_BED", "OCC_RES"], bedType: "Non-Census", admissionType: "DAYCARE" },

  // CEO's Occupancy Board layout. "On Bed" here means the backend's narrower
  // onbed bucket (excludes Overstay) — different from the plain "On Bed"
  // preset above, which still lumps onbed+overstay together for old cards.
  "admin:Census On Bed":        { statuses: ["ON_BED"], bedType: "Census", custom: (b) => !isOverstay(b) },
  "admin:Census Res":           { statuses: ["OCC_RES"], bedType: "Census" },
  "admin:Census Overstay":      { statuses: ["ON_BED"], bedType: "Census", custom: isOverstay },
  "admin:Non-Census On Bed":    { statuses: ["ON_BED"], bedType: "Non-Census", custom: (b) => !isOverstay(b) },
  "admin:Non-Census Res":       { statuses: ["OCC_RES"], bedType: "Non-Census" },
  "admin:Non-Census Overstay":  { statuses: ["ON_BED"], bedType: "Non-Census", custom: isOverstay },
  "admin:Vacant Census":        { statuses: ["VACANT"], bedType: "Census" },
  "admin:Vacant Census Res":    { statuses: ["VAC_RES"], bedType: "Census" },
  "admin:Vacant Non-Census":    { statuses: ["VACANT"], bedType: "Non-Census" },
  "admin:Vacant Non-Census Res":{ statuses: ["VAC_RES"], bedType: "Non-Census" },
  "admin:Patient Type IPD":     { statuses: ["ON_BED", "OCC_RES"], admissionType: "IP" },
  "admin:Patient Type Daycare": { statuses: ["ON_BED", "OCC_RES"], admissionType: "DAYCARE" },
  "admin:Patient Type OPD":     { statuses: ["ON_BED", "OCC_RES"], admissionType: "OPD" },
  // Total cards — sum of their own sub-items, so the filter shows all admitted beds
  "admin:Patient Type Total":   { statuses: ["ON_BED", "OCC_RES"] },
  "admin:By Payer Total":       { statuses: ["ON_BED", "OCC_RES"] },
};

function entryFilter(entry) {
  if (entry?.payer) return { statuses: new Set(["ON_BED", "OCC_RES"]), bedType: null, excludeBedType: null, payer: entry.payer, admissionType: null, custom: null };
  const preset = ENTRY_PRESETS[entry?.label];
  return {
    statuses: new Set(preset?.statuses || []),
    bedType: preset?.bedType || null,
    excludeBedType: preset?.excludeBedType || null,
    custom: preset?.custom || null,
    payer: null,
    admissionType: preset?.admissionType || null,
  };
}

export default function BedExplorerModal({ entry, wardIds, wardMeta, onClose, fetchBeds = api.cooBedDetails }) {
  useModal(onClose);
  const filter = useMemo(() => entryFilter(entry), [entry]);

  const [allBeds, setAllBeds] = useState(null);
  const [error, setError] = useState(null);
  const [bxSearch, setBxSearch] = useState("");
  const [bxSearchBy, setBxSearchBy] = useState("bed");

  useEffect(() => {
    let cancelled = false;
    fetchBeds().then((rows) => { if (!cancelled) setAllBeds(rows); })
      .catch((e) => { if (!cancelled) setError(friendlyError(e).message); });
    return () => { cancelled = true; };
  }, [fetchBeds]);

  const wardIdSet = useMemo(() => new Set(wardIds), [wardIds]);

  const matchedBeds = useMemo(() => {
    if (!allBeds) return [];
    return allBeds.filter((b) => {
      if (!wardIdSet.has(b.ward_id)) return false;
      if (!filter.statuses.has(classify(b))) return false;
      if (filter.bedType && (b.bed_type || "Census") !== filter.bedType) return false;
      if (filter.excludeBedType && (b.bed_type || "Census") === filter.excludeBedType) return false;
      if (filter.payer && b.payer_type !== filter.payer) return false;
      if (filter.admissionType && b.admission_type !== filter.admissionType) return false;
      if (filter.custom && !filter.custom(b)) return false;
      return true;
    });
  }, [allBeds, wardIdSet, filter]);

  const filteredBeds = useMemo(() => {
    const q = bxSearch.trim().toLowerCase();
    if (!q) return matchedBeds;
    if (bxSearchBy === "ip") return matchedBeds.filter((b) => (b.ip_last6 || "").toLowerCase().includes(q));
    if (bxSearchBy === "ward") {
      return matchedBeds.filter((b) => {
        const meta = wardMeta.get(b.ward_id);
        return (meta?.ward || "").toLowerCase().includes(q);
      });
    }
    return matchedBeds.filter((b) => (b.bed_name || "").toLowerCase().includes(q));
  }, [matchedBeds, bxSearch, bxSearchBy, wardMeta]);

  const wardGroups = useMemo(() => {
    const byWard = new Map();
    for (const b of filteredBeds) {
      if (!byWard.has(b.ward_id)) byWard.set(b.ward_id, []);
      byWard.get(b.ward_id).push(b);
    }
    const recordedByWard = new Map();
    if (allBeds) {
      for (const b of allBeds) {
        if (!wardIdSet.has(b.ward_id)) continue;
        recordedByWard.set(b.ward_id, (recordedByWard.get(b.ward_id) || 0) + 1);
      }
    }
    return Array.from(byWard.entries())
      .map(([wardId, beds]) => {
        const meta = wardMeta.get(wardId) || {};
        const recordedCount = recordedByWard.get(wardId) || 0;
        return { wardId, meta, beds, incomplete: meta.total != null && recordedCount < meta.total, recordedCount };
      })
      .sort((a, b) => (a.meta.ward || "").localeCompare(b.meta.ward || ""));
  }, [filteredBeds, allBeds, wardIdSet, wardMeta]);

  const loading = allBeds === null && !error;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet bx-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="bx-header">
          <div className="bx-header-title">
            <span className="bx-header-icon" style={{ color: entry?.color, background: `${entry?.color}1a` }}>
              <Ic d={icons.bed} s={20} />
            </span>
            <div>
              <div className="h1" style={{ fontSize: 18 }}>{(entry?.label || "Beds").replace(/^admin:/, "")}</div>
              <div className="dim" style={{ fontSize: 12.5 }}>
                {loading ? "Loading…"
                  : filteredBeds.length === matchedBeds.length ? `${matchedBeds.length} bed${matchedBeds.length === 1 ? "" : "s"}`
                  : `${filteredBeds.length} of ${matchedBeds.length} beds`}
              </div>
            </div>
          </div>
          <button className="bx-close" onClick={onClose} aria-label="Close"><Ic d={icons.x} s={18} /></button>
        </div>

        {!loading && !error && matchedBeds.length > 0 && (
          <div style={{ display: "flex", gap: 8, padding: "0 22px 10px", alignItems: "center" }}>
            <div className="seg-pill" style={{ flexShrink: 0 }}>
              {[{ value: "ward", label: "Ward" }, { value: "bed", label: "Bed" }, { value: "ip", label: "IP" }].map((o) => (
                <button key={o.value} className={bxSearchBy === o.value ? "on" : ""}
                  onClick={() => { setBxSearchBy(o.value); setBxSearch(""); }}>{o.label}</button>
              ))}
            </div>
            <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", pointerEvents: "none", display: "flex" }}>
                <Ic d={icons.search} s={14} />
              </span>
              <input className="field" value={bxSearch} onChange={(e) => setBxSearch(e.target.value)}
                placeholder={bxSearchBy === "ip" ? "Search by IP…" : bxSearchBy === "ward" ? "Search by ward…" : "Search by bed name…"}
                style={{ paddingLeft: 30, fontSize: 12, height: 32, width: "100%", borderRadius: 9 }} maxLength={40} />
            </div>
          </div>
        )}

        <div className="bx-main">
          {error ? (
            <AppError message={error} />
          ) : loading ? (
            <div style={{ textAlign: "center", padding: 48 }}>
              <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
            </div>
          ) : wardGroups.length === 0 ? (
            <div className="card empty" style={{ margin: "8px 0" }}>
              <Ic d={icons.bed} s={26} />
              <div style={{ marginTop: 10, fontWeight: 600 }}>
                {bxSearch.trim() ? "No beds match your search" : "No beds match this right now"}
              </div>
            </div>
          ) : (
            wardGroups.map((g) => (
              <div key={g.wardId} className="bx-ward">
                <div className="bx-ward-head">
                  <span className="bx-ward-name">{g.meta.ward || "Unknown ward"}</span>
                  <span className="dim" style={{ fontSize: 12 }}>{g.beds.length} bed{g.beds.length === 1 ? "" : "s"}</span>
                </div>
                <div className="bx-ward-body">
                  {g.incomplete && (
                    <div className="dim" style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.4 }}>
                      {g.recordedCount} of {g.meta.total} beds in this ward have an individual record (Setup → Bed Master) — the rest are counted but can't be shown individually.
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(152px, 1fr))", gap: 8 }}>
                    {g.beds.map((b) => <BedCard key={b.id} bed={b} />)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const KV = ({ label, value, title }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, lineHeight: 1.4 }}>
    <span style={{ color: "var(--ink-3)", fontWeight: 600, flexShrink: 0 }}>{label}</span>
    <span style={{ fontWeight: 700, color: "var(--ink)", textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={title}>
      {value}
    </span>
  </div>
);

function BedCard({ bed }) {
  const status = classify(bed);
  const meta = STATUS_META[status];
  const badge = (status === "ON_BED" || status === "OCC_RES") ? dischargeBadge(bed.discharge_tracking) : null;
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 5,
      background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12,
      padding: "10px 11px", boxShadow: "var(--shadow)", minHeight: 90,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-.01em", lineHeight: 1.2, wordBreak: "break-word" }}>
          {bed.bed_name}
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap", flexShrink: 0 }}>
          {meta.label}
        </span>
      </div>
      <KV label="IP" value={bed.ip_last6 || "—"} />
      <KV label="Ward" value={bed.ward || "—"} title={bed.ward} />
      {badge && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, lineHeight: 1.4 }}>
          <span style={{ color: "var(--ink-3)", fontWeight: 600, flexShrink: 0 }}>Disch</span>
          <span style={{ fontWeight: 700, color: "var(--primary)", textAlign: "right", whiteSpace: "nowrap" }}>{badge}</span>
        </div>
      )}
      <div style={{ fontSize: 10, color: "var(--ink-3)", fontWeight: 500, marginTop: "auto" }}>
        {fmtRelative(bed.updated_at)}
      </div>
    </div>
  );
}
