import { useEffect, useState } from "react";
import { fmtRelative, toMs } from "./lib.js";

/* A single clock for every "3m ago" label in the app.
 *
 * fmtRelative() renders a string once and nothing ever rewrites it, so a screen
 * left open keeps claiming "2h ago" hours later. The data is not stale — a
 * socket event still delivers real changes instantly — but the SENTENCE about
 * the data is, and on a monitoring dashboard that is the more dangerous of the
 * two: a ward confirmed at 09:00 still reads "Reviewed 2h ago" at 17:00.
 *
 * This never fetches anything. It re-runs the subtraction (now - timestamp) the
 * browser already did, against data already in memory.
 *
 * ONE timer for the whole app rather than one per screen or one per row — the
 * same shape as the shared socket and the caches in lib.js. Subscribers are
 * notified together, so a 36-row table costs one tick, not 36.
 */

const subscribers = new Set();   // fn -> called on each tick
const spans = new Map();         // subscriber -> age in ms of the value it renders
let timer = null;
let currentDelay = null;

/* Tick about twice as often as the text can actually change, which is decided
 * by whichever band fmtRelative() is in (see lib.js):
 *
 *   < 45s     "Just now"  -> flips once, at 45s        -> 10s
 *   < 60m     "Xm ago"    -> changes once a minute     -> 30s
 *   < 24h     "Xh ago"    -> changes once an hour      -> 5m
 *   >= 24h    "Xd ago"    -> changes once a day        -> stop
 *
 * Paced off the FRESHEST value on screen, since one clock serves everyone: the
 * stale rows redraw needlessly, but redrawing a six-character string is free
 * next to running a 10s timer all day for a table reading "3d ago". */
export function tickDelayFor(youngestMs) {
  if (youngestMs == null || !Number.isFinite(youngestMs)) return null;
  if (youngestMs < 45 * 1000) return 10 * 1000;
  if (youngestMs < 60 * 60 * 1000) return 30 * 1000;
  if (youngestMs < 24 * 60 * 60 * 1000) return 5 * 60 * 1000;
  return null;                       // days old — nothing will change today
}

function youngest() {
  let min = null;
  for (const ms of spans.values()) {
    if (ms == null || !Number.isFinite(ms)) continue;
    if (min == null || ms < min) min = ms;
  }
  return min;
}

function reschedule() {
  const want = document.hidden ? null : tickDelayFor(youngest());
  if (want === currentDelay) return;          // already running at the right pace
  if (timer) { clearInterval(timer); timer = null; }
  currentDelay = want;
  if (want == null) return;                   // nothing worth ticking for
  timer = setInterval(() => {
    for (const fn of subscribers) fn();
    reschedule();                             // values age; the pace may need to drop
  }, want);
}

/* Hidden tab: stop entirely. A dashboard nobody is looking at should not be
 * redrawing on a phone in someone's pocket. Times are always derived from the
 * stored timestamp rather than accumulated, so nothing drifts while paused —
 * one redraw on return is enough to be correct again. */
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) for (const fn of subscribers) fn();
    reschedule();
  });
}

/** Re-renders the calling component as its relative label falls due.
 *  `ts` is the timestamp being displayed (ms epoch), used only to pace the
 *  clock. Returns nothing — call fmtRelative(ts) as before. */
export function useRelativeClock(ts) {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    subscribers.add(fn);
    // toMs, not Number: some legacy rows store epoch SECONDS and Postgres hands
    // bigints back as strings. fmtRelative normalises both the same way, so
    // pacing has to as well — otherwise a seconds-based row computes an absurd
    // age, lands in the "days old" band and silently never ticks.
    spans.set(fn, ts == null ? null : Date.now() - toMs(ts));
    reschedule();
    return () => { subscribers.delete(fn); spans.delete(fn); reschedule(); };
  }, [ts]);
}

/** Drop-in for `{fmtRelative(ts)}` that keeps itself current.
 *
 *  A COMPONENT rather than a bare hook because most of these labels render
 *  inside `.map()` over rows (PWO's complaint queue, FC's reopen requests, the
 *  ward tables). Hooks cannot be called in a loop — the count would change with
 *  the row count and React would throw. Each rendered element being its own
 *  component sidesteps that entirely, and means a tick redraws just this span
 *  rather than the table around it.
 *
 *  Output is identical to fmtRelative(), including "—" for a missing value, so
 *  swapping one for the other changes nothing on screen. */
export function RelativeTime({ ts }) {
  useRelativeClock(ts);
  return <>{fmtRelative(ts)}</>;
}
