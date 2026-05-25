import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { api, getUser, clearSession, stopAlarm } from "./lib.js";
import { enablePush } from "./push.js";
import Login from "./Login.jsx";
import PREApp from "./PREApp.jsx";
import COOApp from "./COOApp.jsx";
import ManagerApp from "./ManagerApp.jsx";

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

  if (!user) return <Login onLogin={onLogin} />;
  if (!meta) return null;
  if (user.role === "COO") return <COOApp user={user} meta={meta} onLogout={logout} />;
  if (user.role === "MANAGER") return <ManagerApp user={user} onLogout={logout} />;
  return <PREApp user={user} meta={meta} onLogout={logout} />;
}

createRoot(document.getElementById("root")).render(<App />);
