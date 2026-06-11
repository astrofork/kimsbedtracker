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
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    clearSession();
    // Notify the React app so it can reset its user state and show the Login screen.
    // We cannot use window.location.href = "/login" here because this is a state-driven
    // SPA with no real /login route — doing so causes a 404 or infinite reload.
    window.dispatchEvent(new CustomEvent("session:expired", {
      detail: { message: data?.error || "Session expired. Please log in again." }
    }));
    throw new Error("Unauthorized");
  }

  if (!res.ok) throw new Error(data.error || "Request failed");


  return data;
}

export const api = {
  meta: () => req("/meta"),
  login: (username, password, role) =>
    req("/auth/login", { method: "POST", body: JSON.stringify({ username, password, role }) }),
  preMe: () => req("/pre/me"),
  setShift: (shift) => req("/pre/shift", { method: "POST", body: JSON.stringify({ shift }) }),
  setWard: (wardId, vacant_none, vacant_reserved, occupied_none, occupied_reserved) =>
    req("/pre/ward", { method: "POST", body: JSON.stringify({ wardId, vacant_none, vacant_reserved, occupied_none, occupied_reserved }) }),
  submitRound: () => req("/pre/submit", { method: "POST" }),
  cooOverview: () => req("/coo/overview"),
  cooAudit: () => req("/coo/audit"),
  cooCompliance: () => req("/coo/compliance"),
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
  mgrHistory: (date, floorId) =>
    req(`/manager/history?date=${date}${floorId != null ? "&floorId=" + floorId : ""}`),
  // ── manager — nursing stations ───────────────────────────────────────────────
  mgrNursingStations: () => req("/manager/nursing-stations"),
  mgrCreateStation: (data) => req("/manager/nursing-stations", { method: "POST", body: JSON.stringify(data) }),
  mgrEditStation: (id, data) => req(`/manager/nursing-stations/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrAssignStationWards: (id, wardIds) => req(`/manager/nursing-stations/${id}/wards`, { method: "PUT", body: JSON.stringify({ wardIds }) }),
  mgrDeleteStation: (id) => req(`/manager/nursing-stations/${id}`, { method: "DELETE" }),
  // ── manager — nurse users ────────────────────────────────────────────────────
  mgrCreateNurse: (data) => req("/manager/nurses", { method: "POST", body: JSON.stringify(data) }),
  mgrEditNurse: (id, data) => req(`/manager/nurses/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrDeleteNurse: (id) => req(`/manager/nurses/${id}`, { method: "DELETE" }),
  // ── manager — PRE Blocks ─────────────────────────────────────────────────────
  mgrPreBlocks: () => req("/manager/pre-blocks"),
  mgrPreBlock: (id) => req(`/manager/pre-blocks/${id}`),
  mgrCreatePreBlock: (data) => req("/manager/pre-blocks", { method: "POST", body: JSON.stringify(data) }),
  mgrEditPreBlock: (id, data) => req(`/manager/pre-blocks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrSetPreBlockStatus: (id, status) => req(`/manager/pre-blocks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  mgrDeletePreBlock: (id) => req(`/manager/pre-blocks/${id}`, { method: "DELETE" }),
  // ── manager — bed details (create/configure only) ────────────────────────────
  wardBeds: (wardId, opts = {}) => {
    const params = new URLSearchParams();
    if (opts.physical_status)    params.set("physical_status",    opts.physical_status);
    if (opts.reservation_status) params.set("reservation_status", opts.reservation_status);
    const qs = params.toString();
    return req(`/manager/wards/${wardId}/beds${qs ? "?" + qs : ""}`);
  },
  generateBeds: (wardId, bedNames) =>
    req(`/manager/wards/${wardId}/generate-beds`, { method: "POST", body: JSON.stringify({ bedNames }) }),
  addBed: (wardId, bedName) =>
    req(`/manager/wards/${wardId}/beds`, { method: "POST", body: JSON.stringify({ bedName }) }),
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
  preUpdateBedStatus: (bedId, physicalStatus, reservationStatus) =>
    req(`/pre/beds/${bedId}/status`, { method: "PATCH", body: JSON.stringify({ physical_status: physicalStatus, reservation_status: reservationStatus }) }),
  // ── Nurse — bed management ───────────────────────────────────────────────────
  nurseMe: () => req("/nurse/me"),
  nurseBeds: (wardId, opts = {}) => {
    const params = new URLSearchParams();
    if (opts.physical_status)    params.set("physical_status",    opts.physical_status);
    if (opts.reservation_status) params.set("reservation_status", opts.reservation_status);
    const qs = params.toString();
    return req(`/nurse/wards/${wardId}/beds${qs ? "?" + qs : ""}`);
  },
  nurseUpdateBedStatus: (bedId, physicalStatus, reservationStatus) =>
    req(`/nurse/beds/${bedId}/status`, { method: "PATCH", body: JSON.stringify({ physical_status: physicalStatus, reservation_status: reservationStatus }) }),
  pushSubscribe: (subscription) =>
    req("/push/subscribe", { method: "POST", body: JSON.stringify({ subscription }) }),
  cooViews: () => req("/coo/views"),
  cooSaveView: (data) => req("/coo/views", { method: "POST", body: JSON.stringify(data) }),
  cooEditView: (id, data) => req(`/coo/views/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  cooDeleteView: (id) => req(`/coo/views/${id}`, { method: "DELETE" }),
};

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
  if (!msg) return { title: null, message: "An unexpected error occurred." };
  if (/failed to fetch|networkerror|network error|load failed/i.test(msg))
    return { title: "Connection problem", message: "Unable to reach the server. Check your network and try again." };
  if (/unauthorized|invalid credentials/i.test(msg))
    return { title: "Unable to sign in", message: "Please check your username and password and try again." };
  if (/403|forbidden/i.test(msg))
    return { title: "Access denied", message: "You don't have permission to perform this action." };
  if (/500|internal server/i.test(msg))
    return { title: "Something went wrong", message: "Please try again in a moment." };
  if (/session.{0,10}expired|token.{0,10}invalid/i.test(msg))
    return { title: "Session expired", message: "Please sign in again." };
  // Zod / server validation JSON array: [{"code":"too_small","path":["username"],...}]
  if (msg.startsWith("[")) {
    try {
      const issues = JSON.parse(msg);
      if (Array.isArray(issues) && issues.length > 0) {
        const fieldMap = { username: "username", password: "password" };
        const parts = issues.map(i => {
          const f = i?.path?.[0];
          if (i?.code === "too_small" && f === "username") return "Please enter your username.";
          if (i?.code === "too_small" && f === "password") return "Please enter your password.";
          if (f) return `Please check the ${fieldMap[f] || f} field.`;
          return "Please fill in all required fields.";
        });
        return { title: null, message: parts.join(" ") };
      }
    } catch { /* not JSON, fall through */ }
  }
  return { title: null, message: msg };
}

export function toastErr(err) {
  const { title, message } = friendlyError(err);
  return title ?? message;
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
