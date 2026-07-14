import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, toastErr, createSocket, fmtRelative } from "./lib.js";
import { AppShell } from "./shell.jsx";
import { Ic, icons } from "./ui.jsx";
import { fmtIpLast6 } from "./bedUtils.js";

function PendingRow({ row, actionLabel, onComplete, busy }) {
  return (
    <div className="card" style={{ padding: 14, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 600 }}>{row.ward_name} · {row.bed_name}</div>
        <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
          {fmtIpLast6(row.ip_last6)} · Discharge {row.status === "DISCHARGE_INITIATED" ? "initiated" : "in progress"} · updated {fmtRelative(row.updated_at)}
        </div>
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={() => onComplete(row.admission_id)}>
        <Ic d={icons.check} s={14} /> {actionLabel}
      </button>
    </div>
  );
}

export default function FCApp({ user, onLogout }) {
  const [billReady, setBillReady] = useState(null);
  const [paymentPending, setPaymentPending] = useState(null);
  const [counts, setCounts] = useState(null);
  const [toast, setToast] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const loadRef = useRef(() => {});

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2200); }, []);

  const load = useCallback(async () => {
    try {
      const [billRes, payRes, dash] = await Promise.all([
        api.dischargesPendingStep("BILL_READY"),
        api.dischargesPendingStep("PAYMENT"),
        api.dischargeDashboard(),
      ]);
      setBillReady(billRes.discharges || []);
      setPaymentPending(payRes.discharges || []);
      setCounts(dash);
      setLastSync(new Date());
    } catch (e) {
      if (e?.message === "Unauthorized") return;
      showToast(toastErr(e));
    }
  }, [showToast]);
  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const socket = createSocket();
    socket.on("discharge:update", () => loadRef.current());
    socket.on("connect", () => loadRef.current());
    return () => { socket.disconnect(); };
  }, []);

  const completeBillReady = async (admissionId) => {
    setBusyId(admissionId);
    try {
      await api.dischargeUpdateStep(admissionId, "BILL_READY", "COMPLETED");
      showToast("Bill marked ready");
      await load();
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusyId(null); }
  };

  const completePayment = async (admissionId) => {
    setBusyId(admissionId);
    try {
      await api.dischargeUpdateStep(admissionId, "PAYMENT", "COMPLETED");
      showToast("Payment marked complete");
      await load();
    } catch (e) { showToast(toastErr(e)); }
    finally { setBusyId(null); }
  };

  if (billReady === null) return (
    <div className="empty" style={{ paddingTop: 120 }}>
      <span className="spin" style={{ display: "inline-block" }}><Ic d={icons.refresh} s={26} /></span>
      <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>Loading…</div>
    </div>
  );

  return (
    <AppShell
      menu={[{ key: "dash", icon: icons.home, label: "Dashboard" }]}
      active="dash"
      onSelect={() => {}}
      title="Finance Coordinator"
      user={{ name: user.name || user.username || "FC", role: "FC" }}
      onLogout={onLogout}
      topExtra={
        <button onClick={load} className="appbar-btn" title="Refresh">
          <Ic d={icons.refresh} s={17} />
        </button>
      }
    >
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat"><div className="n" style={{ fontSize: 18 }}>{counts?.billReady ?? "—"}</div><div className="l">BILL READY PENDING</div></div>
        <div className="stat"><div className="n" style={{ fontSize: 18 }}>{counts?.paymentPending ?? "—"}</div><div className="l">PAYMENT PENDING</div></div>
        <div className="stat"><div className="n" style={{ fontSize: 18 }}>{counts?.completedToday ?? "—"}</div><div className="l">COMPLETED TODAY</div></div>
        <div className="stat">
          <div className="n" style={{ fontSize: 18 }}>{lastSync ? lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</div>
          <div className="l">LAST UPDATE</div>
        </div>
      </div>

      <div className="floor-head">Bill Ready — pending</div>
      {billReady.length === 0 ? (
        <div className="card empty" style={{ marginTop: 8, marginBottom: 18 }}>
          <Ic d={icons.fileText} s={28} />
          <div style={{ marginTop: 8, fontSize: 13 }} className="dim">Nothing waiting on Bill Ready.</div>
        </div>
      ) : (
        <div style={{ marginBottom: 18 }}>
          {billReady.map((row) => (
            <PendingRow key={row.admission_id} row={row} actionLabel="Mark Bill Ready" onComplete={completeBillReady} busy={busyId === row.admission_id} />
          ))}
        </div>
      )}

      <div className="floor-head">Payment — pending</div>
      {paymentPending.length === 0 ? (
        <div className="card empty" style={{ marginTop: 8 }}>
          <Ic d={icons.banknote} s={28} />
          <div style={{ marginTop: 8, fontSize: 13 }} className="dim">Nothing waiting on Payment.</div>
        </div>
      ) : (
        paymentPending.map((row) => (
          <PendingRow key={row.admission_id} row={row} actionLabel="Mark Payment Done" onComplete={completePayment} busy={busyId === row.admission_id} />
        ))
      )}

      {toast && <div className="toast">{toast}</div>}
    </AppShell>
  );
}
