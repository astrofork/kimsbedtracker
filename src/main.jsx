import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { api, getUser, clearSession, stopAlarm, disconnectSocket } from "./lib.js";
import { enablePush } from "./push.js";
import { initTheme, Ic, icons } from "./ui.jsx";
import { PwaManager } from "./pwa.jsx";
import { registerServiceWorker } from "./swRegistration.js";
import Login from "./Login.jsx";
import PREApp from "./PREApp.jsx";
import COOApp from "./COOApp.jsx";
import NurseApp from "./NurseApp.jsx";
import DoctorApp from "./DoctorApp.jsx";
import ConsultantApp from "./ConsultantApp.jsx";
import FCApp from "./FCApp.jsx";
import PharmacyApp from "./PharmacyApp.jsx";
import PWOApp from "./PWOApp.jsx";

// Apply saved theme before first paint — prevents flash-of-wrong-theme.
initTheme();

// Register the PWA service worker. The dev/prod URL split (and the fact that
// push.js registers too) lives in swRegistration.js — see the note there.
window.addEventListener("load", () => { registerServiceWorker(); });

function App() {
  const [user,      setUser]      = useState(() => getUser());
  const [meta,      setMeta]      = useState(null);
  const [metaError, setMetaError] = useState(false);
  const [sessionMsg, setSessionMsg] = useState("");

  const loadMeta = useCallback(() => {
    setMetaError(false);
    api.meta().then(setMeta).catch(() => setMetaError(true));
  }, []);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  // Register background push once we have a logged-in user + meta with VAPID key.
  useEffect(() => {
    if (user && meta?.vapidPublic) enablePush(meta.vapidPublic);
  }, [user, meta]);

  const onLogin = (u) => {
    setSessionMsg("");
    setUser(u);
    if (meta?.vapidPublic) enablePush(meta.vapidPublic);
  };

  const logout = () => { stopAlarm(); disconnectSocket(); clearSession(); setUser(null); };

  // When any API call gets a 401, lib.js fires this event.
  // We respond by stopping the alarm, clearing state, and showing the Login screen.
  useEffect(() => {
    const handleExpired = (e) => {
      stopAlarm();
      disconnectSocket();
      clearSession();
      setUser(null);
      if (e.detail?.message) setSessionMsg(e.detail.message);
    };
    window.addEventListener("session:expired", handleExpired);
    return () => window.removeEventListener("session:expired", handleExpired);
  }, []);

  if (!user) return <><Login onLogin={onLogin} sessionMsg={sessionMsg} /><PwaManager /></>;

  if (!meta) return (
    <div className="empty" style={{ paddingTop: 120 }}>
      {metaError ? (
        <>
          <div style={{ fontWeight: 600 }}>Unable to connect to server</div>
          <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>Check your network and try again.</div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={loadMeta}>
            <Ic d={icons.refresh} s={15} /> Retry
          </button>
        </>
      ) : (
        <>
          <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
          <div className="dim" style={{ marginTop: 12 }}>Loading…</div>
        </>
      )}
    </div>
  );
  // Billing and Audit run the FC app — same screens, queues filtered to their
  // own steps. See ROLE_STEPS in FCApp.jsx.
  if (["FC", "MASTER_FC", "AUDIT", "MASTER_AUDIT", "BILLING", "MASTER_BILLING"].includes(user.role))
    return <><FCApp user={user} meta={meta} onLogout={logout} /><PwaManager /></>;
  if (user.role === "COO")        return <><COOApp user={user} meta={meta} onLogout={logout} /><PwaManager /></>;
  if (user.role === "NURSE")      return <><NurseApp user={user} meta={meta} onLogout={logout} /><PwaManager /></>;
  if (user.role === "DOCTOR")     return <><DoctorApp user={user} meta={meta} onLogout={logout} /><PwaManager /></>;
  if (user.role === "PWO")        return <><PWOApp user={user} meta={meta} onLogout={logout} /><PwaManager /></>;
  if (user.role === "CONSULTANT") return <><ConsultantApp user={user} meta={meta} onLogout={logout} /><PwaManager /></>;
  if (user.role === "PHARMACY" || user.role === "MASTER_PHARMACY") return <><PharmacyApp user={user} meta={meta} onLogout={logout} /><PwaManager /></>;
  return <><PREApp user={user} meta={meta} onLogout={logout} /><PwaManager /></>;
}

createRoot(document.getElementById("root")).render(<App />);
