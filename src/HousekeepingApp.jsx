import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, toastErr, getSocket, onReconnect } from "./lib.js";
import { AppShell } from "./shell.jsx";
import { Ic, icons } from "./ui.jsx";
import { RelativeTime } from "./relativeClock.jsx";

/** How long this bed has been waiting, against the configured turnaround. */
function minutesSince(ts) {
  return Math.max(0, Math.floor((Date.now() - Number(ts || 0)) / 60000));
}

/** Small muted icon + label, the way Airtasker stacks a task's facts. Reads far
 *  better on a phone than one dense comma-separated line. */
function Meta({ icon, children, strong }) {
  return (
    <div className={"hk-meta" + (strong ? " hk-meta--strong" : "")}>
      <Ic d={icon} s={13} />
      <span>{children}</span>
    </div>
  );
}

function BedCard({ bed, tat, busy, onStart, onComplete }) {
  const waiting = bed.task_id ? minutesSince(bed.created_at) : 0;
  const over = !!bed.task_id && waiting > Number(bed.expected_minutes || tat);
  const inProgress = bed.task_status === "IN_PROGRESS";

  // No open task: a heads-up only. A discharge is running, so this bed is
  // likely freeing soon. Nothing to do, so it carries no buttons and no clock.
  if (!bed.task_id) {
    return (
      <div className="hk-card hk-card--soon">
        <div className="hk-card-head">
          <div className="hk-bedname">{bed.bed_name}</div>
          <span className="hk-pill hk-pill--soon">Freeing soon</span>
        </div>
        <Meta icon={icons.clock}>Discharge in progress, not free yet</Meta>
      </div>
    );
  }

  return (
    <div className={"hk-card" + (over ? " hk-card--over" : inProgress ? " hk-card--doing" : "")}>
      <div className="hk-card-head">
        <div className="hk-bedname">{bed.bed_name}</div>
        <span className={"hk-pill" + (over ? " hk-pill--over" : inProgress ? " hk-pill--doing" : "")}>
          {over ? `${waiting}m overdue` : inProgress ? "In progress" : "To clean"}
        </span>
      </div>

      <Meta icon={icons.clock}>Free <RelativeTime ts={bed.created_at} /></Meta>
      <Meta icon={bed.source === "TRANSFER" ? icons.exchange : icons.logout}>
        {bed.source === "TRANSFER" ? "After a transfer" : "After a discharge"}
      </Meta>
      {bed.claimed_name && (
        <Meta icon={icons.user} strong>{bed.claimed_name} started <RelativeTime ts={bed.claimed_at} /></Meta>
      )}
      {!bed.operational_status && (
        <div className="hk-warn"><Ic d={icons.alert} s={13} /> Bed is out of service — contact the admin</div>
      )}

      <div className="hk-actions">
        {!inProgress && (
          <button className="hk-btn hk-btn--ghost" disabled={busy} onClick={() => onStart(bed.id)}>
            Start
          </button>
        )}
        <button className="hk-btn hk-btn--go" disabled={busy} onClick={() => onComplete(bed.id)}>
          <Ic d={icons.check} s={15} /> Mark clean
        </button>
      </div>
    </div>
  );
}

export default function HousekeepingApp({ user, onLogout }) {
  const [board, setBoard] = useState(null);
  const [err, setErr] = useState("");
  const [zoneId, setZoneId] = useState(null);
  const [busyBed, setBusyBed] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [toast, setToast] = useState("");
  const isManager = user.role === "HOUSEKEEPING_MANAGER";

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2200); }, []);

  /** Called once on mount and once per reconnect. Everything in between arrives
   *  as a per-bed delta — this is the recovery path, not a refresh loop. */
  const load = useCallback(() => {
    api.hkBoard()
      .then((d) => { setBoard(d); setErr(""); })
      .catch((e) => setErr(toastErr(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Live: patch one bed, never refetch the board ───────────────────────────
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    const socket = getSocket();
    const onBed = (b) => {
      if (!b || b.id == null) return;
      setBoard((prev) => {
        if (!prev) return prev;
        let touched = false;
        const zones = prev.zones.map((z) => ({
          ...z,
          wards: z.wards.map((w) => {
            if (Number(w.id) !== Number(b.ward_id)) return w;
            const has = w.beds.some((x) => Number(x.id) === Number(b.id));
            // Clean again, and it leaves the board entirely.
            if (!b.housekeeping_status && !b.task_id) {
              if (!has) return w;
              touched = true;
              return { ...w, beds: w.beds.filter((x) => Number(x.id) !== Number(b.id)) };
            }
            touched = true;
            return has
              ? { ...w, beds: w.beds.map((x) => (Number(x.id) === Number(b.id) ? { ...x, ...b } : x)) }
              : { ...w, beds: [...w.beds, b] };
          }),
        }));
        return touched ? { ...prev, zones } : prev;
      });
    };
    socket.on("hk:bed", onBed);
    const offReconnect = onReconnect(socket, () => loadRef.current());
    return () => { socket.off("hk:bed", onBed); offReconnect(); };
  }, []);

  const act = async (bedId, fn, msg) => {
    setBusyBed(bedId);
    try { await fn(bedId); showToast(msg); }
    catch (e) { showToast(toastErr(e)); load(); }   // resync only when we were wrong
    finally { setBusyBed(null); }
  };
  const start = (bedId) => act(bedId, api.hkStart, "Started");
  const complete = (bedId) => act(bedId, api.hkComplete, "Marked clean");

  const zones = board?.zones || [];
  const zone = zones.find((z) => z.id === zoneId) || zones[0] || null;
  const tat = board?.tat ?? 10;
  const menu = zones.map((z) => ({ key: String(z.id), icon: icons.bed, label: z.name }));

  const all = (zone?.wards || []).flatMap((w) => w.beds);
  const isOver = (b) => b.task_id && minutesSince(b.created_at) > Number(b.expected_minutes || tat);
  const counts = {
    ALL:     all.filter((b) => b.task_id).length,
    PENDING: all.filter((b) => b.task_status === "PENDING").length,
    DOING:   all.filter((b) => b.task_status === "IN_PROGRESS").length,
    OVER:    all.filter(isOver).length,
    SOON:    all.filter((b) => !b.task_id).length,
  };
  // Chips only for states that exist — an empty "Overdue (0)" is noise on a
  // phone, and this list is read at a glance in a corridor.
  const CHIPS = [
    // "All", not "To clean": it includes the in-progress ones, and two chips
    // reading (1) each would look like two beds when it is one counted twice.
    ["ALL", "All", counts.ALL],
    ["DOING", "In progress", counts.DOING],
    ["OVER", "Overdue", counts.OVER],
    ["SOON", "Freeing soon", counts.SOON],
  ].filter(([k, , n]) => k === "ALL" || n > 0);

  const keep = (b) =>
    filter === "ALL"   ? !!b.task_id
    : filter === "DOING" ? b.task_status === "IN_PROGRESS"
    : filter === "OVER"  ? isOver(b)
    : !b.task_id;
  const wards = (zone?.wards || [])
    .map((w) => ({ ...w, beds: w.beds.filter(keep) }))
    .filter((w) => w.beds.length > 0);

  return (
    <AppShell
      menu={menu.length ? menu : [{ key: "none", icon: icons.bed, label: "No zones" }]}
      active={String(zone?.id ?? "none")}
      onSelect={(k) => setZoneId(Number(k))}
      title={zone ? zone.name : "Housekeeping"}
      user={{ name: user.name || user.username || "Housekeeping",
              role: isManager ? "HK MANAGER" : "HOUSEKEEPING" }}
      onLogout={onLogout}
    >
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginBottom: 10 }}>{err}</div>}

      {board && zones.length === 0 && (
        <div className="card empty" style={{ padding: 32 }}>
          <Ic d={icons.bed} s={28} />
          <div style={{ marginTop: 10, fontWeight: 700, fontSize: 14 }}>No zones assigned</div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            Ask your administrator to add you to a housekeeping zone.
          </div>
        </div>
      )}

      {zone && (
        <>
          {/* One line that answers "how much is left" — the shape Tiimo uses,
              rather than a grid of stat cards that pushes the work off screen. */}
          <div className="hk-summary">
            <div className="hk-count">
              <b>{counts.ALL}</b>
              <span>{counts.ALL === 1 ? "bed to clean" : "beds to clean"}</span>
            </div>
            <div className="hk-tat"><Ic d={icons.clock} s={13} /> {tat} min turnaround</div>
          </div>

          <div className="chip-row" role="group" aria-label="Filter beds">
            {CHIPS.map(([key, label, n]) => (
              <button key={key}
                className={"fchip" + (key === "OVER" ? " warn" : "") + (filter === key ? " on" : "")}
                aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {key === "OVER" && <Ic d={icons.alert} s={13} />}
                {label} <span className="n">({n})</span>
              </button>
            ))}
          </div>

          {wards.length === 0 && (
            <div className="card empty" style={{ padding: 30 }}>
              <Ic d={icons.check} s={26} />
              <div style={{ marginTop: 10, fontWeight: 700, fontSize: 14 }}>
                {counts.ALL === 0 ? "Everything is clean" : "Nothing in this filter"}
              </div>
              <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                {counts.ALL === 0
                  ? "Beds appear here the moment one is freed."
                  : "Try another filter above."}
              </div>
            </div>
          )}

          {/* Grouped by ward with a count, the way monday.com heads its groups —
              a cleaner works one ward at a time, not one hospital at a time. */}
          {wards.map((w) => (
            <div key={w.id} className="hk-ward">
              <div className="hk-ward-head">
                <span className="hk-ward-name">{w.name}</span>
                <span className="hk-ward-count">{w.beds.length}</span>
                {!w.operational && (
                  <span className="hk-ward-oos">out of service, contact the admin</span>
                )}
              </div>
              <div className="hk-grid">
                {w.beds.map((b) => (
                  <BedCard key={b.id} bed={b} tat={tat} busy={busyBed === b.id}
                    onStart={start} onComplete={complete} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </AppShell>
  );
}
