import React, { useState, useEffect } from "react";
import { api, setSession } from "./lib.js";
import { Ic, icons, ThemeToggle } from "./ui.jsx";
import { InstallBanner } from "./pwa.jsx";
import { platformAvailable, fingerprintEnrolled, unlockWithFingerprint, enrollFingerprint } from "./passkey.js";

export default function Login({ onLogin }) {
  const [role, setRole] = useState("PRE");
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [fpReady, setFpReady] = useState(false);
  const [enrollData, setEnrollData] = useState(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => { setFpReady((await platformAvailable()) && fingerprintEnrolled()); })();
  }, []);

  const finish = (token, user, username) => {
    setSession(token, user);
    platformAvailable().then((ok) => {
      if (ok && !fingerprintEnrolled()) setEnrollData({ username, token, user });
      else onLogin(user);
    });
  };

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const { token, user } = await api.login(u.trim(), p, role);
      finish(token, user, u.trim().toLowerCase());
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const fingerprintLogin = async () => {
    setErr("");
    try {
      const { token, user } = await unlockWithFingerprint();
      setSession(token, user);
      onLogin(user);
    } catch (e) { setErr("Fingerprint unlock failed — sign in with password"); }
  };

  const doEnroll = async () => {
    try {
      await enrollFingerprint(enrollData.username, enrollData.token, enrollData.user);
      onLogin(enrollData.user);
    } catch (e) { onLogin(enrollData.user); }
  };

  if (enrollData) {
    return (
      <div className="app">
        <InstallBanner />
        <div className="pad" style={{ paddingTop: 90 }}>
          <div className="card slide-up" style={{ padding: 22, textAlign: "center" }}>
            <div style={{ color: "var(--teal)", display: "flex", justifyContent: "center", marginBottom: 14 }}>
              <Ic d={icons.finger} s={44} />
            </div>
            <div className="h1" style={{ fontSize: 19 }}>Enable fingerprint?</div>
            <div className="dim" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
              Next time, unlock instantly with your fingerprint instead of typing your password on this device.
            </div>
            <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} onClick={doEnroll}>
              <Ic d={icons.finger} s={18} /> Enable fingerprint
            </button>
            <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => onLogin(enrollData.user)}>
              Not now
            </button>
          </div>
        </div>
      </div>
    );
  }

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

        {/* live clock */}
        <div className="card slide-up" style={{ padding: "14px 18px", marginTop: 18, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 10 }}>
            <span style={{ color: "var(--teal)" }}><Ic d={icons.clock} s={20} /></span>
            <div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "0.02em" }}>
                {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </div>
              <div className="dim" style={{ fontSize: 11 }}>
                {now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </div>
            </div>
          </div>
        </div>

        {fpReady && (
          <button className="btn btn-primary btn-block slide-up" style={{ marginTop: 26 }} onClick={fingerprintLogin}>
            <Ic d={icons.finger} s={20} /> Unlock with fingerprint
          </button>
        )}

        <div className="card slide-up" style={{ padding: 18, marginTop: fpReady ? 14 : 28, animationDelay: ".05s" }}>
          {fpReady && <div className="dim" style={{ fontSize: 11, textAlign: "center", marginBottom: 14, textTransform: "uppercase", letterSpacing: ".06em" }}>or sign in with password</div>}
          <div className="seg" style={{ marginBottom: 18 }}>
            <button className={role === "PRE" ? "on" : ""} onClick={() => { setRole("PRE"); setErr(""); }}>PRE</button>
            <button className={role === "MANAGER" ? "on" : ""} onClick={() => { setRole("MANAGER"); setErr(""); }}>Manager</button>
            <button className={role === "COO" ? "on" : ""} onClick={() => { setRole("COO"); setErr(""); }}>COO</button>
          </div>

          <label className="label">Username</label>
          <input className="field" placeholder={role === "PRE" ? "e.g. pre1" : role === "MANAGER" ? "manager" : "coo"} value={u}
                 autoCapitalize="none" autoCorrect="off"
                 onChange={(e) => { setU(e.target.value); setErr(""); }} />
          <div style={{ height: 14 }} />
          <label className="label">Password</label>
          <input className="field" type="password" placeholder="******" value={p}
                 onChange={(e) => { setP(e.target.value); setErr(""); }}
                 onKeyDown={(e) => e.key === "Enter" && submit()} />

          {err && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 12, fontWeight: 600 }}>{err}</div>}

          <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} disabled={busy} onClick={submit}>
            {busy ? "Signing in…" : `Sign in as ${role}`}
          </button>
        </div>
      </div>
    </div>
  );
}
