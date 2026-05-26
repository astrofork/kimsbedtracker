import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { api, getUser, clearSession, stopAlarm } from "./lib.js";
import { enablePush } from "./push.js";
import { initTheme } from "./ui.jsx";
import Login from "./Login.jsx";
import PREApp from "./PREApp.jsx";
import COOApp from "./COOApp.jsx";
import ManagerApp from "./ManagerApp.jsx";

// Apply saved theme before first paint — prevents flash-of-wrong-theme.
initTheme();

function App() {
  const [user, setUser] = useState(() => getUser());
  const [meta, setMeta] = useState(null);

  useEffect(() => { api.meta().then(setMeta).catch(() => {}); }, []);

  // Register background push once we have a logged-in user + meta with VAPID key.
  useEffect(() => {
    if (user && meta?.vapidPublic) enablePush(meta.vapidPublic);
  }, [user, meta]);

  const onLogin = (u) => {
    setUser(u);
    if (meta?.vapidPublic) enablePush(meta.vapidPublic);
  };

  const logout = () => { stopAlarm(); clearSession(); setUser(null); };

  // When any API call gets a 401, lib.js fires this event.
  // We respond by stopping the alarm, clearing state, and showing the Login screen.
  useEffect(() => {
    const handleExpired = (e) => {
      stopAlarm();
      clearSession();
      setUser(null);
      // Show a toast-style alert after state updates so the login page is visible first.
      if (e.detail?.message) {
        setTimeout(() => alert(e.detail.message), 100);
      }
    };
    window.addEventListener("session:expired", handleExpired);
    return () => window.removeEventListener("session:expired", handleExpired);
  }, []);

  if (!user) return <Login onLogin={onLogin} />;
  if (!meta) return null;
  if (user.role === "COO") return <COOApp user={user} meta={meta} onLogout={logout} />;
  if (user.role === "MANAGER") return <ManagerApp user={user} onLogout={logout} />;
  return <PREApp user={user} meta={meta} onLogout={logout} />;
}

createRoot(document.getElementById("root")).render(<App />);
