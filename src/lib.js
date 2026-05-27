// ---- API client ----
const TOKEN_KEY = "bedflow_token";
const USER_KEY = "bedflow_user";

const BASE_API = "https://bedflow-backend.onrender.com";


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
  // New backend takes wardId + vacant + reserved; occupied is auto-calculated server-side.
  setWard: (wardId, vacant, reserved) =>
    req("/pre/ward", { method: "POST", body: JSON.stringify({ wardId, vacant, reserved }) }),
  submitRound: () => req("/pre/submit", { method: "POST" }),
  cooOverview: () => req("/coo/overview"),
  cooAudit: () => req("/coo/audit"),
  cooCompliance: () => req("/coo/compliance"),
  // manager
  mgrUsers: () => req("/manager/users"),
  mgrWards: () => req("/manager/wards"),
  mgrFloors: () => req("/manager/floors"),
  mgrCreatePre: (data) => req("/manager/pre", { method: "POST", body: JSON.stringify(data) }),
  mgrEditPre: (id, data) => req(`/manager/pre/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrCreateWard: (data) => req("/manager/wards", { method: "POST", body: JSON.stringify(data) }),
  mgrEditWard: (id, data) => req(`/manager/wards/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  mgrDeleteWard: (id) => req(`/manager/wards/${id}`, { method: "DELETE" }),
  // FIX: new endpoints for PRE delete and floor reassignment
  mgrDeletePre: (id) => req(`/manager/pre/${id}`, { method: "DELETE" }),
  mgrSetPreFloor: (preCode, floor) =>
    req(`/manager/pre/${encodeURIComponent(preCode)}/floor`, {
      method: "PUT",
      body: JSON.stringify({ floor }),
    }),
  mgrHistoryDates: () => req("/manager/history/dates"),
  mgrHistory: (date, pre) => req(`/manager/history?date=${date}${pre ? "&pre=" + pre : ""}`),
  pushSubscribe: (subscription) =>
    req("/push/subscribe", { method: "POST", body: JSON.stringify({ subscription }) }),
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

// ---- time formatting ----
export function fmtTime(d) { return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
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
