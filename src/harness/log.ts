// log.ts — the append-only event log on iii's file-backed state. Per-event keys (so appends
// never rewrite earlier entries — the monotonicity invariant) + a tiny atomic seq counter.
//
// Monotonic seq: one atomic `state::update increment` mints a unique, increasing number per
// appender (the same compare-and-claim the epoch fence uses); each appender owns its slot.
// NOTE: append is two ops (increment, then write) — NOT one atomic transaction — so a crash
// *between* them leaves a permanent GAP at the claimed seq. readLog and sweep tolerate gaps;
// the only consequence is an at-least-once re-run of that turn/tool, never corruption.

import type { DraftEvent, Event } from "./events";
import { META_SCOPE, instanceLabel, logScope, stDelete, stGet, stList, stSet, stUpdate } from "./iii";
import { sleep } from "../util";

const pad = (n: number): string => String(n).padStart(9, "0");

/** Atomically mint the next gapless seq for a session (initializes to 1 on first call). */
export async function nextSeq(sessionId: string): Promise<number> {
  const r = await stUpdate(META_SCOPE, sessionId, [{ type: "increment", path: "seq", by: 1 }]);
  const seq = r?.new_value?.seq;
  if (typeof seq !== "number") throw new Error(`nextSeq: unexpected state::update response: ${JSON.stringify(r)}`);
  return seq;
}

/** Append one event; assigns a monotonic seq + provenance. Returns the assigned seq.
 *  stSet is idempotent (same scope/key/value), so we retry transient failures to shrink the
 *  window where a claimed seq is left unwritten (a crash there still only leaves a benign gap). */
export async function appendEvent(sessionId: string, draft: DraftEvent): Promise<number> {
  const seq = await nextSeq(sessionId);
  const event = { ...draft, seq, by: instanceLabel() } as Event;
  for (let attempt = 1; ; attempt++) {
    try {
      await stSet(logScope(sessionId), pad(seq), event);
      return seq;
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(100 * attempt);
    }
  }
}

/** Read the full log, ordered by seq. Defensive about state::list returning bare values
 *  vs. {value} wrappers (the exact shape is engine-version dependent). */
export async function readLog(sessionId: string): Promise<Event[]> {
  const raw = await stList(logScope(sessionId));
  const events = (raw as any[])
    .map((v) => (v && typeof v === "object" && "kind" in v ? v : v?.value ?? v))
    .filter((e: any): e is Event => e && typeof e === "object" && typeof e.seq === "number" && typeof e.kind === "string");
  events.sort((a, b) => a.seq - b.seq);
  return events;
}

/** Best-effort wipe of a session's log + counter (per-event keys are deleted by seq). */
export async function resetSession(sessionId: string): Promise<void> {
  const meta = await stGet(META_SCOPE, sessionId);
  const seq = (meta?.seq ?? 0) as number;
  for (let i = 1; i <= seq; i++) await stDelete(logScope(sessionId), pad(i));
  await stDelete(META_SCOPE, sessionId);
}
