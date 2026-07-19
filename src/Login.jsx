import React, { useState, useEffect, useCallback } from "react";
import { api, setSession, friendlyError } from "./lib.js";
import { Ic, icons, ThemeToggle } from "./ui.jsx";
import { InstallBanner } from "./pwa.jsx";

export default function Login({ onLogin, sessionMsg }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(new Date());

  const showToast = useCallback((m) => {
    setToast(m);
    setTimeout(() => setToast(""), 3000);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (sessionMsg) showToast(sessionMsg);
  }, [sessionMsg, showToast]);

  const submit = async () => {
    if (!u.trim()) { showToast("Please enter your username."); return; }
    if (!p)        { showToast("Please enter your password."); return; }
    setBusy(true);
    try {
      const { token, user } = await api.login(u.trim(), p);
      setSession(token, user);
      onLogin(user);
    } catch (e) { showToast(friendlyError(e).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="app">
      <InstallBanner />
      <div className="pad" style={{ paddingTop: 64 }}>
        <div className="slide-up" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="logo">B</div>
            <div>
              <div className="h1">BedFlow</div>
              <div className="dim" style={{ fontSize: 12 }}>Live hospital bed management</div>
            </div>
          </div>
          <ThemeToggle />
        </div>

        <div className="card slide-up" style={{ padding: "14px 18px", marginTop: 18, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 10 }}>
            <span style={{ color: "var(--teal)" }}><Ic d={icons.clock} s={20} /></span>
            <div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "0.02em" }}>
                {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" })}
              </div>
              <div className="dim" style={{ fontSize: 11 }}>
                {now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </div>
            </div>
          </div>
        </div>

        <div className="card slide-up" style={{ padding: 18, marginTop: 28, animationDelay: ".05s" }}>
          <label className="label">Username</label>
          <input className="field" maxLength={60}
            placeholder="Enter your username"
            value={u}
            autoCapitalize="none" autoCorrect="off"
            onChange={(e) => setU(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && document.getElementById("pwd")?.focus()} />
          <div style={{ height: 14 }} />
          <label className="label">Password</label>
          <div style={{ position: "relative" }}>
            <input id="pwd" className="field" type={showPwd ? "text" : "password"} placeholder="••••••" maxLength={72} value={p}
              style={{ paddingRight: 42 }}
              onChange={(e) => setP(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              style={{
                position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", padding: 0, cursor: "pointer",
                color: "var(--ink-3)", display: "flex", alignItems: "center",
              }}
              aria-label={showPwd ? "Hide password" : "Show password"}
            >
              <Ic d={showPwd ? icons.eyeOff : icons.eye} s={18} />
            </button>
          </div>

          <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} disabled={busy} onClick={submit}>
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
