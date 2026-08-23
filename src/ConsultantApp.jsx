import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { api, toastErr, getSocket, getWardBeds, setWardBeds } from "./lib.js";
import { Ic, icons, ThemeToggle, useScrollRestore } from "./ui.jsx";
import { AppShell } from "./shell.jsx";
import { LiveBedDashboard, useLiveBedDashboardData } from "./COOApp.jsx";
import DischargesPage from "./DischargesPage.jsx";
import { BedGridCard, BedDetailSheet, BackBtn } from "./PREApp.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────
const initialsOf = (s) => (s || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

// Spinner shown while a tapped bed's details are fetched.
//
// This used to be a body-portaled `.overlay` — a full-screen dark scrim with a
// backdrop blur. Every other role shows loading as a plain inline block instead
// (FCApp, NurseApp, DoctorApp, PharmacyApp, PWOApp, COOApp and main.jsx all use
// this exact markup), so blacking out the screen made Consultant look like a
// different product. It is the same in-page wait as everywhere else, so it now
// looks like it.
//
// Dropping the portal also retires the containing-block problem the old comment
// documented: `.overlay` is position:fixed, and both call sites sit inside a
// `.slide-up` whose transform made it the containing block, so `inset:0`
// resolved against the page rather than the viewport. Nothing here is fixed, so
// none of that applies.
function BedLoadingInline() {
  return (
    <div className="empty" style={{ paddingTop: 60 }}>
      <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
      <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>Loading…</div>
    </div>
  );
}

// Consultant cfg — same WardPage as PRE/Nurse but readOnly=true locks all bed edits;
// only the DischargeTab (role="CONSULTANT") remains interactive.
const CONSULTANT_CFG = {
  role: "CONSULTANT",
  readOnly: true,
  listBeds: (wardId) => api.consultantBeds(wardId),
  payerTypes: () => api.consultantPayerTypes(),
  // updateBedStatus intentionally absent → no status save
  // updateAdmission intentionally absent → no Edit Patient Info button
  // reviewWard intentionally absent → no Review button
};

// IST day string, matching how discharge_tracking.planned_date is stored
// server-side (see planDischarge in dischargeService.ts) — needed to compare
// "is this patient's planned discharge today" correctly regardless of the
// browser's own timezone.
function todayIST() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const WARD_AVATAR_COLORS = ["#0d9488", "#2563eb", "#7c3aed", "#d97706", "#dc2626", "#0891b2"];
function wardAvatarColor(key) {
  const s = String(key);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return WARD_AVATAR_COLORS[h % WARD_AVATAR_COLORS.length];
}
function wardInitials(name) {
  const words = (name || "?").trim().split(/\s+/);
  return words.length > 1
    ? (words[0][0] + words[1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}

// ── My Patients page — flat bed grid with ward label on each card ────────────
// Real-time: this page stays mounted for the whole ConsultantApp session (see
// the always-rendered/CSS-hidden wrapper in ConsultantApp below) and keeps its
// own dedicated socket listener for "consultant:patient-update" — a targeted,
// ownership-scoped event (never broadcast to "overview"). Every patient/discharge
// action anywhere in the app that touches one of this consultant's admissions
// patches the in-memory `patients` array directly; the only REST call is the
// one-time initial load. No polling, no refetch-on-every-event, no page reload.
function MyPatientsPage() {
  const [patients, setPatients] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedBed, setSelectedBed] = useState(null);
  // Opening a bed replaces this whole page with BedDetailSheet — save/restore
  // scroll across that swap. saveBedScroll() must be called wherever
  // selectedBed is opened, before setSelectedBed.
  const saveBedScroll = useScrollRestore(!!selectedBed);
  const [loadingBed, setLoadingBed] = useState(false);
  const [toast, setToast] = useState("");
  const [payerTypes, setPayerTypes] = useState([]);
  // No `destinations` here on purpose: BedDetailSheet only uses that list for
  // ReservationPopup, which a read-only CONSULTANT_CFG can never open. It used
  // to be declared and passed while nothing ever set it, so it was permanently
  // [] — dead state that read like an oversight. The sheet already defaults the
  // prop to [], so omitting it says the same thing honestly.
  const [departments, setDepartments] = useState([]);
  // Which ward's patient list is currently open — same "grid of cards, click
  // one to drill in" flow as PRE Entry's ward-card → WardPage, just landing on
  // this ward's own patient grid instead of a full bed-management page.
  const [openWard, setOpenWard] = useState(null); // { key, wardName } | null
  // saveWardScroll() must be called wherever openWard is opened, before
  // setOpenWard — see useScrollRestore's doc comment for why.
  const saveWardScroll = useScrollRestore(!!openWard);
  const [viewMode, setViewMode] = useState("table"); // "table" | "card"
  const [sortBy, setSortBy] = useState("ward-asc"); // "ward-asc" | "count-desc"
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(5);

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2000); }, []);

  // Must sit above any early return (selectedBed/openWard below) — hooks can't
  // be called conditionally, so this can't live further down with the values
  // it actually depends on.
  useEffect(() => { setPage(1); }, [search, sortBy, rowsPerPage]);

  const load = useCallback(async () => {
    setError("");
    try { setPatients((await api.consultantMyPatients()).patients || []); }
    catch (e) { setError(toastErr(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.consultantPayerTypes?.().then(r => setPayerTypes(r.payerTypes || [])).catch(() => {});
    api.departments().then(r => setDepartments(r.departments || [])).catch(() => {});
  }, []);

  // Dedicated socket, separate from ConsultantApp's dashboard-refresh socket —
  // this one only ever receives events this consultant actually owns (room-scoped
  // server-side), so every event here is guaranteed relevant, no filtering needed.
  useEffect(() => {
    const socket = getSocket();
    const onPatientUpdate = (payload) => {
      if (!payload || typeof payload !== "object") return;
      const { action, admission_id } = payload;
      setPatients((prev) => {
        if (!prev) return prev;
        if (action === "REMOVE") {
          return prev.filter((p) => p.admission_id !== admission_id);
        }
        // UPSERT — replace the matching row if present, otherwise add it.
        const idx = prev.findIndex((p) => p.admission_id === admission_id);
        if (idx === -1) return [...prev, payload];
        const next = prev.slice();
        next[idx] = payload;
        return next;
      });
    };
    socket.on("consultant:patient-update", onPatientUpdate);
    return () => socket.off("consultant:patient-update", onPatientUpdate);
  }, []);

  // A patient card only needs ONE bed, but the endpoint returns the whole ward —
  // so this used to pay a full round-trip per tap, which is what the spinner was
  // covering. The ward-beds cache in lib.js already holds that list and is
  // dropped the moment anything could have changed it, so a ward opened before
  // resolves instantly with no request and no spinner at all. A miss falls back
  // to the fetch and populates the cache for the next tap.
  const openBed = async (p) => {
    saveBedScroll();

    const cached = getWardBeds(p.ward_id);
    const hit = cached?.find((b) => b.id === p.bed_id);
    if (hit) { setSelectedBed(hit); return; }

    setLoadingBed(true);
    try {
      const result = await api.consultantBeds(p.ward_id);
      const beds = result.beds || [];
      setWardBeds(p.ward_id, beds);
      const fullBed = beds.find(b => b.id === p.bed_id);
      if (fullBed) {
        setSelectedBed(fullBed);
      } else {
        showToast("Bed not found");
      }
    } catch (e) { showToast(toastErr(e)); }
    finally { setLoadingBed(false); }
  };

  if (selectedBed) {
    return (
      <BedDetailSheet
        bed={selectedBed}
        cfg={CONSULTANT_CFG}
        // No load() here — every discharge action a CONSULTANT can take (plan,
        // reschedule, initiate, step updates) already emits a targeted
        // consultant:patient-update event that patches `patients` directly.
        onClose={() => setSelectedBed(null)}
        onChanged={() => {}}
        onToast={showToast}
        payerTypes={payerTypes}
        departments={departments}
      />
    );
  }

  const filtered = patients
    ? patients.filter(p => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (p.bed_name || "").toLowerCase().includes(q)
          || (p.ward_name || "").toLowerCase().includes(q)
          || (p.ip_last6 || "").toLowerCase().includes(q)
          || (p.payer_type || "").toLowerCase().includes(q);
      })
    : null;

  // Ward-wise grouping — same idea as PRE Entry's ward-card grid, keyed by
  // this consultant's own patients instead of ward-wide bed stats. ward_id is
  // preferred over ward_name for the key (two wards could share a display
  // name); alphabetical by name matches every other grouped view in the app.
  const wardGroups = filtered ? (() => {
    const map = new Map();
    for (const p of filtered) {
      const key = p.ward_id ?? p.ward_name ?? "—";
      if (!map.has(key)) map.set(key, { key, wardName: p.ward_name || "—", patients: [] });
      map.get(key).patients.push(p);
    }
    return [...map.values()].sort((a, b) => a.wardName.localeCompare(b.wardName));
  })() : [];

  // Top stat cards — computed from the full unfiltered patient list, not
  // `filtered`, so typing in the search box doesn't change these summary
  // numbers out from under the user.
  const totalPatientsCount = patients ? patients.length : 0;
  const dischargeLoungeCount = patients ? patients.filter((p) => p.ward_name === "Discharge Lounge").length : 0;
  const todayStr = todayIST();
  const dischargeTodayCount = patients ? patients.filter((p) => {
    const dt = p.discharge_tracking;
    return dt && dt.planned_date === todayStr && dt.status !== "COMPLETED" && dt.status !== "CANCELLED";
  }).length : 0;

  const sortedWardGroups = [...wardGroups].sort((a, b) =>
    sortBy === "count-desc" ? b.patients.length - a.patients.length : a.wardName.localeCompare(b.wardName)
  );
  const totalPages = Math.max(1, Math.ceil(sortedWardGroups.length / rowsPerPage));
  const pageClamped = Math.min(page, totalPages);
  const pageStart = (pageClamped - 1) * rowsPerPage;
  const pagedWardGroups = sortedWardGroups.slice(pageStart, pageStart + rowsPerPage);

  // Drilled into one ward — full-page swap, same pattern as PRE's WardPage.
  if (openWard) {
    const group = wardGroups.find((g) => g.key === openWard.key);
    const groupPatients = group ? group.patients : [];
    return (
      <div className="slide-up">
        <BackBtn label="Back to wards" onClick={() => setOpenWard(null)} style={{ marginBottom: 14 }} />
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-.01em" }}>{openWard.wardName}</div>
          <div className="dim" style={{ fontSize: 12 }}>{groupPatients.length} patient{groupPatients.length !== 1 ? "s" : ""}</div>
        </div>
        <div className="pbed-grid">
          {groupPatients.map((p) => (
            <BedGridCard
              key={p.bed_id}
              bed={{
                id: p.bed_id,
                bed_name: p.bed_name,
                physical_status: p.physical_status,
                reservation_status: p.reservation_status,
                operational_status: p.operational_status,
                destination: p.destination,
                reservation_note: p.reservation_note,
                updated_at: p.updated_at,
                ip_last6: p.ip_last6,
                consultant_name: p.consultant_name,
                department_name: p.department_name,
                payer_type: p.payer_type,
                admission_type: p.admission_type,
                discharge_tracking: p.discharge_tracking,
              }}
              hideDoctorDept
              onClick={() => openBed(p)}
            />
          ))}
        </div>
        {loadingBed && (
          <BedLoadingInline />
        )}
        {toast && <div className="toast show">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="slide-up">
      {/* No "My Patients" heading here — the AppShell topbar title already
          says it (see `title` in ConsultantApp below), so repeating it in the
          body was pure duplication. */}

      {error && (
        <div className="card empty" style={{ padding: "24px 20px" }}>
          <Ic d={icons.alert} s={28} />
          <div style={{ marginTop: 8, fontWeight: 600 }}>{error}</div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={load}>Retry</button>
        </div>
      )}

      {!error && patients === null && (
        <div className="empty" style={{ paddingTop: 60 }}>
          <span className="spin"><Ic d={icons.refresh} s={24} /></span>
        </div>
      )}

      {!error && patients !== null && patients.length === 0 && (
        <div className="card empty" style={{ padding: "32px 20px" }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "var(--panel-2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
            <Ic d={icons.bed} s={26} />
          </div>
          <div style={{ marginTop: 14, fontWeight: 700, fontSize: 15 }}>No patients assigned</div>
          <div className="dim" style={{ fontSize: 13, marginTop: 5 }}>Beds with your name will appear here once admitted.</div>
        </div>
      )}

      {!error && patients !== null && patients.length > 0 && (
        <>
          {/* Top stat cards — real counts only. No "vs yesterday" trend badges:
              there's no history of your own patient counts to compare against,
              and fabricating a percentage would be actively misleading here.
              Always 3-across (not card-grid's responsive collapse to 1 column)
              — small compact tiles, not full-width cards, even on a phone. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
            <div className="card" style={{ padding: "10px 8px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 4, minWidth: 0 }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, background: "var(--st-v-bg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Ic d={icons.users} s={13} style={{ color: "var(--st-v)" }} />
              </div>
              <div style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.1 }}>{totalPatientsCount}</div>
              <div className="dim" style={{ fontSize: 9.5, lineHeight: 1.2 }}>Total Patients</div>
            </div>
            <div className="card" style={{ padding: "10px 8px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 4, minWidth: 0 }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, background: "rgba(139,92,246,.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Ic d={icons.exchange} s={13} style={{ color: "#8b5cf6" }} />
              </div>
              <div style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.1 }}>{dischargeLoungeCount}</div>
              <div className="dim" style={{ fontSize: 9.5, lineHeight: 1.2 }}>Discharge Lounge</div>
            </div>
            <div className="card" style={{ padding: "10px 8px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 4, minWidth: 0 }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, background: "var(--st-o-bg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Ic d={icons.clock} s={13} style={{ color: "var(--st-o)" }} />
              </div>
              <div style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.1 }}>{dischargeTodayCount}</div>
              <div className="dim" style={{ fontSize: 9.5, lineHeight: 1.2 }}>Discharge Today</div>
            </div>
          </div>

          {/* Search (own row, full width) + sort/view-toggle (wrap together as
              one group below it) — keeps every control's baseline aligned
              instead of each wrapping independently at a different width. */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ position: "relative", marginBottom: 8 }}>
              <Ic d={icons.search} s={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", pointerEvents: "none" }} />
              <input className="field" placeholder="Search by ward name, bed no. or IP number…" value={search} onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: 32, fontSize: 13, height: 36, borderRadius: 10, width: "100%" }} />
            </div>
            {/* Shorter labels + tighter padding than a first pass would use —
                "Sort: Ward Name (A-Z)" + "Table View"/"Card View" don't fit
                one row on a phone; "Ward Name (A-Z)" + "Table"/"Card" do. */}
            <div className="row" style={{ gap: 6 }}>
              <select className="field" aria-label="Sort wards" value={sortBy} onChange={(e) => setSortBy(e.target.value)}
                style={{ width: "auto", minWidth: 0, flex: "1 1 auto", height: 32, fontSize: 11.5, fontWeight: 600, borderRadius: 10, paddingTop: 0, paddingBottom: 0, paddingLeft: 8, paddingRight: 8 }}>
                <option value="ward-asc">Ward Name (A-Z)</option>
                <option value="count-desc">Most Patients</option>
              </select>
              <button className="btn btn-ghost" onClick={() => setViewMode("table")}
                style={{ height: 32, fontSize: 11.5, padding: "0 8px", flexShrink: 0, background: viewMode === "table" ? "var(--st-v-bg)" : undefined, color: viewMode === "table" ? "var(--st-v)" : undefined }}>
                <Ic d={icons.list} s={13} /> Table
              </button>
              <button className="btn btn-ghost" onClick={() => setViewMode("card")}
                style={{ height: 32, fontSize: 11.5, padding: "0 8px", flexShrink: 0, background: viewMode === "card" ? "var(--st-v-bg)" : undefined, color: viewMode === "card" ? "var(--st-v)" : undefined }}>
                <Ic d={icons.grid} s={13} /> Card
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="row between" style={{ padding: "13px 16px", borderBottom: "1px solid var(--line)" }}>
              <div className="row" style={{ gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>Wards Overview</span>
                <span className="chip">{sortedWardGroups.length}</span>
              </div>
            </div>

            {sortedWardGroups.length === 0 ? (
              <div className="dim" style={{ padding: "22px 16px", textAlign: "center", fontSize: 13 }}>
                No wards match your search.
              </div>
            ) : viewMode === "table" ? (
              <>
                {/* ≥680px: real table. No Action column — the whole row is
                    the click target now, same as Card View's cards already are. */}
                <div className="tbl-wrap mp-tbl-desktop" style={{ border: "none", borderRadius: 0 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Ward</th>
                        <th style={{ textAlign: "center" }}>Total Patients</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedWardGroups.map((g) => (
                        <tr key={g.key} style={{ cursor: "pointer" }}
                          onClick={() => { saveWardScroll(); setOpenWard({ key: g.key, wardName: g.wardName }); }}>
                          <td>
                            <div className="row" style={{ gap: 10 }}>
                              <div style={{
                                width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                                background: wardAvatarColor(g.key), color: "#fff",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontWeight: 800, fontSize: 12,
                              }}>
                                {wardInitials(g.wardName)}
                              </div>
                              <span style={{ fontWeight: 700 }}>{g.wardName}</span>
                            </div>
                          </td>
                          <td style={{ textAlign: "center", fontWeight: 700 }}>{g.patients.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* <680px: same data, stacked full-width row-cards instead of a
                    cramped table — no horizontal scrolling/clipped columns. */}
                <div className="mp-tbl-mobile">
                  {pagedWardGroups.map((g) => (
                    <div key={g.key} className="mp-row-card"
                      onClick={() => { saveWardScroll(); setOpenWard({ key: g.key, wardName: g.wardName }); }}>
                      <div className="row" style={{ gap: 10, minWidth: 0 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                          background: wardAvatarColor(g.key), color: "#fff",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 800, fontSize: 12,
                        }}>
                          {wardInitials(g.wardName)}
                        </div>
                        <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.wardName}</span>
                      </div>
                      <div className="mp-row-card-stats">
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontWeight: 800, fontSize: 15 }}>{g.patients.length}</div>
                          <div className="dim" style={{ fontSize: 10 }}>Patients</div>
                        </div>
                        <Ic d={icons.chevron} s={15} style={{ color: "var(--ink-3)" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="card-grid" style={{ padding: 16 }}>
                {/* Same PRE Entry ward-card style, minus the "Complete" badge
                    (PRE's own round-status, not applicable here), the
                    Vacant/Occupied stat row (ward-wide bed occupancy, not
                    specific to this consultant's patients), and Manage Beds /
                    Discharges buttons (Consultant is read-only). */}
                {pagedWardGroups.map((g) => (
                  // Renders instantly, like BedGridCard — see PREApp's ward grid.
                  <div className="ward-card" key={g.key}
                    style={{ padding: 16, cursor: "pointer" }}
                    onClick={() => { saveWardScroll(); setOpenWard({ key: g.key, wardName: g.wardName }); }}>
                    <div className="row between">
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{g.wardName}</div>
                        <div className="dim" style={{ fontSize: 12 }}>{g.patients.length} patient{g.patients.length !== 1 ? "s" : ""}</div>
                      </div>
                      <Ic d={icons.chevron} s={16} style={{ color: "var(--ink-3)" }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {sortedWardGroups.length > 0 && (
              <div className="row between" style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", flexWrap: "wrap", gap: 10 }}>
                <span className="dim" style={{ fontSize: 12 }}>
                  Showing {pageStart + 1} to {Math.min(pageStart + rowsPerPage, sortedWardGroups.length)} of {sortedWardGroups.length} wards
                </span>
                <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <button className="btn btn-ghost" disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)}
                    style={{ padding: "6px 10px" }} aria-label="Previous page">
                    <Ic d={icons.chevron} s={13} style={{ transform: "rotate(180deg)" }} />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                    <button key={n} className="btn btn-ghost" onClick={() => setPage(n)}
                      style={{
                        padding: "6px 11px", minWidth: 32,
                        background: n === pageClamped ? "var(--st-v)" : undefined,
                        color: n === pageClamped ? "#fff" : undefined,
                      }}>
                      {n}
                    </button>
                  ))}
                  <button className="btn btn-ghost" disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)}
                    style={{ padding: "6px 10px" }} aria-label="Next page">
                    <Ic d={icons.chevron} s={13} />
                  </button>
                  <select className="field" aria-label="Rows per page" value={rowsPerPage}
                    onChange={(e) => setRowsPerPage(Number(e.target.value))}
                    style={{ width: "auto", minWidth: 88, height: 32, fontSize: 12, marginLeft: 8, paddingTop: 0, paddingBottom: 0, paddingLeft: 10, paddingRight: 10 }}>
                    <option value={5}>5 / page</option>
                    <option value={10}>10 / page</option>
                    <option value={25}>25 / page</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {loadingBed && (
        <BedLoadingInline />
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  CONSULTANT APP
// ══════════════════════════════════════════════════════════════════════════════
export default function ConsultantApp({ user, meta, onLogout }) {
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState("");
  // Lives here, above the tab switch, so it survives navigating away from and
  // back to the Dashboard tab — see useLiveBedDashboardData.
  const dashboardData = useLiveBedDashboardData("consultant", tab === "dashboard");
  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2600); }, []);

  // NOTE: there used to be a second socket effect here subscribing to
  // bed:update / discharge:update / discharge:overstay purely to bump a
  // `liveKey` counter. Nothing ever read that counter, so every bed change
  // anywhere in the hospital re-rendered this whole component for nothing.
  // The dashboard already refreshes itself through useLiveBedDashboardData
  // above, and the patient list is patched in place by the consultant:
  // patient-update handler further up — neither needed the bump.

  const menu = [
    { key: "dashboard",   icon: icons.home,        label: "Dashboard" },
    { key: "mypatients",  icon: icons.bed,          label: "My Patients" },
    { key: "discharges",  icon: icons.clipboard,   label: "My Discharges" },
  ];

  const title = menu.find((m) => m.key === tab)?.label || "Consultant";

  return (
    <div className="preui">
      <AppShell
        menu={menu}
        active={tab}
        onSelect={(k) => setTab(k)}
        title={title}
        user={{ name: user.name || user.username || "Consultant", role: "CONSULTANT" }}
        onLogout={onLogout}
        topExtra={null}
      >
        {tab === "dashboard" && (
          <LiveBedDashboard
            data={dashboardData}
            userName={user.name || user.username || "Consultant"}
            scope="consultant"
            hideUnitFilter
          />
        )}
        {/* Stays mounted across tab switches (CSS-hidden, not unmounted) — its
              patient list is kept live via its own dedicated socket listener, so
              unmounting/remounting here would force a full refetch and defeat
              the incremental real-time patching entirely. */}
        <div style={{ display: tab === "mypatients" ? "block" : "none" }}>
          <MyPatientsPage showToast={showToast} />
        </div>
        {tab === "discharges" && <DischargesPage role="CONSULTANT" />}

        {toast && <div className="toast">{toast}</div>}
      </AppShell>
    </div>
  );
}
