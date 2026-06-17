export function naturalSort(a, b) {
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

export function bedStateColor(physical, reservation) {
  if (physical === "OCCUPIED" && reservation === "RESERVED") return "var(--st-or)";
  if (physical === "VACANT"   && reservation === "RESERVED") return "var(--st-vr)";
  if (physical === "VACANT")   return "var(--st-v)";
  if (physical === "OCCUPIED") return "var(--st-o)";
  return "var(--ink-3)";
}

export function bedStateBg(physical, reservation) {
  if (physical === "OCCUPIED" && reservation === "RESERVED") return "var(--st-or-bg)";
  if (physical === "VACANT"   && reservation === "RESERVED") return "var(--st-vr-bg)";
  if (physical === "VACANT")   return "var(--st-v-bg)";
  if (physical === "OCCUPIED") return "var(--st-o-bg)";
  return "var(--panel-2)";
}

export function bedStateShort(physical, reservation) {
  if (physical === "OCCUPIED" && reservation === "RESERVED") return "Occ + Res";
  if (physical === "VACANT"   && reservation === "RESERVED") return "Vac + Res";
  if (physical === "VACANT")   return "Vacant";
  if (physical === "OCCUPIED") return "Occupied";
  return "?";
}

// ── Single source of truth for occupancy partition totals ──────────────────────
// The bed model is a 2×2 matrix of physical_status {VACANT, OCCUPIED} ×
// reservation_status {NONE, RESERVED}. The four stored counts are the four
// DISJOINT cells (proven in bedDetailService._recalcWardTotals):
//   vacant            = VACANT   ∧ NONE
//   reserved          = VACANT   ∧ RESERVED
//   occupied          = OCCUPIED ∧ NONE
//   occupied_reserved = OCCUPIED ∧ RESERVED
// Accepts a single ward-counts object or an array of them. `null`/`undefined`
// counts are treated as 0 (an unreported ward contributes nothing).
//
// NOTE: `totalBeds` here is the sum of the four CATEGORIZED counts. It is NOT
// the ward's stored capacity (`total` / `total_beds`); for an unreported ward
// the categorized sum is 0 while capacity is non-zero. Use `total_beds` for
// capacity and this utility only for the occupancy partition.
export function calculateWardTotals(input) {
  const list = Array.isArray(input) ? input : [input];
  let vacant = 0, reserved = 0, occupied = 0, occupiedReserved = 0;
  for (const b of list) {
    vacant           += b?.vacant            ?? 0;
    reserved         += b?.reserved          ?? 0;
    occupied         += b?.occupied          ?? 0;
    occupiedReserved += b?.occupied_reserved ?? 0;
  }
  return {
    totalBeds:     vacant + reserved + occupied + occupiedReserved,
    totalVacant:   vacant + reserved,
    totalOccupied: occupied + occupiedReserved,
    totalReserved: reserved + occupiedReserved,
  };
}
