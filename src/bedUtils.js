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
// ── Discharge workflow badge (View Beds tiles) ──────────────────────────────
// Order mirrors the backend's step sequence — the badge shows the first step
// that's still PENDING, or a status-level label outside that sequence.
export const DISCHARGE_STEP_LABELS = [
  ["discharge_summary_status", "Discharge Summary"],
  ["drug_return_status", "Drug Return"],
  ["pharmacy_clearance_status", "Pharmacy Clearance"],
  ["procedure_reconciliation_status", "Procedure Reconciliation"],
  ["billing_started_status", "Bill Prep"],
  ["audit_status", "Audit"],
  ["bill_ready_status", "Bill Finalized"],
  ["payment_status", "Payment Status"],
  ["system_checkout_status", "System Checkout"],
  ["physical_checkout_status", "Physical Checkout"],
];

/** Some admissions have no IP on file — backfilled for beds that were already
 *  Occupied before the discharge module existed (no way to know it retroactively). */
export function fmtIpLast6(ipLast6) {
  return ipLast6 ? `IP …${ipLast6}` : "IP not recorded";
}

/** Friendly current-status label: On Bed / On Bed [Res] / Discharge Initiated / Vacant [Res] / Vacant. */
export function bedCurrentStatus(bed) {
  const occupied = bed.physical_status === "OCCUPIED";
  const reserved = bed.reservation_status === "RESERVED";
  const t = bed.discharge_tracking;
  if (occupied && t && ["DISCHARGE_INITIATED", "IN_PROGRESS"].includes(t.status)) return "Discharge In Progress";
  if (occupied && reserved) return "On Bed [Res]";
  if (occupied) return "On Bed";
  if (reserved) return "Vacant [Res]";
  return "Vacant";
}

/** Progress through the checklist: {done, total, pct} — N/A steps drop out of the
 *  denominator. Returns null when there's no active workflow to measure. */
export function dischargeProgress(tracking) {
  if (!tracking) return null;
  if (!["DISCHARGE_INITIATED", "IN_PROGRESS"].includes(tracking.status)) return null;
  const cols = DISCHARGE_STEP_LABELS.map(([col]) => col);
  const total = cols.filter((c) => tracking[c] !== "NOT_APPLICABLE").length;
  const done = cols.filter((c) => tracking[c] === "COMPLETED").length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** tracking = the discharge_tracking row for a bed's active admission, or null/undefined. */
export function dischargeBadge(tracking) {
  if (!tracking) return null;
  if (tracking.status === "CANCELLED" || tracking.status === "COMPLETED") return null;
  if (tracking.status === "PLANNED") {
    const today = new Date().toISOString().slice(0, 10);
    return tracking.planned_date === today ? "Planned Today" : "Planned";
  }
  if (tracking.status === "DISCHARGE_INITIATED") return "In Progress";
  for (const [col, label] of DISCHARGE_STEP_LABELS) {
    if (tracking[col] === "PENDING") return label;
  }
  return "In Progress";
}

// ── Discharge SLA / ETA ──────────────────────────────────────────────────────
// The backend computes phase state, deadlines and ETA (dischargeSlaService.ts)
// and returns them as `workflow` on discharge rows. These helpers only format —
// nothing here re-derives status, so every screen shows the same numbers.

/** Clock time for an epoch-ms value: "3:53 PM". */
export function fmtClock(ms) {
  if (ms == null) return null;
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Compact duration: 45 → "45m", 90 → "1h 30m". */
export function fmtMins(mins) {
  if (mins == null) return null;
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Colour + label for an overall workflow state. */
export function workflowTone(workflow) {
  if (!workflow) return null;
  if (workflow.state === "COMPLETED") return { label: "Completed", color: "var(--st-v)", bg: "var(--st-v-bg)" };
  if (workflow.state === "DELAYED") {
    const worst = Math.max(0, ...(workflow.phases || []).map(p => p.overdueMinutes || 0));
    return { label: worst ? `Delayed ${fmtMins(worst)}` : "Delayed", color: "var(--red)", bg: "var(--red-bg)" };
  }
  return { label: "On time", color: "var(--st-v)", bg: "var(--st-v-bg)" };
}

/** Colour for a single phase's state. */
export function phaseTone(state) {
  switch (state) {
    case "COMPLETED":      return { color: "var(--st-v)",  label: "Completed" };
    case "DELAYED":        return { color: "var(--red)",   label: "Delayed" };
    case "IN_PROGRESS":    return { color: "var(--primary)", label: "In Progress" };
    case "NOT_APPLICABLE": return { color: "var(--ink-3)", label: "Not Applicable" };
    default:               return { color: "var(--ink-3)", label: "Not started" };
  }
}

/** "ETA 3:53 PM" — null when there's no running workflow. */
export function fmtEta(workflow) {
  if (!workflow || workflow.eta == null) return null;
  const t = fmtClock(workflow.eta);
  return t ? `ETA ${t}` : null;
}

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
