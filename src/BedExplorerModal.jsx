import React, { useState, useEffect, useMemo } from "react";
import { api, fmtRelative, friendlyError } from "./lib.js";
import { Ic, icons, useModal, AppError } from "./ui.jsx";

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

// Maps a clicked dashboard card to the fixed set of beds it shows — this is
// a plain viewer, not a filterable explorer, so there's nothing to pivot.
const ENTRY_PRESETS = {
  "Vacant":              { statuses: ["VACANT"] },
  "On Bed":              { statuses: ["ON_BED"] },
  "OCC + RES":           { statuses: ["OCC_RES"] },
  "VAC + RES":           { statuses: ["VAC_RES"] },
  "Total Occupied":      { statuses: ["ON_BED", "OCC_RES"] },
  "Total Vacant":        { statuses: ["VACANT", "VAC_RES"] },
  "Census Occupied":     { statuses: ["ON_BED", "OCC_RES"], bedType: "Census" },
  "Non-Census Occupied": { statuses: ["ON_BED", "OCC_RES"], bedType: "Non-Census" },
};

function entryFilter(entry) {
  if (entry?.payer) return { statuses: new Set(["ON_BED", "OCC_RES"]), bedType: null, payer: entry.payer };
  const preset = ENTRY_PRESETS[entry?.label];
  return { statuses: new Set(preset?.statuses || []), bedType: preset?.bedType || null, payer: null };
}

export default function BedExplorerModal({ entry, wardIds, wardMeta, onClose }) {
  useModal(onClose);
  const filter = useMemo(() => entryFilter(entry), [entry]);

  const [allBeds, setAllBeds] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.cooBedDetails().then((rows) => { if (!cancelled) setAllBeds(rows); })
      .catch((e) => { if (!cancelled) setError(friendlyError(e).message); });
    return () => { cancelled = true; };
  }, []);

  const wardIdSet = useMemo(() => new Set(wardIds), [wardIds]);

  const matchedBeds = useMemo(() => {
    if (!allBeds) return [];
    return allBeds.filter((b) => {
      if (!wardIdSet.has(b.ward_id)) return false;
      if (!filter.statuses.has(classify(b))) return false;
      if (filter.bedType && (b.bed_type || "Census") !== filter.bedType) return false;
      if (filter.payer && b.payer_type !== filter.payer) return false;
      return true;
    });
  }, [allBeds, wardIdSet, filter]);

  const wardGroups = useMemo(() => {
    const byWard = new Map();
    for (const b of matchedBeds) {
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
  }, [matchedBeds, allBeds, wardIdSet, wardMeta]);

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
              <div className="h1" style={{ fontSize: 18 }}>{entry?.label || "Beds"}</div>
              <div className="dim" style={{ fontSize: 12.5 }}>
                {loading ? "Loading…" : `${matchedBeds.length} bed${matchedBeds.length === 1 ? "" : "s"}`}
              </div>
            </div>
          </div>
          <button className="bx-close" onClick={onClose} aria-label="Close"><Ic d={icons.x} s={18} /></button>
        </div>

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
              <div style={{ marginTop: 10, fontWeight: 600 }}>No beds match this right now</div>
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
                  <div className="bx-bed-grid">
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

function BedCard({ bed }) {
  const status = classify(bed);
  const meta = STATUS_META[status];
  const rich = status === "OCC_RES" || status === "VAC_RES";
  return (
    <div className={"bx-bed" + (rich ? " bx-bed-rich" : "")} style={{ borderColor: meta.color, background: meta.bg }}>
      <div className="bx-bed-top">
        <span className="bx-bed-name">{bed.bed_name}</span>
        <span className="bx-bed-status" style={{ color: meta.color }}>{meta.label}</span>
      </div>
      {rich && (
        <div className="bx-bed-detail">
          {status === "OCC_RES" ? (
            <div className="bx-bed-row" title={bed.destination || ""}>
              <Ic d={icons.share} s={12} /> <span className="bx-clamp2">{bed.destination || "Destination not specified"}</span>
            </div>
          ) : (
            <div className="bx-bed-row" title={bed.reservation_note || ""}>
              <Ic d={icons.fileText} s={12} /> <span className="bx-clamp2">{bed.reservation_note || "No note recorded"}</span>
            </div>
          )}
        </div>
      )}
      <div className="bx-bed-time">
        <Ic d={icons.clock} s={11} /> {fmtRelative(bed.updated_at)}
      </div>
    </div>
  );
}
