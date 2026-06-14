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
