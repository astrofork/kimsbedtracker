import { io } from "socket.io-client";

// ---- API client ----
const TOKEN_KEY = "bedflow_token";
const USER_KEY = "bedflow_user";

const BASE_API = import.meta.env.VITE_API_URL ?? "";


export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } }
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// Shared by every discharge-list fetcher below that supports the Transaction
// Board drilldown's hospitalWide + unit params — first=? or & depending on
// whether the caller already has a "?step=..." etc. ahead of it.
function hwQuery(hospitalWide, unit, first = "?") {
  if (!hospitalWide) return "";
  const u = unit && unit !== "TOTAL" ? `&unit=${encodeURIComponent(unit)}` : "";
  return `${first}hospitalWide=true${u}`;
}

async function req(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const t = getToken();
  if (t) headers.Authorization = "Bearer " + t;
  const res = await fetch(BASE_API + "/api" + path, { ...opts, headers });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON response (e.g. nginx 502) — data stays {} */ }

  // Only treat 401 as a session-expiry event when the user already has a token.
  // Login requests have no token — their 401 ("Incorrect username or password.")
  // should fall through as a normal error so the login form can show the message.
  if (res.status === 401 && getToken()) {
    clearSession();
    // Notify the React app so it can reset its user state and show the Login screen.
    // We cannot use window.location.href = "/login" here because this is a state-driven
    // SPA with no real /login route — doing so causes a 404 or infinite reload.
    window.dispatchEvent(new CustomEvent("session:expired", {
      detail: { message: "Session expired. Please sign in again." }
    }));
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    // .status lets callers tell a real conflict (409 — someone else already
    // changed this data, safe to auto-refresh) apart from a validation error
    // (400 — the user needs to fix the form) without parsing message text.
    const err = new Error(data.error || `Request failed (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }


  return data;
}

// ── Reference-data cache ─────────────────────────────────────────────────────
// Payer types, destinations, departments, doctors and consultant groups are
// hospital-wide lists: the same answer for every ward and every bed, changed
// only by an admin editing Setup. They were re-fetched on every mount, so
// opening a ward cost 3 requests and opening a bed cost 3 more — visiting ten
// wards meant ~30 identical round-trips. A 304 does not help here: the browser
// still pays the full round-trip (~200ms each) to be told nothing changed.
//
// The PROMISE is cached rather than the resolved value, so several components
// mounting at once share ONE request instead of racing. A rejected request is
// evicted so a transient failure is never cached permanently.
const refCache = new Map();

function cachedGet(path) {
  if (!refCache.has(path)) {
    refCache.set(path, req(path).catch((e) => { refCache.delete(path); throw e; }));
  }
  return refCache.get(path);
}

/** Drop cached reference data. Called on logout / session-expiry (the next user
 *  may have a different role, and these lists are role-scoped), and whenever the
 *  server signals a payer-type edit — see getSocket() below. */
export function clearRefCache(path) {
  if (path) refCache.delete(path); else refCache.clear();
}

// ── Ward beds cache ──────────────────────────────────────────────────────────
// Re-entering a ward re-fetched its entire bed list even when nothing about that
// ward had changed since the last visit. The list is cached per ward and kept
// honest by the SAME socket events the screens already react to, so it can never
// be served stale:
//
//   • bed:update carrying the full row  -> patch that one bed; cache stays valid
//   • bed:update with no row, discharge:update, ward:operational
//                                       -> DROP that ward, so the next visit
//                                          refetches instead of guessing
//   • any such payload with no wardId   -> could touch any ward, so drop all
//   • a RECONNECT                       -> events were missed while offline,
//                                          nothing local is trustworthy, drop all
//
// An entry therefore only survives while we can prove nothing happened to it.
// Showing a stale bed on a ward is far worse than paying for one more request.
const wardBeds = new Map();

export function getWardBeds(wardId) { return wardBeds.get(Number(wardId)) ?? null; }
export function setWardBeds(wardId, beds) { wardBeds.set(Number(wardId), beds); }
export function clearWardBeds(wardId) {
  if (wardId == null) wardBeds.clear(); else wardBeds.delete(Number(wardId));
}

export const api = {
  // NOT cached, unlike the lists below. /meta carries `todayIST`, which the
  // admission-date picker uses as its upper bound — a session-long cache pins
  // that to whatever "today" was at login, so a tab left open across midnight
  // (routine on a 12-hour shift) started refusing today's date. /meta is also
  // not on the hot path this cache exists for: it's a handful of calls per
  // session, not three per ward and three per bed.
  meta: () => req("/meta"),
  departments: () => cachedGet("/departments"),
  // Only the unfiltered list is cached — the filtered form is keyed by
  // department and is not on the hot path that this cache exists for.
  doctors: (departmentId) => (departmentId
    ? req(`/doctors?department_id=${departmentId}`)
    : cachedGet("/doctors")),
  consultantGroups: () => cachedGet("/consultant-groups"),
  login: (username, password) =>
    req("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  preMe: () => req("/pre/me"),
  setWard: (wardId, vacant_none, vacant_reserved, occupied_none, occupied_reserved = 0) =>
    req("/pre/ward", { method: "POST", body: JSON.stringify({ wardId, vacant_none, vacant_reserved, occupied_none, occupied_reserved }) }),
  submitRound: () => req("/pre/submit", { method: "POST" }),
  cooOverview: () => req("/coo/overview"),
  cooLiveWards: () => req("/coo/live-wards"),
  cooBedDetails: () => req("/coo/bed-details"),
  cooConsultants: () => req("/coo/consultants"),
  cooPreActivity: () => req("/coo/pre-activity"),
  cooNurseActivity: () => req("/coo/nurse-activity"),
  cooAudit: () => req("/coo/audit"),
  cooActivity: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    const s = qs.toString();
    return req(`/coo/activity${s ? "?" + s : ""}`);
  },
  cooCompliance: () => req("/coo/compliance"),
  cooTat: (range = "7d") => req(`/coo/discharge-tat?range=${encodeURIComponent(range)}`),
  cooTatByPayer: (payer, range = "7d") => req(`/coo/discharge-tat-payer?payer=${encodeURIComponent(payer)}&range=${encodeURIComponent(range)}`),
  cooOverstay: () => req("/coo/overstay"),
  preOverstay: () => req("/pre/overstay"),
  nurseOverstay: () => req("/nurse/overstay"),
  cooOccupancyTrend: (range = "7d") => req(`/coo/occupancy-trend?range=${range}`),
  cooAdminDashboard: (unit) => req(`/coo/admin-dashboard${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  cooAdminDashboardHistory: (unit) => req(`/coo/admin-dashboard-history${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  cooSnapshots: () => req("/coo/snapshots"),
  // ── manager — KPIs ──────────────────────────────────────────────────────────
  mgrKpis: () => req("/manager/kpis"),
  // ── manager — building blocks ────────────────────────────────────────────────
  mgrBuildingBlocks: () => req("/manager/building-blocks"),
  mgrCreateBuildingBlock: (data) => req("/manager/building-blocks", { method: "POST", body: JSON.stringify(data) }),
  mgrEditBuildingBlock: (id, data) => req(`/manager/building-blocks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrDeleteBuildingBlock: (id) => req(`/manager/building-blocks/${id}`, { method: "DELETE" }),
  // ── manager — floors ─────────────────────────────────────────────────────────
  mgrFloors: () => req("/manager/floors"),
  mgrCreateFloor: (data) => req("/manager/floors", { method: "POST", body: JSON.stringify(data) }),
  mgrEditFloor: (id, data) => req(`/manager/floors/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrDeleteFloor: (id) => req(`/manager/floors/${id}`, { method: "DELETE" }),
  // ── manager — wards ─────────────────────────────────────────────────────────
  mgrUsers: () => req("/manager/users"),
  mgrUnitTypes: () => req("/manager/unit-types"),
  mgrWards: () => req("/manager/wards"),
  mgrCreateWard: (data) => req("/manager/wards", { method: "POST", body: JSON.stringify(data) }),
  mgrEditWard: (id, data) => req(`/manager/wards/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrDeleteWard: (id) => req(`/manager/wards/${id}`, { method: "DELETE" }),
  // ── manager — PRE users ──────────────────────────────────────────────────────
  mgrCreatePre: (data) => req("/manager/pre", { method: "POST", body: JSON.stringify(data) }),
  mgrEditPre: (id, data) => req(`/manager/pre/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrDeletePre: (id) => req(`/manager/pre/${id}`, { method: "DELETE" }),
  // ── manager — history ────────────────────────────────────────────────────────
  mgrHistoryDates: () => req("/manager/history/dates"),
  mgrCensusDates: () => req("/manager/history/census-dates"),
  mgrHistory: (date, preBlockId) =>
    req(`/manager/history?date=${date}${preBlockId != null ? "&preBlockId=" + preBlockId : ""}`),
  // ── manager — nursing stations ───────────────────────────────────────────────
  mgrNursingStations: () => req("/manager/nursing-stations"),
  mgrCreateStation: (data) => req("/manager/nursing-stations", { method: "POST", body: JSON.stringify(data) }),
  mgrEditStation: (id, data) => req(`/manager/nursing-stations/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrAssignStationWards: (id, wardIds) => req(`/manager/nursing-stations/${id}/wards`, { method: "PUT", body: JSON.stringify({ wardIds }) }),
  mgrDeleteStation: (id) => req(`/manager/nursing-stations/${id}`, { method: "DELETE" }),
  // ── manager — nurse access assignments ───────────────────────────────────────
  mgrNurseAccess: (p = {}) => {
    const qs = Object.keys(p).length ? "?" + new URLSearchParams(p) : "";
    return req(`/manager/nurse-access${qs}`);
  },
  mgrCreateNurseAccess: (data) =>
    req("/manager/nurse-access", { method: "POST", body: JSON.stringify(data) }),
  mgrEditNurseAccess: (id, data) =>
    req(`/manager/nurse-access/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrDeleteNurseAccess: (id) =>
    req(`/manager/nurse-access/${id}`, { method: "DELETE" }),
  // ── manager — nurse users ────────────────────────────────────────────────────
  mgrCreateNurse: (data) => req("/manager/nurses", { method: "POST", body: JSON.stringify(data) }),
  mgrEditNurse: (id, data) => req(`/manager/nurses/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrDeleteNurse: (id) => req(`/manager/nurses/${id}`, { method: "DELETE" }),
  mgrAddNurseStation: (nurseId, stationId) =>
    req(`/manager/nurses/${nurseId}/stations`, { method: "POST", body: JSON.stringify({ stationId }) }),
  mgrRemoveNurseStation: (nurseId, stationId) =>
    req(`/manager/nurses/${nurseId}/stations/${stationId}`, { method: "DELETE" }),
  mgrStationCoverage: (id) => req(`/manager/stations/${id}/coverage`),
  // ── manager — PRE Blocks ─────────────────────────────────────────────────────
  mgrPreBlocks: () => req("/manager/pre-blocks"),
  mgrPreBlock: (id) => req(`/manager/pre-blocks/${id}`),
  mgrCreatePreBlock: (data) => req("/manager/pre-blocks", { method: "POST", body: JSON.stringify(data) }),
  mgrEditPreBlock: (id, data) => req(`/manager/pre-blocks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrSetPreBlockStatus: (id, status) => req(`/manager/pre-blocks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  mgrDeletePreBlock: (id) => req(`/manager/pre-blocks/${id}`, { method: "DELETE" }),
  // ── manager — Doctor Blocks ──────────────────────────────────────────────────
  mgrDoctorBlocks: () => req("/manager/doctor-blocks"),
  mgrDoctorBlock: (id) => req(`/manager/doctor-blocks/${id}`),
  mgrCreateDoctorBlock: (data) => req("/manager/doctor-blocks", { method: "POST", body: JSON.stringify(data) }),
  mgrEditDoctorBlock: (id, data) => req(`/manager/doctor-blocks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrSetDoctorBlockStatus: (id, status) => req(`/manager/doctor-blocks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  mgrDeleteDoctorBlock: (id) => req(`/manager/doctor-blocks/${id}`, { method: "DELETE" }),
  // ── manager — Doctor users ───────────────────────────────────────────────────
  mgrCreateDoctor: (data) => req("/manager/doctors", { method: "POST", body: JSON.stringify(data) }),
  mgrEditDoctor: (id, data) => req(`/manager/doctors/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrDeleteDoctor: (id) => req(`/manager/doctors/${id}`, { method: "DELETE" }),
  // ── Doctor — dashboard, blocks, bed management ───────────────────────────────
  doctorMe: () => req("/doctor/me"),
  doctorBlock: (id) => req(`/doctor/blocks/${id}`),
  doctorBeds: (wardId, opts = {}) => {
    const params = new URLSearchParams();
    if (opts.physical_status) params.set("physical_status", opts.physical_status);
    if (opts.reservation_status) params.set("reservation_status", opts.reservation_status);
    const qs = params.toString();
    return req(`/doctor/wards/${wardId}/beds${qs ? "?" + qs : ""}`);
  },
  doctorPayerTypes: () => cachedGet("/doctor/payer-types"),
  doctorDestinations: () => cachedGet("/doctor/destinations"),
  // The trailing `admission` object is where new admission-time fields go from
  // here on. The positional list ahead of it is already at its practical limit —
  // adding a 14th and 15th slot for patient name/date would make every call site
  // a counting exercise, and a silently misordered argument is exactly the kind
  // of bug that reaches production intact.
  doctorUpdateBedStatus: (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId, consultantGroupId, { patientName, admissionDate } = {}) =>
    req(`/doctor/beds/${bedId}/status`, { method: "PATCH", body: JSON.stringify({ physical_status: physicalStatus, reservation_status: reservationStatus, payer_type: payerType ?? undefined, destination: destination ?? undefined, reservation_note: reservationNote ?? undefined, ip_last6: ipLast6 ?? undefined, patient_name: patientName ?? undefined, admission_date: admissionDate ?? undefined, admission_type: admissionType ?? undefined, department_name: departmentName ?? undefined, doctor_id: doctorId ?? undefined, department_id: departmentId ?? undefined, consultant_group_id: consultantGroupId ?? undefined }) }),
  doctorReview: (blockId) => req(`/doctor/blocks/${blockId}/review`, { method: "POST" }),
  doctorReviewWard: (wardId) => req(`/doctor/wards/${wardId}/review`, { method: "POST" }),
  doctorActivity: () => req("/doctor/activity"),
  doctorLiveWards: () => req("/doctor/live-wards"),
  doctorBedDetails: () => req("/doctor/bed-details"),
  // Scoped to the doctor's own blocks — used by Entry search. /bed-details stays
  // hospital-wide for the read-only Admin dashboard.
  doctorMyBedDetails: () => req("/doctor/my-bed-details"),
  doctorAdminDashboard: (unit) => req(`/doctor/admin-dashboard${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  doctorAdminDashboardHistory: (unit) => req(`/doctor/admin-dashboard-history${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  doctorSnapshots: () => req("/doctor/snapshots"),
  doctorConsultants: () => req("/doctor/consultants"),
  // ── manager — bed details (create/configure only) ────────────────────────────
  wardBeds: (wardId, opts = {}) => {
    const params = new URLSearchParams();
    if (opts.physical_status) params.set("physical_status", opts.physical_status);
    if (opts.reservation_status) params.set("reservation_status", opts.reservation_status);
    const qs = params.toString();
    return req(`/manager/wards/${wardId}/beds${qs ? "?" + qs : ""}`);
  },
  generateBeds: (wardId, bedNames, opts = {}) =>
    req(`/manager/wards/${wardId}/generate-beds`, { method: "POST", body: JSON.stringify({ bedNames, ...opts }) }),
  addBed: (wardId, bedName, opts = {}) =>
    req(`/manager/wards/${wardId}/beds`, { method: "POST", body: JSON.stringify({ bedName, ...opts }) }),
  renameBed: (bedId, bedName) =>
    req(`/manager/beds/${bedId}/name`, { method: "PATCH", body: JSON.stringify({ bedName }) }),
  updateBedMaster: (bedId, data) =>
    req(`/manager/beds/${bedId}/master`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteBed: (bedId) => req(`/manager/beds/${bedId}`, { method: "DELETE" }),
  // ── PRE — bed status management ──────────────────────────────────────────────
  preBeds: (wardId, opts = {}) => {
    const params = new URLSearchParams();
    if (opts.physical_status) params.set("physical_status", opts.physical_status);
    if (opts.reservation_status) params.set("reservation_status", opts.reservation_status);
    const qs = params.toString();
    return req(`/pre/wards/${wardId}/beds${qs ? "?" + qs : ""}`);
  },
  prePayerTypes: () => cachedGet("/pre/payer-types"),
  preDestinations: () => cachedGet("/pre/destinations"),
  preReviewWard: (wardId) => req(`/pre/wards/${wardId}/review`, { method: "POST" }),
  // Admin-style dashboard, scoped server-side to this PRE user's own wards.
  preLiveWards: () => req("/pre/live-wards"),
  preBedDetails: () => req("/pre/bed-details"),
  preAdminDashboard: (unit) => req(`/pre/admin-dashboard${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  preAdminDashboardHistory: (unit) => req(`/pre/admin-dashboard-history${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  preConsultants: () => req("/pre/consultants"),
  preSnapshots: () => req("/pre/snapshots"),
  preUpdateBedStatus: (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId, consultantGroupId, { patientName, admissionDate } = {}) =>
    req(`/pre/beds/${bedId}/status`, { method: "PATCH", body: JSON.stringify({ physical_status: physicalStatus, reservation_status: reservationStatus, payer_type: payerType ?? undefined, destination: destination ?? undefined, reservation_note: reservationNote ?? undefined, ip_last6: ipLast6 ?? undefined, patient_name: patientName ?? undefined, admission_date: admissionDate ?? undefined, admission_type: admissionType ?? undefined, department_name: departmentName ?? undefined, doctor_id: doctorId ?? undefined, department_id: departmentId ?? undefined, consultant_group_id: consultantGroupId ?? undefined }) }),
  // Corrects a data-entry mistake on an already-active admission (IP/type/consultant/dept)
  // — never changes physical/reservation status.
  // doctorId/consultantGroupId are passed through as-is (not `?? undefined`) —
  // when the owner is switched to a Consultant Group, doctorId is explicitly
  // `null`, and `?? undefined` would wrongly coerce that to "omitted", breaking
  // the backend's "both fields sent together" contract.
  // patientName/admissionDate use `?? undefined` deliberately, unlike
  // doctorId/consultantGroupId above: omitting them means "untouched, leave the
  // stored value alone", and there is no request that clears them back to blank.
  preUpdateAdmission: (bedId, { ipLast6, admissionType, patientName, admissionDate, departmentName, doctorId, departmentId, consultantGroupId, payerType }) =>
    req(`/pre/beds/${bedId}/admission`, { method: "PATCH", body: JSON.stringify({ ip_last6: ipLast6 ?? undefined, patient_name: patientName ?? undefined, admission_date: admissionDate ?? undefined, admission_type: admissionType ?? undefined, department_name: departmentName ?? undefined, doctor_id: doctorId, department_id: departmentId ?? undefined, consultant_group_id: consultantGroupId, payer_type: payerType }) }),
  // ── Nurse — bed management ───────────────────────────────────────────────────
  nurseMe: () => req("/nurse/me"),
  nurseBeds: (wardId, opts = {}) => {
    const params = new URLSearchParams();
    if (opts.physical_status) params.set("physical_status", opts.physical_status);
    if (opts.reservation_status) params.set("reservation_status", opts.reservation_status);
    const qs = params.toString();
    return req(`/nurse/wards/${wardId}/beds${qs ? "?" + qs : ""}`);
  },
  nursePayerTypes: () => cachedGet("/nurse/payer-types"),
  nurseDestinations: () => cachedGet("/nurse/destinations"),
  nurseReviewWard: (wardId) => req(`/nurse/wards/${wardId}/review`, { method: "POST" }),
  // Admin-style dashboard, scoped server-side to this nurse's own wards.
  nurseLiveWards: () => req("/nurse/live-wards"),
  nurseBedDetails: () => req("/nurse/bed-details"),
  nurseAdminDashboard: (unit) => req(`/nurse/admin-dashboard${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  nurseHospitalLiveWards: () => req("/nurse/hospital/live-wards"),
  nurseHospitalBedDetails: () => req("/nurse/hospital/bed-details"),
  nurseHospitalAdminDashboard: (unit) => req(`/nurse/hospital/admin-dashboard${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  nurseHospitalAdminDashboardHistory: (unit) => req(`/nurse/hospital/admin-dashboard-history${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  nurseHospitalConsultants: () => req("/nurse/hospital/consultants"),
  nurseHospitalSnapshots: () => req("/nurse/hospital/snapshots"),
  nurseUpdateBedStatus: (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId, consultantGroupId, { patientName, admissionDate } = {}) =>
    req(`/nurse/beds/${bedId}/status`, { method: "PATCH", body: JSON.stringify({ physical_status: physicalStatus, reservation_status: reservationStatus, payer_type: payerType ?? undefined, destination: destination ?? undefined, reservation_note: reservationNote ?? undefined, ip_last6: ipLast6 ?? undefined, patient_name: patientName ?? undefined, admission_date: admissionDate ?? undefined, admission_type: admissionType ?? undefined, department_name: departmentName ?? undefined, doctor_id: doctorId ?? undefined, department_id: departmentId ?? undefined, consultant_group_id: consultantGroupId ?? undefined }) }),
  pushSubscribe: (subscription) =>
    req("/push/subscribe", { method: "POST", body: JSON.stringify({ subscription }) }),
  mgrPayerTypes: () => cachedGet("/manager/payer-types"),
  mgrCreatePayerType: (name) => req("/manager/payer-types", { method: "POST", body: JSON.stringify({ name }) }),
  mgrUpdatePayerType: (id, data) => req(`/manager/payer-types/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrReorderPayerType: (id, direction) => req(`/manager/payer-types/${id}/order`, { method: "PATCH", body: JSON.stringify({ direction }) }),
  mgrDeletePayerType: (id) => req(`/manager/payer-types/${id}`, { method: "DELETE" }),
  mgrDestinations: () => cachedGet("/manager/destinations"),
  mgrCreateDestination: (name) => req("/manager/destinations", { method: "POST", body: JSON.stringify({ name }) }),
  mgrUpdateDestination: (id, data) => req(`/manager/destinations/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrReorderDestination: (id, direction) => req(`/manager/destinations/${id}/order`, { method: "PATCH", body: JSON.stringify({ direction }) }),
  mgrDeleteDestination: (id) => req(`/manager/destinations/${id}`, { method: "DELETE" }),
  // ── manager — Departments (master data, not part of the ward/floor hierarchy) ──
  mgrDepartments: () => req("/manager/departments"),
  mgrCreateDepartment: (name) => req("/manager/departments", { method: "POST", body: JSON.stringify({ name }) }),
  mgrUpdateDepartment: (id, data) => req(`/manager/departments/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrDeleteDepartment: (id) => req(`/manager/departments/${id}`, { method: "DELETE" }),
  // ── manager — Doctors / Consultants (master data) ────────────────────────────
  // Read-only — still used by the Consultant Groups member picker. Doctors are
  // now created/edited/deleted only via mgrCreateConsultant/mgrUpdateConsultant/
  // mgrDeleteConsultant (a doctor never exists without its consultant login).
  mgrDoctorsMaster: () => req("/manager/doctors-master"),

  mgrConsultantGroups: () => req("/manager/consultant-groups"),
  mgrCreateConsultantGroup: (name, doctorIds, departmentIds) =>
    req("/manager/consultant-groups", { method: "POST", body: JSON.stringify({ name, doctor_ids: doctorIds, department_ids: departmentIds }) }),
  mgrUpdateConsultantGroup: (id, { name, active, doctorIds, departmentIds } = {}) =>
    req(`/manager/consultant-groups/${id}`, { method: "PUT", body: JSON.stringify({ name, active, doctor_ids: doctorIds, department_ids: departmentIds }) }),
  mgrDeleteConsultantGroup: (id) => req(`/manager/consultant-groups/${id}`, { method: "DELETE" }),
  // ── manager — Discharge Lounge (virtual holding ward, outside the floor hierarchy) ──
  mgrDischargeLounge: () => req("/manager/discharge-lounge"),
  mgrSetupDischargeLounge: (name, initialBeds) => req("/manager/discharge-lounge", { method: "POST", body: JSON.stringify({ name, initial_beds: initialBeds }) }),
  mgrRenameDischargeLounge: (name) => req("/manager/discharge-lounge", { method: "PUT", body: JSON.stringify({ name }) }),
  mgrBulkSetLoungeBedOperational: (fromNum, toNum, operationalStatus) =>
    req("/manager/discharge-lounge/beds/bulk-operational", { method: "PATCH", body: JSON.stringify({ fromNum, toNum, operationalStatus }) }),
  cooViews: (source = "matrix") => req(`/coo/views?source=${source}`),
  cooSaveView: (data) => req("/coo/views", { method: "POST", body: JSON.stringify(data) }),
  cooEditView: (id, data) => req(`/coo/views/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  cooDeleteView: (id) => req(`/coo/views/${id}`, { method: "DELETE" }),
  // ── Discharge module — one shared router, used by every role ────────────────
  dischargeForBed: (bedId) => req(`/discharge/bed/${bedId}`),
  dischargePlan: (bedId, plannedDate, plannedTime) =>
    req("/discharge/plan", { method: "POST", body: JSON.stringify({ bedId, planned_date: plannedDate, planned_time: plannedTime ?? undefined }) }),
  dischargeReschedule: (admissionId, plannedDate, plannedTime, reason) =>
    req(`/discharge/${admissionId}/reschedule`, { method: "POST", body: JSON.stringify({ planned_date: plannedDate, planned_time: plannedTime ?? undefined, reason: reason ?? undefined }) }),
  dischargeCancelPlan: (admissionId, reason) =>
    req(`/discharge/${admissionId}/cancel-plan`, { method: "POST", body: JSON.stringify({ reason: reason ?? undefined }) }),
  dischargeInitiate: (admissionId) => req(`/discharge/${admissionId}/initiate`, { method: "POST", body: JSON.stringify({}) }),
  dischargeCancel: (admissionId, reason) =>
    req(`/discharge/${admissionId}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason ?? undefined }) }),
  dischargeUpdateStep: (admissionId, step, status, opts = {}) =>
    req(`/discharge/${admissionId}/step`, { method: "PATCH", body: JSON.stringify({ step, status, patient_left: opts.patientLeft ?? undefined, reason: opts.reason ?? undefined }) }),
  dischargeDashboard: () => req("/discharge/dashboard"),
  dischargeHistory: (admissionId) => req(`/discharge/history/${admissionId}`),
  dischargesForWard: (wardId) => req(`/discharge/ward/${wardId}`),
  // hospitalWide: only ever passed by the Transaction Board's drilldown modal
  // (DischargeListModal), to match the hospital-wide scope its card counts
  // already use — every other caller (each role's own scoped Discharges
  // worklist page) never passes it, so their behavior is unchanged.
  // unit: also only from that same modal — the Unit toolbar's current
  // selection (TOTAL/KIMS/Renova/... or any future one), further narrowing
  // hospitalWide down to just that unit's wards, same as the card counts
  // (GET /coo/admin-dashboard?unit=) already do. Ignored unless hospitalWide
  // is also true, and omitted entirely for "TOTAL" (hospital-wide already
  // means everything).
  dischargesActive: (wardId, hospitalWide, unit) => req("/discharge/active" + (wardId ? `?wardId=${wardId}` : hwQuery(hospitalWide, unit))),
  dischargesPendingStep: (step, hospitalWide, unit) => req(`/discharge/pending?step=${step}` + hwQuery(hospitalWide, unit, "&")),
  dischargeBillingPipeline: () => req("/discharge/billing-pipeline"),
  dischargesAdmittedToday: (hospitalWide, unit) => req("/discharge/admitted-today" + hwQuery(hospitalWide, unit)),
  dischargesCancelledToday: (hospitalWide, unit) => req("/discharge/cancelled-today" + hwQuery(hospitalWide, unit)),
  dischargesInitiatedToday: (hospitalWide, unit) => req("/discharge/initiated-today" + hwQuery(hospitalWide, unit)),
  dischargesCompletedToday: (hospitalWide, unit) => req("/discharge/completed-today" + hwQuery(hospitalWide, unit)),
  dischargesPatientLeft: (hospitalWide, unit) => req("/discharge/patient-left" + hwQuery(hospitalWide, unit)),
  transferWards: () => req("/discharge/transfer/wards"),
  transferCandidates: (wardId) => req(`/discharge/transfer/candidates?wardId=${wardId}`),
  transferBed: (fromBedId, toWardId, toBedId, reason) =>
    req("/discharge/transfer", { method: "POST", body: JSON.stringify({ fromBedId, toWardId, toBedId, reason }) }),
  dischargeMoveToLounge: (admissionId, reason) => req(`/discharge/${admissionId}/move-to-lounge`, { method: "POST", body: JSON.stringify({ reason }) }),
  readmitFromLounge: (admissionId, toWardId, toBedId, reason) =>
    req(`/discharge/${admissionId}/readmit`, { method: "POST", body: JSON.stringify({ toWardId, toBedId, reason }) }),
  dischargeForceComplete: (admissionId) =>
    req(`/discharge/${admissionId}/force-complete`, { method: "POST", body: JSON.stringify({}) }),
  // ── Consultant users (COO creates/manages, login + doctor identity as one unit) ─
  mgrConsultants: () => req("/manager/consultants"),
  mgrCreateConsultant: (data) => req("/manager/consultants", { method: "POST", body: JSON.stringify(data) }),
  mgrUpdateConsultant: (id, { name, username, password, active, departmentIds } = {}) =>
    req(`/manager/consultants/${id}`, { method: "PUT", body: JSON.stringify({ name, username, password, active, department_ids: departmentIds }) }),
  mgrDeleteConsultant: (id) => req(`/manager/consultants/${id}`, { method: "DELETE" }),
  // ── Consultant portal (CONSULTANT role) ─────────────────────────────────────
  consultantLiveWards: () => req("/consultant/live-wards"),
  consultantBedDetails: () => req("/consultant/bed-details"),
  consultantAdminDashboard: (unit) => req(`/consultant/admin-dashboard${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  consultantPayerTypes: () => cachedGet("/consultant/payer-types"),
  consultantAdminDashboardHistory: (u) => req(`/consultant/admin-dashboard-history${u && u !== "TOTAL" ? `?unit=${encodeURIComponent(u)}` : ""}`),
  consultantConsultants: () => req("/consultant/consultants"),
  consultantSnapshots: () => req("/consultant/snapshots"),
  consultantOverstay: () => req("/consultant/overstay"),
  // ── Discharge phase SLAs ────────────────────────────────────────────────────
  dischargePhaseConfig: () => req("/discharge/phase-config"),
  mgrDischargePhases: () => req("/manager/discharge-phases"),
  mgrUpdateDischargePhase: (id, data) =>
    req(`/manager/discharge-phases/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrReorderDischargePhase: (id, direction) =>
    req(`/manager/discharge-phases/${id}/order`, { method: "PATCH", body: JSON.stringify({ direction }) }),
  mgrPayerTat: () => req("/manager/payer-tat"),
  mgrCreatePayerTat: (data) => req("/manager/payer-tat", { method: "POST", body: JSON.stringify(data) }),
  mgrUpdatePayerTat: (id, data) =>
    req(`/manager/payer-tat/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrDeletePayerTat: (id) => req(`/manager/payer-tat/${id}`, { method: "DELETE" }),
  consultantMyWards: () => req("/consultant/my-wards"),
  consultantBeds: (wardId) => req(`/consultant/beds/${wardId}`),
  consultantMyPatients: () => req("/consultant/my-patients"),
  // ── PWO — patient complaint management ──────────────────────────────────────
  // REST is for the initial load, pagination and history only. Every subsequent
  // change arrives over the socket as a targeted payload the page patches in
  // place — see PWOApp.jsx. Nothing here should be called from a socket handler.
  pwoMeta: () => req("/pwo/meta"),
  pwoDashboard: () => req("/pwo/dashboard"),
  pwoCharts: (days = 30) => req(`/pwo/charts?days=${days}`),
  pwoComplaints: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, String(v));
    }
    const s = qs.toString();
    return req(`/pwo/complaints${s ? "?" + s : ""}`);
  },
  pwoComplaint: (id) => req(`/pwo/complaints/${id}`),
  pwoAccept: (id) => req(`/pwo/complaints/${id}/accept`, { method: "POST" }),
  pwoSetStatus: (id, status, note) =>
    req(`/pwo/complaints/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, note: note || null }) }),
  pwoSetPriority: (id, priority) =>
    req(`/pwo/complaints/${id}/priority`, { method: "PATCH", body: JSON.stringify({ priority }) }),
  pwoAddNote: (id, note, visibleToPatient = false) =>
    req(`/pwo/complaints/${id}/notes`, { method: "POST", body: JSON.stringify({ note, visibleToPatient }) }),
  pwoPerOfficer: () => req("/pwo/reports/per-pwo"),
  consultantMyDischarges: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) { if (v) qs.set(k, v); }
    const s = qs.toString();
    return req(`/consultant/my-discharges${s ? "?" + s : ""}`);
  },
  // ── Pharmacy ──────────────────────────────────────────────────────────────
  pharmacyDashboard: () => req("/pharmacy/dashboard"),
  pharmacyReopenRequest: (admissionId, stepKey, reason) =>
    req("/pharmacy/reopen-request", { method: "POST", body: JSON.stringify({ admissionId, stepKey, reason }) }),
  pharmacyReopenRequests: () => req("/pharmacy/reopen-requests"),
  pharmacyReviewRequest: (id, action, reviewNote) =>
    req(`/pharmacy/reopen-requests/${id}/review`, { method: "POST", body: JSON.stringify({ action, reviewNote }) }),
  pharmacyLiveWards: () => req("/pharmacy/live-wards"),
  pharmacyBedDetails: (wardId) => req(`/pharmacy/bed-details${wardId ? "?ward=" + wardId : ""}`),
  pharmacyAdminDashboard: (u) => req(`/pharmacy/admin-dashboard${u ? "?unit=" + u : ""}`),
  pharmacyAdminDashboardHistory: (u) => req(`/pharmacy/admin-dashboard-history${u ? "?unit=" + u : ""}`),
  pharmacyConsultants: () => req("/pharmacy/consultants"),
  pharmacyPayerTypes: () => cachedGet("/pharmacy/payer-types"),
  pharmacySnapshots: () => req("/pharmacy/snapshots"),
  pharmacyOverstay: () => req("/pharmacy/overstay"),
  // ── FC reopen requests ────────────────────────────────────────────────────
  fcReopenPendingCount: () => req("/fc/reopen-pending-count"),
  fcReopenRequest: (admissionId, stepKey, reason) =>
    req("/fc/reopen-request", { method: "POST", body: JSON.stringify({ admissionId, stepKey, reason }) }),
  fcReopenRequests: () => req("/fc/reopen-requests"),
  fcReviewRequest: (id, action, reviewNote) =>
    req(`/fc/reopen-requests/${id}/review`, { method: "POST", body: JSON.stringify({ action, reviewNote }) }),
  fcLiveWards: () => req("/fc/live-wards"),
  fcBedDetails: (wardId) => req(`/fc/bed-details${wardId ? "?ward=" + wardId : ""}`),
  fcAdminDashboard: (u) => req(`/fc/admin-dashboard${u ? "?unit=" + u : ""}`),
  fcAdminDashboardHistory: (u) => req(`/fc/admin-dashboard-history${u ? "?unit=" + u : ""}`),
  fcConsultants: () => req("/fc/consultants"),
  fcPayerTypes: () => cachedGet("/fc/payer-types"),
  fcSnapshots: () => req("/fc/snapshots"),
  fcOverstay: () => req("/fc/overstay"),
  // ── FC — Bed Entry (hospital-wide, operational wards only) ───────────────
  fcWards: () => req("/fc/wards"),
  fcDestinations: () => cachedGet("/fc/destinations"),
  fcBeds: (wardId, opts = {}) => {
    const params = new URLSearchParams();
    if (opts.physical_status) params.set("physical_status", opts.physical_status);
    if (opts.reservation_status) params.set("reservation_status", opts.reservation_status);
    const qs = params.toString();
    return req(`/fc/wards/${wardId}/beds${qs ? "?" + qs : ""}`);
  },
  fcUpdateBedStatus: (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId, consultantGroupId, { patientName, admissionDate } = {}) =>
    req(`/fc/beds/${bedId}/status`, { method: "PATCH", body: JSON.stringify({ physical_status: physicalStatus, reservation_status: reservationStatus, payer_type: payerType ?? undefined, destination: destination ?? undefined, reservation_note: reservationNote ?? undefined, ip_last6: ipLast6 ?? undefined, patient_name: patientName ?? undefined, admission_date: admissionDate ?? undefined, admission_type: admissionType ?? undefined, department_name: departmentName ?? undefined, doctor_id: doctorId ?? undefined, department_id: departmentId ?? undefined, consultant_group_id: consultantGroupId ?? undefined }) }),
  fcUpdateAdmission: (bedId, { ipLast6, admissionType, patientName, admissionDate, departmentName, doctorId, departmentId, consultantGroupId, payerType }) =>
    req(`/fc/beds/${bedId}/admission`, { method: "PATCH", body: JSON.stringify({ ip_last6: ipLast6 ?? undefined, patient_name: patientName ?? undefined, admission_date: admissionDate ?? undefined, admission_type: admissionType ?? undefined, department_name: departmentName ?? undefined, doctor_id: doctorId, department_id: departmentId ?? undefined, consultant_group_id: consultantGroupId, payer_type: payerType }) }),
  // ── Simple logins (FC, Pharmacy) — admin management ───────────────────────
  mgrSimpleLogins: (role) => req(`/manager/simple-logins?role=${role}`),
  mgrCreateSimpleLogin: (role, username, password, name) =>
    req("/manager/simple-logins", { method: "POST", body: JSON.stringify({ role, username, password, name }) }),
  mgrUpdateSimpleLogin: (id, data) =>
    req(`/manager/simple-logins/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrDeleteSimpleLogin: (id) =>
    req(`/manager/simple-logins/${id}`, { method: "DELETE" }),
};

// ---- WebSocket ----
// In dev: BASE_API is "" so socket connects to the vite dev server which proxies
// /socket.io → localhost:4000 (see vite.config.js).
// In prod: BASE_API is the backend URL so socket connects directly.
//
// One shared connection per browser tab, not one per component. Every screen
// that used to call createSocket() (each opening its own independent
// connection — a ward view + its Overstay tab + its Discharges tab could
// have 3 live sockets open at once, each reacting to the same event) now
// calls getSocket() instead, which returns the same connection every time.
// Callers must clean up with socket.off(event, handler) on unmount, NEVER
// socket.disconnect() — disconnecting would kill the connection for every
// other screen still using it. disconnectSocket() is the one exception,
// called from logout() so a fresh login opens a fresh connection with the
// new token instead of reusing a stale/anonymous one.
let sharedSocket = null;
export function getSocket() {
  if (!sharedSocket) {
    sharedSocket = io(BASE_API || undefined, {
      // Function form: re-evaluated on every (re)connect attempt, so a token
      // obtained after this socket was first created (e.g. a re-login later
      // in the same tab, post logout->disconnectSocket->fresh getSocket) is
      // always the one actually sent, not whatever was current at construction.
      auth: (cb) => cb({ token: getToken() }),
      // polling first so the initial handshake always works through Vite's proxy;
      // socket.io then upgrades to WebSocket automatically if the path supports it
      transports: ["polling", "websocket"],
    });
    sharedSocket.on("connect_error", (err) => {
      if (err.message === "No token" || err.message === "Invalid token") {
        window.dispatchEvent(new CustomEvent("session:expired", {
          detail: { message: "Session expired. Please log in again." },
        }));
      }
    });
    // Reference-list CRUD reuses bed:update carrying a marker naming what moved:
    // `payerTypeId` (manager.ts payer-type routes), `destinationId` (destination
    // routes), or `refData` (doctors / departments / consultant groups, see
    // emitRefDataChanged). Attached here, on the single shared connection, so
    // every screen is covered without each one having to remember to do it.
    //
    // All three drop the WHOLE cache rather than one entry: renaming a payer type
    // rewrites payer breakdowns elsewhere, and a consultant edit moves both the
    // doctor list and the groups that contain them. These edits are rare enough
    // that the extra refetch costs nothing, and being narrower here would risk
    // leaving a related list stale.
    //
    // Missing any of these means the cache silently serves a list the admin has
    // already changed — a new consultant stayed unselectable for everyone
    // already logged in until they logged out and back in.
    sharedSocket.on("bed:update", (p) => {
      if (!p) return;
      if (p.payerTypeId != null || p.destinationId != null || p.refData != null) clearRefCache();
    });

    // Keep the ward-beds cache correct — see the block comment on wardBeds.
    // Attached to the one shared connection so the cache is maintained even
    // while no ward screen is mounted, which is exactly when it would otherwise
    // drift out of date without anyone noticing.
    const wardOf = (p) => (p && p.wardId != null ? Number(p.wardId) : undefined);
    sharedSocket.on("bed:update", (p) => {
      const wid = wardOf(p);
      if (wid === undefined) { clearWardBeds(); return; }   // unscoped: drop all
      const cached = wardBeds.get(wid);
      if (!cached) return;
      if (p?.bed && p.bed.id != null) {
        const idx = cached.findIndex((b) => b.id === p.bed.id);
        // A bed we have never loaded is not ours to invent — drop the ward and
        // let the next visit fetch it. Mirrors WardPage's patchBed exactly,
        // including carrying over unit_type (a client-side annotation).
        if (idx === -1) { clearWardBeds(wid); return; }
        const next = cached.slice();
        next[idx] = { ...p.bed, unit_type: cached[idx].unit_type };
        wardBeds.set(wid, next);
        return;
      }
      clearWardBeds(wid);   // no row attached: we cannot know what changed
    });
    sharedSocket.on("discharge:update", (p) => clearWardBeds(wardOf(p)));
    sharedSocket.on("ward:operational", (p) => clearWardBeds(wardOf(p)));

    // A reconnect means events were missed while offline (socket.io does not
    // replay them), so nothing cached can be trusted — including the reference
    // lists. The invalidation markers above are the ONLY signal that those went
    // stale, and a marker sent while this client was disconnected is gone for
    // good, so a reference edit made during the gap would otherwise survive
    // until logout. Dropping both caches on reconnect closes that window.
    let hasConnected = sharedSocket.connected;
    sharedSocket.on("connect", () => {
      if (hasConnected) { clearWardBeds(); clearRefCache(); } else hasConnected = true;
    });
  }
  return sharedSocket;
}
export function disconnectSocket() {
  // The next login may be a different user with a different role, and these
  // lists are role-scoped — so neither cache may survive the session.
  clearRefCache();
  clearWardBeds();
  if (sharedSocket) { sharedSocket.disconnect(); sharedSocket = null; }
}

/** Collapses a burst of socket events into ONE call.
 *
 *  Several server actions legitimately emit many events back-to-back — the
 *  scheduler emits one `alarm:active` per PRE block on every 30s tick, and a
 *  ward edit can emit per affected bed. Each of those used to trigger a full
 *  aggregate reload, so an idle dashboard fired ~25 requests every 30 seconds
 *  and the burst then queued behind the browser's 6-connection limit, turning
 *  sub-second calls into multi-second ones.
 *
 *  The refetch is identical whether it runs once or seven times, so this only
 *  removes duplicated work — it never changes what data is loaded. Trailing
 *  edge: the last event in a burst wins, 250ms later (imperceptible for a
 *  dashboard, and far cheaper than the congestion it prevents).
 *
 *  Callers MUST call .cancel() in their effect cleanup so a pending timer
 *  can't fire into an unmounted component. */
export function coalesce(fn, ms = 250) {
  let t = null;
  const wrapped = (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
  wrapped.cancel = () => { if (t) { clearTimeout(t); t = null; } };
  return wrapped;
}

/** socket.io fires "connect" for BOTH the first connection and every later
 *  reconnect. Only a RECONNECT needs a catch-up refetch — while disconnected
 *  the client misses events, so its data may be stale. The FIRST connection
 *  misses nothing: the component's own mount-time load already fetched
 *  everything, and that load and the first connect happen a few hundred ms
 *  apart, so treating them the same made every page load fetch twice.
 *
 *  `seen` is seeded from socket.connected because the socket is shared: a
 *  component mounting later finds it already connected, so no "connect" will
 *  fire for it — without the seed, that component's first REAL reconnect
 *  would be mistaken for a first connect and skipped.
 *
 *  Returns an unsubscribe function; call it in the effect cleanup. */
export function onReconnect(socket, handler) {
  let seen = socket.connected;
  const onConnect = () => { if (seen) handler(); else seen = true; };
  socket.on("connect", onConnect);
  return () => socket.off("connect", onConnect);
}

// ---- audio alarm (loud repeating two-tone) ----
let audioCtx = null, alarmTimer = null;
export function startAlarm() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (alarmTimer) return;
    const beep = () => {
      const t0 = audioCtx.currentTime;
      [[880, 0], [660, 0.5]].forEach(([freq, off]) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sine"; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0 + off);
        g.gain.exponentialRampToValueAtTime(0.3, t0 + off + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.4);
        o.connect(g).connect(audioCtx.destination);
        o.start(t0 + off); o.stop(t0 + off + 0.42);
        o.onended = () => { o.disconnect(); g.disconnect(); };
      });
    };
    beep();
    alarmTimer = setInterval(beep, 1300);
  } catch (e) { /* audio blocked until user gesture */ }
}
export function stopAlarm() { if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; } }

// ---- error handling ----
export function friendlyError(err) {
  const msg = (err?.message ?? String(err ?? "")).trim();
  // req() attaches the real HTTP status; use it rather than hunting for digits in
  // the message. Matching the TEXT for "500" replaced any server message that
  // merely contained those three characters — "IP 005003 is already admitted on
  // bed 201B" became "Server error", so staff were told the system was broken
  // instead of being told which bed the patient was already on. Bed names, room
  // numbers and amounts could all trip it the same way.
  const status = Number(err?.status) || null;
  if (!msg || msg === "Request failed")
    return { title: null, message: "Something went wrong. Please try again." };
  if (/failed to fetch|networkerror|network error|load failed/i.test(msg))
    return { title: null, message: "Can't reach the server. Check your connection and try again." };
  // "Unauthorized" is only thrown by req() for expired sessions (authenticated routes).
  // Login errors now arrive as plain messages from the server and fall through below.
  if (/^unauthorized$/i.test(msg))
    return { title: null, message: "Session expired. Please sign in again." };
  // A 5xx body is a stack trace or proxy HTML, never something to show a user.
  // The text check stays as a fallback for errors thrown without a status, but it
  // now looks for the distinctive phrase, not a bare digit sequence.
  if ((status && status >= 500) || /internal server error/i.test(msg))
    return { title: null, message: "Server error. Please try again in a moment." };
  // Handle "Request failed (HTTP NNN)" — fires when the server returns no JSON error body
  // (e.g. nginx 502, unknown route, proxy timeout).
  const httpMatch = msg.match(/request failed \(HTTP (\d+)\)/i);
  if (httpMatch) {
    const code = Number(httpMatch[1]);
    if (code === 401) return { title: null, message: "Please sign in to continue." };
    if (code === 403) return { title: null, message: "You don't have permission to do that." };
    if (code === 404) return { title: null, message: "The requested item was not found. It may have been deleted." };
    if (code === 409) return { title: null, message: "This change conflicts with existing data. Please refresh and try again." };
    if (code >= 500) return { title: null, message: "Server error. Please try again in a moment." };
    return { title: null, message: "Something went wrong. Please try again." };
  }
  // The server returns specific, already-friendly messages for all other cases
  // (wrong password, wrong role, missing fields, etc.) — pass them through as-is.
  return { title: null, message: msg };
}

export function toastErr(err) {
  return friendlyError(err).message;
}

// ---- time formatting ----
// Postgres bigint columns arrive as strings, and some legacy rows store epoch
// seconds instead of milliseconds — normalize both before constructing a Date.
export function toMs(ts) {
  if (ts == null || ts === "") return null;
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}
export function fmtTime(d) {
  const ms = typeof d === "number" || typeof d === "string" ? toMs(d) : d;
  if (ms == null) return "—";
  const date = new Date(ms);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
export function fmtRelative(d) {
  const ms = typeof d === "number" || typeof d === "string" ? toMs(d) : d;
  if (ms == null) return "—";
  const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (diffSec < 45) return "Just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
export function fmtDateTime(d) {
  const ms = typeof d === "number" || typeof d === "string" ? toMs(d) : d;
  if (ms == null) return "—";
  const date = new Date(ms);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
/** Formats a plain "YYYY-MM-DD" calendar date for display as DD/MM/YYYY.
 *
 *  Deliberately a string rearrangement, not a Date round-trip: `new Date("2026-08-16")`
 *  parses as UTC midnight and then renders in the viewer's local timezone, which
 *  shows the previous day for anyone west of UTC. There is no time-of-day here to
 *  preserve, so there is nothing a Date buys us and one real bug it introduces.
 *
 *  Storage stays ISO — it sorts chronologically as a plain string and is what the
 *  date input and the API both speak. This is a display concern only. */
export function fmtDMY(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? "").trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}
export function fmtClock(mins) {

  // const h = Math.floor(mins / 60) % 24, m = mins % 60;
  // const ap = h < 12 ? "AM" : "PM", hh = h % 12 === 0 ? 12 : h % 12;
  // return hh + ":" + String(m).padStart(2, "0") + " " + ap;

  mins = Number(mins || 0);

  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;

  const ap = h24 >= 12 ? "PM" : "AM";

  const h12 =
    h24 % 12 === 0
      ? 12
      : h24 % 12;

  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;


}
