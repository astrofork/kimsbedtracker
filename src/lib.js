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
  login: (username, password, role) =>
    req("/auth/login", { method: "POST", body: JSON.stringify({ username, password, role }) }),
  preMe: () => req("/pre/me"),
  setShift: (shift) => req("/pre/shift", { method: "POST", body: JSON.stringify({ shift }) }),
  setWard: (wardId, vacant_none, vacant_reserved, occupied_none, occupied_reserved = 0) =>
    req("/pre/ward", { method: "POST", body: JSON.stringify({ wardId, vacant_none, vacant_reserved, occupied_none, occupied_reserved }) }),
  submitRound: () => req("/pre/submit", { method: "POST" }),
  cooOverview: () => req("/coo/overview"),
  cooLiveWards: () => req("/coo/live-wards"),
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
  cooOccupancyTrend: (range = "7d") => req(`/coo/occupancy-trend?range=${range}`),
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
  doctorUpdateBedStatus: (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote) =>
    req(`/doctor/beds/${bedId}/status`, { method: "PATCH", body: JSON.stringify({ physical_status: physicalStatus, reservation_status: reservationStatus, payer_type: payerType ?? undefined, destination: destination ?? undefined, reservation_note: reservationNote ?? undefined }) }),
  doctorReview: (blockId) => req(`/doctor/blocks/${blockId}/review`, { method: "POST" }),
  doctorReviewWard: (wardId) => req(`/doctor/wards/${wardId}/review`, { method: "POST" }),
  doctorActivity: () => req("/doctor/activity"),
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
  preUpdateBedStatus: (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote) =>
    req(`/pre/beds/${bedId}/status`, { method: "PATCH", body: JSON.stringify({ physical_status: physicalStatus, reservation_status: reservationStatus, payer_type: payerType ?? undefined, destination: destination ?? undefined, reservation_note: reservationNote ?? undefined }) }),
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
  nurseUpdateBedStatus: (bedId, physicalStatus, reservationStatus, payerType, destination, reservationNote) =>
    req(`/nurse/beds/${bedId}/status`, { method: "PATCH", body: JSON.stringify({ physical_status: physicalStatus, reservation_status: reservationStatus, payer_type: payerType ?? undefined, destination: destination ?? undefined, reservation_note: reservationNote ?? undefined }) }),
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
  cooViews: (source = "matrix") => req(`/coo/views?source=${source}`),
  cooSaveView: (data) => req("/coo/views", { method: "POST", body: JSON.stringify(data) }),
  cooEditView: (id, data) => req(`/coo/views/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  cooDeleteView: (id) => req(`/coo/views/${id}`, { method: "DELETE" }),
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
