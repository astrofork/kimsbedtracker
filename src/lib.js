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

  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);


  return data;
}

export const api = {
  meta: () => req("/meta"),
  departments: () => req("/departments"),
  doctors: (departmentId) => req("/doctors" + (departmentId ? `?department_id=${departmentId}` : "")),
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
    if (opts.physical_status)    params.set("physical_status",    opts.physical_status);
    if (opts.reservation_status) params.set("reservation_status", opts.reservation_status);
    const qs = params.toString();
    return req(`/doctor/wards/${wardId}/beds${qs ? "?" + qs : ""}`);
  },
  doctorPayerTypes: () => req("/doctor/payer-types"),
  doctorDestinations: () => req("/doctor/destinations"),
  doctorUpdateBedStatus: (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId) =>
    req(`/doctor/beds/${bedId}/status`, { method: "PATCH", body: JSON.stringify({ physical_status: physicalStatus, reservation_status: reservationStatus, payer_type: payerType ?? undefined, destination: destination ?? undefined, reservation_note: reservationNote ?? undefined, ip_last6: ipLast6 ?? undefined, admission_type: admissionType ?? undefined, consultant_name: consultantName ?? undefined, department_name: departmentName ?? undefined, doctor_id: doctorId ?? undefined, department_id: departmentId ?? undefined }) }),
  doctorReview: (blockId) => req(`/doctor/blocks/${blockId}/review`, { method: "POST" }),
  doctorReviewWard: (wardId) => req(`/doctor/wards/${wardId}/review`, { method: "POST" }),
  doctorActivity: () => req("/doctor/activity"),
  doctorLiveWards: () => req("/doctor/live-wards"),
  doctorBedDetails: () => req("/doctor/bed-details"),
  doctorAdminDashboard: (unit) => req(`/doctor/admin-dashboard${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  doctorAdminDashboardHistory: (unit) => req(`/doctor/admin-dashboard-history${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  doctorSnapshots: () => req("/doctor/snapshots"),
  doctorConsultants: () => req("/doctor/consultants"),
  // ── manager — bed details (create/configure only) ────────────────────────────
  wardBeds: (wardId, opts = {}) => {
    const params = new URLSearchParams();
    if (opts.physical_status)    params.set("physical_status",    opts.physical_status);
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
    if (opts.physical_status)    params.set("physical_status",    opts.physical_status);
    if (opts.reservation_status) params.set("reservation_status", opts.reservation_status);
    const qs = params.toString();
    return req(`/pre/wards/${wardId}/beds${qs ? "?" + qs : ""}`);
  },
  prePayerTypes: () => req("/pre/payer-types"),
  preDestinations: () => req("/pre/destinations"),
  preReviewWard: (wardId) => req(`/pre/wards/${wardId}/review`, { method: "POST" }),
  // Admin-style dashboard, scoped server-side to this PRE user's own wards.
  preLiveWards: () => req("/pre/live-wards"),
  preBedDetails: () => req("/pre/bed-details"),
  preAdminDashboard: (unit) => req(`/pre/admin-dashboard${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  preAdminDashboardHistory: (unit) => req(`/pre/admin-dashboard-history${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  preConsultants: () => req("/pre/consultants"),
  preSnapshots: () => req("/pre/snapshots"),
  preUpdateBedStatus: (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId) =>
    req(`/pre/beds/${bedId}/status`, { method: "PATCH", body: JSON.stringify({ physical_status: physicalStatus, reservation_status: reservationStatus, payer_type: payerType ?? undefined, destination: destination ?? undefined, reservation_note: reservationNote ?? undefined, ip_last6: ipLast6 ?? undefined, admission_type: admissionType ?? undefined, consultant_name: consultantName ?? undefined, department_name: departmentName ?? undefined, doctor_id: doctorId ?? undefined, department_id: departmentId ?? undefined }) }),
  // Corrects a data-entry mistake on an already-active admission (IP/type/consultant/dept)
  // — never changes physical/reservation status.
  preUpdateAdmission: (bedId, { ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId, payerType }) =>
    req(`/pre/beds/${bedId}/admission`, { method: "PATCH", body: JSON.stringify({ ip_last6: ipLast6 ?? undefined, admission_type: admissionType ?? undefined, consultant_name: consultantName ?? undefined, department_name: departmentName ?? undefined, doctor_id: doctorId ?? undefined, department_id: departmentId ?? undefined, payer_type: payerType }) }),
  // ── Nurse — bed management ───────────────────────────────────────────────────
  nurseMe: () => req("/nurse/me"),
  nurseBeds: (wardId, opts = {}) => {
    const params = new URLSearchParams();
    if (opts.physical_status)    params.set("physical_status",    opts.physical_status);
    if (opts.reservation_status) params.set("reservation_status", opts.reservation_status);
    const qs = params.toString();
    return req(`/nurse/wards/${wardId}/beds${qs ? "?" + qs : ""}`);
  },
  nursePayerTypes: () => req("/nurse/payer-types"),
  nurseDestinations: () => req("/nurse/destinations"),
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
  nurseUpdateBedStatus: (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId) =>
    req(`/nurse/beds/${bedId}/status`, { method: "PATCH", body: JSON.stringify({ physical_status: physicalStatus, reservation_status: reservationStatus, payer_type: payerType ?? undefined, destination: destination ?? undefined, reservation_note: reservationNote ?? undefined, ip_last6: ipLast6 ?? undefined, admission_type: admissionType ?? undefined, consultant_name: consultantName ?? undefined, department_name: departmentName ?? undefined, doctor_id: doctorId ?? undefined, department_id: departmentId ?? undefined }) }),
  pushSubscribe: (subscription) =>
    req("/push/subscribe", { method: "POST", body: JSON.stringify({ subscription }) }),
  mgrPayerTypes: () => req("/manager/payer-types"),
  mgrCreatePayerType: (name) => req("/manager/payer-types", { method: "POST", body: JSON.stringify({ name }) }),
  mgrUpdatePayerType: (id, data) => req(`/manager/payer-types/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrReorderPayerType: (id, direction) => req(`/manager/payer-types/${id}/order`, { method: "PATCH", body: JSON.stringify({ direction }) }),
  mgrDeletePayerType: (id) => req(`/manager/payer-types/${id}`, { method: "DELETE" }),
  mgrDestinations: () => req("/manager/destinations"),
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
  mgrDoctorsMaster: () => req("/manager/doctors-master"),
  mgrCreateDoctorMaster: (name, departmentIds) => req("/manager/doctors-master", { method: "POST", body: JSON.stringify({ name, department_ids: departmentIds }) }),
  mgrUpdateDoctorMaster: (id, { name, active, departmentIds } = {}) => req(`/manager/doctors-master/${id}`, { method: "PUT", body: JSON.stringify({ name, active, department_ids: departmentIds }) }),
  mgrDeleteDoctorMaster: (id) => req(`/manager/doctors-master/${id}`, { method: "DELETE" }),
  // ── manager — Discharge Lounge (virtual holding ward, outside the floor hierarchy) ──
  mgrDischargeLounge: () => req("/manager/discharge-lounge"),
  mgrSetupDischargeLounge: (name, initialBeds) => req("/manager/discharge-lounge", { method: "POST", body: JSON.stringify({ name, initial_beds: initialBeds }) }),
  mgrRenameDischargeLounge: (name) => req("/manager/discharge-lounge", { method: "PUT", body: JSON.stringify({ name }) }),
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
  dischargesActive: (wardId) => req("/discharge/active" + (wardId ? `?wardId=${wardId}` : "")),
  dischargesPendingStep: (step) => req(`/discharge/pending?step=${step}`),
  dischargeBillingPipeline: () => req("/discharge/billing-pipeline"),
  dischargesAdmittedToday: () => req("/discharge/admitted-today"),
  dischargesCancelledToday: () => req("/discharge/cancelled-today"),
  dischargesInitiatedToday: () => req("/discharge/initiated-today"),
  dischargesCompletedToday: () => req("/discharge/completed-today"),
  dischargesPatientLeft: () => req("/discharge/patient-left"),
  transferWards: () => req("/discharge/transfer/wards"),
  transferCandidates: (wardId) => req(`/discharge/transfer/candidates?wardId=${wardId}`),
  transferBed: (fromBedId, toWardId, toBedId, reason) =>
    req("/discharge/transfer", { method: "POST", body: JSON.stringify({ fromBedId, toWardId, toBedId, reason }) }),
  dischargeMoveToLounge: (admissionId) => req(`/discharge/${admissionId}/move-to-lounge`, { method: "POST", body: JSON.stringify({}) }),
  // ── Consultant login management (COO creates/manages) ───────────────────────
  mgrConsultantLogins: () => req("/manager/consultant-logins"),
  mgrSetConsultantLogin: (doctorMasterId, username, password) =>
    req("/manager/consultant-logins", { method: "POST", body: JSON.stringify({ doctor_master_id: doctorMasterId, username, password }) }),
  mgrUpdateConsultantLogin: (id, data) =>
    req(`/manager/consultant-logins/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrDeleteConsultantLogin: (id) =>
    req(`/manager/consultant-logins/${id}`, { method: "DELETE" }),
  // ── Consultant portal (CONSULTANT role) ─────────────────────────────────────
  consultantLiveWards: () => req("/consultant/live-wards"),
  consultantBedDetails: () => req("/consultant/bed-details"),
  consultantAdminDashboard: (unit) => req(`/consultant/admin-dashboard${unit && unit !== "TOTAL" ? `?unit=${encodeURIComponent(unit)}` : ""}`),
  consultantPayerTypes: () => req("/consultant/payer-types"),
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
  pharmacyPayerTypes: () => req("/pharmacy/payer-types"),
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
  fcPayerTypes: () => req("/fc/payer-types"),
  fcSnapshots: () => req("/fc/snapshots"),
  fcOverstay: () => req("/fc/overstay"),
  // ── FC — Bed Entry (hospital-wide, operational wards only) ───────────────
  fcWards: () => req("/fc/wards"),
  fcDestinations: () => req("/fc/destinations"),
  fcBeds: (wardId, opts = {}) => {
    const params = new URLSearchParams();
    if (opts.physical_status)    params.set("physical_status",    opts.physical_status);
    if (opts.reservation_status) params.set("reservation_status", opts.reservation_status);
    const qs = params.toString();
    return req(`/fc/wards/${wardId}/beds${qs ? "?" + qs : ""}`);
  },
  fcUpdateBedStatus: (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote, ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId) =>
    req(`/fc/beds/${bedId}/status`, { method: "PATCH", body: JSON.stringify({ physical_status: physicalStatus, reservation_status: reservationStatus, payer_type: payerType ?? undefined, destination: destination ?? undefined, reservation_note: reservationNote ?? undefined, ip_last6: ipLast6 ?? undefined, admission_type: admissionType ?? undefined, consultant_name: consultantName ?? undefined, department_name: departmentName ?? undefined, doctor_id: doctorId ?? undefined, department_id: departmentId ?? undefined }) }),
  fcUpdateAdmission: (bedId, { ipLast6, admissionType, consultantName, departmentName, doctorId, departmentId, payerType }) =>
    req(`/fc/beds/${bedId}/admission`, { method: "PATCH", body: JSON.stringify({ ip_last6: ipLast6 ?? undefined, admission_type: admissionType ?? undefined, consultant_name: consultantName ?? undefined, department_name: departmentName ?? undefined, doctor_id: doctorId ?? undefined, department_id: departmentId ?? undefined, payer_type: payerType }) }),
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
export function createSocket() {
  const socket = io(BASE_API || undefined, {
    auth: { token: getToken() },
    // polling first so the initial handshake always works through Vite's proxy;
    // socket.io then upgrades to WebSocket automatically if the path supports it
    transports: ["polling", "websocket"],
  });
  socket.on("connect_error", (err) => {
    if (err.message === "No token" || err.message === "Invalid token") {
      window.dispatchEvent(new CustomEvent("session:expired", {
        detail: { message: "Session expired. Please log in again." },
      }));
    }
  });
  return socket;
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
  if (!msg || msg === "Request failed")
    return { title: null, message: "Something went wrong. Please try again." };
  if (/failed to fetch|networkerror|network error|load failed/i.test(msg))
    return { title: null, message: "Can't reach the server. Check your connection and try again." };
  // "Unauthorized" is only thrown by req() for expired sessions (authenticated routes).
  // Login errors now arrive as plain messages from the server and fall through below.
  if (/^unauthorized$/i.test(msg))
    return { title: null, message: "Session expired. Please sign in again." };
  if (/500|internal server error/i.test(msg))
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
