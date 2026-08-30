import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, toastErr, getSocket, onReconnect } from "./lib.js";
import { AppShell } from "./shell.jsx";
import { Ic, icons } from "./ui.jsx";
import { RelativeTime } from "./relativeClock.jsx";

/** How long this bed has been waiting, against the configured turnaround. */
function minutesSince(ts) {
  return Math.max(0, Math.floor((Date.now() - Number(ts || 0)) / 60000));
}

/** One bed, as its own small card inside its ward's card. Three nested levels,
 *  told apart by SURFACE rather than by three identical borders: the zone is
 *  raised, the ward is recessed inside it, and the bed is raised again. */
function BedBox({ bed, tat, busy, onStart, onComplete }) {
  const waiting = bed.task_id ? minutesSince(bed.created_at) : 0;
  const over = !!bed.task_id && waiting > Number(bed.expected_minutes || tat);
  const doing = bed.task_status === "IN_PROGRESS";
  const state = !bed.task_id ? "soon" : over ? "over" : doing ? "doing" : "wait";

  return (
    <div className={"hk-bedbox hk-bedbox--" + state}>
      <div className="hk-bedbox-head">
        <span className="hk-bedbox-name">{bed.bed_name}</span>
        <span className={"hk-bedbox-tag hk-bedbox-tag--" + state}>
          {!bed.task_id ? "Soon" : over ? `${waiting}m over` : doing ? "Cleaning" : "To clean"}
        </span>
      </div>

      <div className="hk-bedbox-sub">
        {!bed.task_id ? "Discharge running, not free yet"
          : doing ? <span className="hk-claim">{bed.claimed_name ? `${bed.claimed_name} started` : "Started"} <RelativeTime ts={bed.claimed_at} /></span>
          : <>Free <RelativeTime ts={bed.created_at} />, after a {bed.source === "TRANSFER" ? "transfer" : "discharge"}</>}
      </div>
      {!bed.operational_status && bed.task_id && (
        <div className="hk-bedbox-warn"><Ic d={icons.alert} s={12} /> Out of service, contact the admin</div>
      )}

      {bed.task_id && (
        <div className="hk-bedbox-act">
          {!doing && (
            <button className="hk-b hk-b--ghost" disabled={busy} onClick={() => onStart(bed.id)}>Start</button>
          )}
          <button className="hk-b hk-b--go" disabled={busy} onClick={() => onComplete(bed.id)}>
            <Ic d={icons.check} s={15} /> Clean
          </button>
        </div>
      )}
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

          {/* Zone box → ward boxes → bed boxes, exactly as asked, all on one
              page. The three levels are told apart by surface — raised,
              recessed, raised — so the nesting reads as depth instead of three
              identical outlines. */}
          {view.map((z) => (
            <section key={z.id} className="hk-zonebox">
              <div className="hk-zonebox-head">
                <span className="hk-zonebox-ic"><Ic d={icons.grid} s={16} /></span>
                <span className="hk-zonebox-name">{z.name}</span>
                <span className="hk-zonebox-sum">
                  {z.total === 0 ? "all clear" : `${z.total} to clean`}
                  {z.over > 0 && <em>, {z.over} overdue</em>}
                </span>
              </div>

              <div className="hk-zonebox-body">
                {z.wards.length === 0 ? (
                  <div className="hk-allclear">
                    <Ic d={icons.check} s={14} /> Nothing to clean in this zone
                  </div>
                ) : z.wards.map((w) => (
                  <div key={w.id} className="hk-wardbox">
                    <div className="hk-wardbox-head">
                      <span className="hk-wardbox-name">{w.name}</span>
                      <span className="hk-wardbox-pill">{w.beds.length}</span>
                      {!w.operational && <span className="hk-ward-oos">ward out of service</span>}
                    </div>
                    <div className="hk-bedgrid">
                      {w.beds.map((bd) => (
                        <BedBox key={bd.id} bed={bd} tat={tat} busy={busyBed === bd.id}
                          onStart={start} onComplete={complete} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </AppShell>
  );
}
