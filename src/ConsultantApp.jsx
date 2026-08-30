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

function BedLoadingInline() {
  return (
    <div className="empty" style={{ paddingTop: 60 }}>
      <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
      <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>Loading…</div>
    </div>
  );
}

const CONSULTANT_CFG = {
  role: "CONSULTANT",
  readOnly: true,
  listBeds: (wardId) => api.consultantBeds(wardId),
  payerTypes: () => api.consultantPayerTypes(),
};

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

// ── My Patients page ────────────────────────────────────────────────────────
function MyPatientsPage({ visible, onSubTitle }) {
  const [patients, setPatients] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedBed, setSelectedBed] = useState(null);
  const saveBedScroll = useScrollRestore(!!selectedBed);
  const [loadingBed, setLoadingBed] = useState(false);
  const [toast, setToast] = useState("");
  const [payerTypes, setPayerTypes] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [openWard, setOpenWard] = useState(null);
  const saveWardScroll = useScrollRestore(!!openWard);
  const [bedSearch, setBedSearch] = useState("");
  const [bedFilter, setBedFilter] = useState("ALL");
  const [viewMode, setViewMode] = useState("table");
  const [sortBy, setSortBy] = useState("ward-asc");
  const [filterDept, setFilterDept] = useState("");
  const [filterPayer, setFilterPayer] = useState("");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(5);

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2000); }, []);

  useEffect(() => { setPage(1); }, [search, sortBy, rowsPerPage, filterDept, filterPayer]);

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

  // Pre-fetch the ward's beds as soon as the user drills into a ward, so
  // tapping a card resolves from cache instantly — same UX as PRE's grid
  // where the beds are already in state when you see them.
  useEffect(() => {
    if (!openWard) return;
    if (getWardBeds(openWard.key)) return;
    api.consultantBeds(openWard.key).then(r => setWardBeds(openWard.key, r.beds || [])).catch(() => {});
  }, [openWard]);

  useEffect(() => {
    if (!onSubTitle) return;
    if (selectedBed) onSubTitle(selectedBed.bed_name || "Bed");
    else if (openWard) onSubTitle(openWard.wardName);
    else onSubTitle(null);
  }, [openWard, selectedBed, onSubTitle]);

  useEffect(() => {
    if (openWard || selectedBed) document.body.classList.add("ward-focus");
    else document.body.classList.remove("ward-focus");
    return () => document.body.classList.remove("ward-focus");
  }, [openWard, selectedBed]);

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
        onClose={() => setSelectedBed(null)}
        onChanged={() => {}}
        onToast={showToast}
        payerTypes={payerTypes}
        departments={departments}
      />
    );
  }

  const deptOptions = patients ? [...new Set(patients.map(p => p.department_name).filter(Boolean))].sort() : [];
  const payerOptions = patients ? [...new Set(patients.map(p => p.payer_type).filter(Boolean))].sort() : [];

  const filtered = patients
    ? patients.filter(p => {
        if (filterDept && p.department_name !== filterDept) return false;
        if (filterPayer && p.payer_type !== filterPayer) return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return (p.bed_name || "").toLowerCase().includes(q)
          || (p.ward_name || "").toLowerCase().includes(q)
          || (p.ip_last6 || "").toLowerCase().includes(q)
          || (p.payer_type || "").toLowerCase().includes(q)
          || (p.consultant_name || "").toLowerCase().includes(q)
          || (p.department_name || "").toLowerCase().includes(q)
          || (p.admission_type || "").toLowerCase().includes(q)
          || (p.destination || "").toLowerCase().includes(q);
      })
    : null;

  const wardGroups = filtered ? (() => {
    const map = new Map();
    for (const p of filtered) {
      const key = p.ward_id ?? p.ward_name ?? "—";
      if (!map.has(key)) map.set(key, { key, wardName: p.ward_name || "—", patients: [] });
      map.get(key).patients.push(p);
    }
    return [...map.values()].sort((a, b) => a.wardName.localeCompare(b.wardName));
  })() : [];

  const allWardGroups = patients ? (() => {
    const map = new Map();
    for (const p of patients) {
      const key = p.ward_id ?? p.ward_name ?? "—";
      if (!map.has(key)) map.set(key, { key, wardName: p.ward_name || "—", patients: [] });
      map.get(key).patients.push(p);
    }
    return [...map.values()];
  })() : [];

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

  const sparkPath = (values) => {
    if (!values.length) return { line: "", area: "" };
    const max = Math.max(...values, 1);
    const pts = values.map((v, i) => [i * (60 / Math.max(values.length - 1, 1)), 24 - (v / max) * 20]);
    const line = "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
    const area = line + ` L${pts[pts.length - 1][0].toFixed(1)} 28 L0 28 Z`;
    return { line, area };
  };
  const totalSpark = allWardGroups.map(g => g.patients.length);
  const dlSpark = allWardGroups.map(g => g.patients.filter(p => p.ward_name === "Discharge Lounge").length);
  const dtSpark = allWardGroups.map(g => g.patients.filter(p => { const dt = p.discharge_tracking; return dt && dt.planned_date === todayStr && dt.status !== "COMPLETED" && dt.status !== "CANCELLED"; }).length);
  const totalPages = Math.max(1, Math.ceil(sortedWardGroups.length / rowsPerPage));
  const pageClamped = Math.min(page, totalPages);
  const pageStart = (pageClamped - 1) * rowsPerPage;
  const pagedWardGroups = sortedWardGroups.slice(pageStart, pageStart + rowsPerPage);

  if (openWard) {
    const group = wardGroups.find((g) => g.key === openWard.key);
    const groupPatients = group ? group.patients : [];
    const bq = bedSearch.trim().toLowerCase();
    const filteredBeds = groupPatients.filter((p) => {
      if (bedFilter === "DISCHARGE" && !p.discharge_tracking) return false;
      if (bedFilter === "CASH" && p.payer_type !== "Cash") return false;
      if (bedFilter === "INSURANCE" && p.payer_type === "Cash") return false;
      if (!bq) return true;
      return (p.bed_name || "").toLowerCase().includes(bq)
        || (p.ip_last6 || "").toLowerCase().includes(bq)
        || (p.patient_name || "").toLowerCase().includes(bq)
        || (p.payer_type || "").toLowerCase().includes(bq)
        || (p.admission_type || "").toLowerCase().includes(bq)
        || (p.destination || "").toLowerCase().includes(bq);
    });
    const allPatientNames = [...new Set(groupPatients.map((p) => p.patient_name).filter(Boolean))].sort();
    const nameSuggestions = bq
      ? allPatientNames.filter((n) => n.toLowerCase().includes(bq))
      : [];
    const fc = {
      ALL: groupPatients.length,
      DISCHARGE: groupPatients.filter((p) => p.discharge_tracking).length,
      CASH: groupPatients.filter((p) => p.payer_type === "Cash").length,
      INSURANCE: groupPatients.filter((p) => p.payer_type && p.payer_type !== "Cash").length,
    };
    return (
      <div className="slide-up">
        <BackBtn label="Back to wards" onClick={() => { setOpenWard(null); setBedSearch(""); setBedFilter("ALL"); }} style={{ marginBottom: 14 }} />
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-.01em" }}>{openWard.wardName}</div>
          <div className="dim" style={{ fontSize: 12 }}>{groupPatients.length} patient{groupPatients.length !== 1 ? "s" : ""}</div>
        </div>

        <div className="pill-search" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <div className="field-search" style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex" }}>
              <Ic d={icons.search} s={15} />
            </span>
            <input
              className="field"
              value={bedSearch}
              placeholder="Search bed, patient, IP…"
              style={{ paddingLeft: 38, paddingRight: bedSearch ? 36 : 15 }}
              onChange={(e) => setBedSearch(e.target.value)}
            />
            {bedSearch && (
              <button
                onClick={() => setBedSearch("")}
                aria-label="Clear search"
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "flex", padding: 4, background: "none", border: "none", cursor: "pointer" }}
              >
                <Ic d={icons.x} s={14} />
              </button>
            )}
            {nameSuggestions.length > 0 && (
              <div className="mp2-suggest">
                {nameSuggestions.slice(0, 5).map((name) => (
                  <button key={name} className="mp2-suggest-item" onClick={() => setBedSearch(name)}>
                    <Ic d={icons.users} s={13} />
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {allPatientNames.length > 0 && (
            <select className="field mp2-filter" value="" onChange={(e) => { if (e.target.value) setBedSearch(e.target.value); }}
              style={{ flex: "0 0 auto", width: "auto", maxWidth: 160, borderRadius: 99, fontSize: 13 }}>
              <option value="">Patient</option>
              {allPatientNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
        </div>
        <div className="chip-row" role="group" aria-label="Filter beds">
          {[
            { key: "ALL", label: "All" },
            { key: "DISCHARGE", label: "Discharge" },
            { key: "CASH", label: "Cash" },
            { key: "INSURANCE", label: "Insurance" },
          ].filter((o) => o.key === "ALL" || fc[o.key] > 0).map((o) => (
            <button key={o.key}
              className={"fchip" + (bedFilter === o.key ? " on" : "")}
              aria-pressed={bedFilter === o.key}
              onClick={() => setBedFilter(o.key)}>
              {o.label} <span className="n">({fc[o.key]})</span>
            </button>
          ))}
        </div>

        <div style={{ position: "relative", marginTop: 10 }}>
          {filteredBeds.length === 0 ? (
            <div className="card empty" style={{ padding: 24, textAlign: "center" }}>
              <Ic d={icons.search} s={24} />
              <div style={{ marginTop: 8, fontWeight: 600, fontSize: 13 }}>No beds match</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>
                {bq ? `No bed or IP matching "${bedSearch.trim()}" in this filter.` : "No beds in this filter."}
              </div>
              {(bq || bedFilter !== "ALL") && (
                <button className="btn btn-ghost" style={{ marginTop: 12, fontSize: 12, padding: "8px 14px" }}
                  onClick={() => { setBedSearch(""); setBedFilter("ALL"); }}>
                  Clear search & filters
                </button>
              )}
            </div>
          ) : (
            <div className="pbed-grid">
              {filteredBeds.map((p) => (
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
          )}
          {loadingBed && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--bg) 75%, transparent)", borderRadius: 8, zIndex: 2 }}>
              <span className="spin"><Ic d={icons.refresh} s={22} /></span>
            </div>
          )}
        </div>
        {toast && <div className="toast show">{toast}</div>}
      </div>
    );
  }

  return (<>
    <div className="slide-up mp2">

      {error && (
        <div className="mp2-notice mp2-notice-err">
          <Ic d={icons.alert} s={18} />
          <span>{error}</span>
          <button onClick={load}>Retry</button>
        </div>
      )}

      {!error && patients === null && (
        <div className="mp2-center"><span className="spin"><Ic d={icons.refresh} s={22} /></span></div>
      )}

      {!error && patients !== null && patients.length === 0 && (
        <div className="mp2-center">
          <Ic d={icons.bed} s={28} style={{ color: "var(--ink-3)" }} />
          <div style={{ fontWeight: 700, fontSize: 15, marginTop: 12 }}>No patients assigned</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>Beds with your name will appear here once admitted.</div>
        </div>
      )}

      {!error && patients !== null && patients.length > 0 && (
        <>
          {/* ── KPI cards ── */}
          <div className="mp2-kpis">
            <div className="mp2-kpi mp2-kpi-green">
              <div className="mp2-kpi-ico"><Ic d={icons.users} s={16} /></div>
              <div className="mp2-kpi-body">
                <div className="mp2-kpi-val">{totalPatientsCount}</div>
                <div className="mp2-kpi-lbl">Total Patients</div>
              </div>
              <svg className="mp2-kpi-spark" viewBox="0 0 64 28"><path className="mp2-spark-fill" d={sparkPath(totalSpark).area}/><path d={sparkPath(totalSpark).line} stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/></svg>
            </div>
            <div className="mp2-kpi mp2-kpi-purple">
              <div className="mp2-kpi-ico"><Ic d={icons.exchange} s={16} /></div>
              <div className="mp2-kpi-body">
                <div className="mp2-kpi-val">{dischargeLoungeCount}</div>
                <div className="mp2-kpi-lbl">Discharge Lounge</div>
              </div>
              <svg className="mp2-kpi-spark" viewBox="0 0 64 28"><path className="mp2-spark-fill" d={sparkPath(dlSpark).area}/><path d={sparkPath(dlSpark).line} stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/></svg>
            </div>
            <div className="mp2-kpi mp2-kpi-orange">
              <div className="mp2-kpi-ico"><Ic d={icons.clock} s={16} /></div>
              <div className="mp2-kpi-body">
                <div className="mp2-kpi-val">{dischargeTodayCount}</div>
                <div className="mp2-kpi-lbl">Discharge Today</div>
              </div>
              <svg className="mp2-kpi-spark" viewBox="0 0 64 28"><path className="mp2-spark-fill" d={sparkPath(dtSpark).area}/><path d={sparkPath(dtSpark).line} stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/></svg>
            </div>
          </div>

          {/* ── Toolbar ── */}
          <div className="mp2-search">
            <Ic d={icons.search} s={14} />
            <input
              placeholder="Search by ward name, bed, IP number, doctor, department…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="mp2-search-x" onClick={() => setSearch("")} aria-label="Clear search">
                <Ic d={icons.x} s={12} />
              </button>
            )}
          </div>
          <div className="mp2-bar">
            <div className="mp2-filters">
              <select className="mp2-filter" value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                <option value="">All Departments</option>
                {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select className="mp2-filter" value={filterPayer} onChange={(e) => setFilterPayer(e.target.value)}>
                <option value="">All Payers</option>
                {payerOptions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="mp2-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="ward-asc">Ward A–Z</option>
                <option value="count-desc">Most Patients</option>
              </select>
              <button className="mp2-clear" onClick={() => { setSearch(""); setFilterDept(""); setFilterPayer(""); }} disabled={!search && !filterDept && !filterPayer}>
                <Ic d={icons.x} s={11} /> Clear
              </button>
            </div>
            <div className="mp2-vtog">
              <button className={viewMode === "table" ? "on" : undefined} onClick={() => setViewMode("table")} aria-label="Table view">
                <Ic d={icons.list} s={14} />
              </button>
              <button className={viewMode === "card" ? "on" : undefined} onClick={() => setViewMode("card")} aria-label="Card view">
                <Ic d={icons.grid} s={14} />
              </button>
            </div>
          </div>

          {/* ── Ward list header ── */}
          <div className="mp2-list-head">
            <span>Wards Overview</span>
            <span className="mp2-list-count">{sortedWardGroups.length} ward{sortedWardGroups.length !== 1 ? "s" : ""}</span>
          </div>

          {/* ── Ward list ── */}
          <div>
          {sortedWardGroups.length === 0 ? (
            <div className="mp2-no-match">No wards match your search.</div>
          ) : viewMode === "table" ? (
            <>
              {/* Desktop table — Jira-style */}
              <div className="mp2-tbl-wrap mp-tbl-desktop">
                <table className="mp2-tbl">
                  <thead>
                    <tr>
                      <th>Ward</th>
                      <th>Patients</th>
                      <th>Discharge Today</th>
                      <th className="mp2-th-arr" />
                    </tr>
                  </thead>
                  <tbody>
                    {pagedWardGroups.map((g) => {
                      const dToday = g.patients.filter(p => { const dt = p.discharge_tracking; return dt && dt.planned_date === todayStr && dt.status !== "COMPLETED" && dt.status !== "CANCELLED"; }).length;
                      return (
                      <tr key={g.key} onClick={() => { saveWardScroll(); setOpenWard({ key: g.key, wardName: g.wardName }); }}>
                        <td>
                          <div className="mp2-ward-cell">
                            <span className="mp2-ward-sq" style={{ background: wardAvatarColor(g.key) }}>
                              {wardInitials(g.wardName)}
                            </span>
                            {g.wardName}
                          </div>
                        </td>
                        <td><span className="mp2-badge mp2-badge-blue">{g.patients.length}</span></td>
                        <td>{dToday > 0 ? <span className="mp2-badge mp2-badge-orange">{dToday}</span> : <span className="dim">0</span>}</td>
                        <td className="mp2-td-arr"><Ic d={icons.chevron} s={14} /></td>
                      </tr>);
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile stacked rows */}
              <div className="mp-tbl-mobile">
                {pagedWardGroups.map((g) => (
                  <div key={g.key} className="mp2-mrow" onClick={() => { saveWardScroll(); setOpenWard({ key: g.key, wardName: g.wardName }); }}>
                    <div className="mp2-ward-cell">
                      <span className="mp2-ward-sq" style={{ background: wardAvatarColor(g.key) }}>
                        {wardInitials(g.wardName)}
                      </span>
                      <span className="mp2-mrow-name">{g.wardName}</span>
                    </div>
                    <div className="mp2-mrow-r">
                      <span className="mp2-mrow-ct">{g.patients.length}</span>
                      <Ic d={icons.chevron} s={14} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="mp2-cards">
              {pagedWardGroups.map((g) => (
                <div className="mp2-wcard" key={g.key} onClick={() => { saveWardScroll(); setOpenWard({ key: g.key, wardName: g.wardName }); }}>
                  <span className="mp2-wcard-bar" style={{ background: wardAvatarColor(g.key) }} />
                  <div className="mp2-wcard-body">
                    <div className="mp2-wcard-name">{g.wardName}</div>
                    <div className="mp2-wcard-ct">{g.patients.length} patient{g.patients.length !== 1 ? "s" : ""}</div>
                  </div>
                  <Ic d={icons.chevron} s={14} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
                </div>
              ))}
            </div>
          )}
          </div>

        </>
      )}

      {loadingBed && <BedLoadingInline />}
      {toast && <div className="toast show">{toast}</div>}
    </div>
    {visible && !error && patients !== null && patients.length > 0 && sortedWardGroups.length > 0 && !openWard && !selectedBed && createPortal(
      <div className="mp2-pag">
        <span className="mp2-pag-info">
          {pageStart + 1}–{Math.min(pageStart + rowsPerPage, sortedWardGroups.length)} of {sortedWardGroups.length} wards
        </span>
        <div className="mp2-pag-r">
          <button disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)} aria-label="Previous page">
            <Ic d={icons.chevron} s={13} style={{ transform: "rotate(180deg)" }} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
            <button key={n} className={n === pageClamped ? "on" : undefined} onClick={() => setPage(n)}>{n}</button>
          ))}
          <button disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)} aria-label="Next page">
            <Ic d={icons.chevron} s={13} />
          </button>
          <select value={rowsPerPage} onChange={(e) => setRowsPerPage(Number(e.target.value))} aria-label="Rows per page">
            <option value={5}>5 / page</option>
            <option value={10}>10 / page</option>
            <option value={25}>25 / page</option>
          </select>
        </div>
      </div>, document.body
    )}
  </>);
}

// ══════════════════════════════════════════════════════════════════════════════
//  CONSULTANT APP
// ══════════════════════════════════════════════════════════════════════════════
export default function ConsultantApp({ user, meta, onLogout }) {
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState("");
  const [mpSubTitle, setMpSubTitle] = useState(null);
  const dashboardData = useLiveBedDashboardData("consultant", tab === "dashboard");
  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2600); }, []);

  const menu = [
    { key: "dashboard",   icon: icons.home,        label: "Dashboard" },
    { key: "mypatients",  icon: icons.bed,          label: "My Patients" },
    { key: "discharges",  icon: icons.clipboard,   label: "My Discharges" },
  ];

  const baseTitle = menu.find((m) => m.key === tab)?.label || "Consultant";
  const title = tab === "mypatients" && mpSubTitle ? mpSubTitle : baseTitle;

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
        <div style={{ display: tab === "mypatients" ? "block" : "none" }}>
          <MyPatientsPage showToast={showToast} visible={tab === "mypatients"} onSubTitle={setMpSubTitle} />
        </div>
        {tab === "discharges" && <DischargesPage role="CONSULTANT" />}

        {toast && <div className="toast">{toast}</div>}
      </AppShell>
    </div>
  );
}
