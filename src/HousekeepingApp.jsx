import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, toastErr, getSocket, onReconnect } from "./lib.js";
import { AppShell } from "./shell.jsx";
import { Ic, icons } from "./ui.jsx";
import { RelativeTime } from "./relativeClock.jsx";

/** How long this bed has been waiting, against the configured turnaround. */
function minutesSince(ts) {
  return Math.max(0, Math.floor((Date.now() - Number(ts || 0)) / 60000));
}

/** One bed. Overdue tints the whole card rather than just its edge — an edge
 *  colour is easy to miss at arm's length, a tinted card is not. */
function BedBox({ bed, tat, busy, onStart, onComplete }) {
  const mins = bed.task_id ? minutesSince(bed.created_at) : 0;
  const limit = Number(bed.expected_minutes || tat);
  const over = !!bed.task_id && mins > limit;
  const doing = bed.task_status === "IN_PROGRESS";
  const state = !bed.task_id ? "idle" : over ? "over" : doing ? "doing" : "wait";

  return (
    <article className={"hk-bed is-" + state}>
      <header className="hk-bed-top">
        <h4 className="hk-bed-id">{bed.bed_name}</h4>
        {bed.task_id && (
          <span className="hk-bed-age">{over ? `${mins}m` : doing ? "cleaning" : `${mins}m`}</span>
        )}
      </header>

      <p className="hk-bed-line">
        {!bed.task_id ? "Discharge running"
          : doing ? <><b>{bed.claimed_name || "Someone"}</b> started <RelativeTime ts={bed.claimed_at} /></>
          : <>Free after a {bed.source === "TRANSFER" ? "transfer" : "discharge"}</>}
      </p>
      {!bed.operational_status && bed.task_id && (
        <p className="hk-bed-flag">Bed out of service</p>
      )}

      {bed.task_id && (
        <footer className="hk-bed-act">
          {!doing && (
            <button className="hk-b hk-b-alt" disabled={busy} onClick={() => onStart(bed.id)}>Start</button>
          )}
          <button className="hk-b hk-b-main" disabled={busy} onClick={() => onComplete(bed.id)}>
            <Ic d={icons.check} s={16} /> Clean
          </button>
        </footer>
      )}
    </article>
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
  const tat = board?.tat ?? 10;

  const isOver = (bd) => bd.task_id && minutesSince(bd.created_at) > Number(bd.expected_minutes || tat);
  const openTask = (bd) => !!bd.task_id;

  const everyBed = zones.flatMap((z) => z.wards.flatMap((w) => w.beds));
  const counts = {
    ALL:   everyBed.filter(openTask).length,
    DOING: everyBed.filter((bd) => bd.task_status === "IN_PROGRESS").length,
    OVER:  everyBed.filter(isOver).length,
    SOON:  everyBed.filter((bd) => !bd.task_id).length,
  };
  const CHIPS = [
    ["ALL", "All", counts.ALL],
    ["DOING", "In progress", counts.DOING],
    ["OVER", "Overdue", counts.OVER],
    ["SOON", "Freeing soon", counts.SOON],
  ].filter(([k, , n]) => k === "ALL" || n > 0);

  const keep = (bd) =>
    filter === "ALL"     ? openTask(bd)
    : filter === "DOING" ? bd.task_status === "IN_PROGRESS"
    : filter === "OVER"  ? isOver(bd)
    : !bd.task_id;

  // Every zone stays on the page. A zone with nothing to do collapses to one
  // line rather than disappearing — a cleaner covering three zones needs to see
  // that the other two are genuinely clear, not just absent.
  const view = zones.map((z) => {
    const wards = z.wards
      .map((w) => ({ ...w, beds: w.beds.filter(keep) }))
      .filter((w) => w.beds.length > 0);
    const beds = wards.flatMap((w) => w.beds);
    return { ...z, wards, total: beds.length, over: beds.filter(isOver).length };
  });

  return (
    <AppShell
      menu={[{ key: "board", icon: icons.bed, label: "Housekeeping" }]}
      active="board"
      onSelect={() => {}}
      title="Housekeeping"
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

      {zones.length > 0 && (
        <>
          {/* A strip of figures rather than one big number: it tells the
              cleaner what is waiting, what is running late, and how long they
              have, in the order they care about. */}
          <div className="hk-strip">
            <div className="hk-fig">
              <b>{counts.ALL}</b>
              <i>waiting</i>
            </div>
            <div className={"hk-fig" + (counts.OVER ? " is-bad" : "")}>
              <b>{counts.OVER}</b>
              <i>overdue</i>
            </div>
            <div className="hk-fig">
              <b>{tat}<em>m</em></b>
              <i>turnaround</i>
            </div>
          </div>

          {/* Sticky: the list is long and the filters must stay in thumb reach. */}
          <div className="hk-filters">
            {CHIPS.map(([key, label, n]) => (
              <button key={key}
                className={"hk-chip" + (key === "OVER" && n ? " is-bad" : "") + (filter === key ? " is-on" : "")}
                aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {label}<span>{n}</span>
              </button>
            ))}
          </div>

          {view.map((z) => (
            <section key={z.id} className="hk-zone">
              <header className="hk-zone-top">
                <span className="hk-zone-mark">{z.name.charAt(0).toUpperCase()}</span>
                <h2 className="hk-zone-name">{z.name}</h2>
                {z.over > 0 && <span className="hk-tag is-bad">{z.over} overdue</span>}
                <span className="hk-tag">{z.total || "0"}</span>
              </header>

              {z.wards.length === 0 ? (
                <p className="hk-zone-clear">All clear</p>
              ) : z.wards.map((w) => (
                <div key={w.id} className="hk-ward">
                  <div className="hk-ward-top">
                    <h3 className="hk-ward-name">{w.name}</h3>
                    {!w.operational && <span className="hk-tag is-bad">out of service</span>}
                  </div>
                  <div className="hk-beds">
                    {w.beds.map((bd) => (
                      <BedBox key={bd.id} bed={bd} tat={tat} busy={busyBed === bd.id}
                        onStart={start} onComplete={complete} />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </AppShell>
  );
}
