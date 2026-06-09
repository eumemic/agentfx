// window.ts — no-compaction windowing: a deterministic, chunked-snap slice of the log (NOT a
// summary). Old events are dropped from the FRONT only when over budget, in (max-min) chunks,
// so within a chunk the included prefix is byte-stable (prompt-cache friendly), exactly the
// shape aios uses. Old events are never destroyed — they remain in the log, addressable.
//
// Token estimate is intentionally cheap (~chars/4); at demo scale the window never snaps.

import type { Event } from "./events";

const estTokens = (e: Event): number => Math.ceil(JSON.stringify(e).length / 4);

export interface WindowOpts {
  min: number;
  max: number;
}

export function selectWindow(events: Event[], opts: WindowOpts = { min: 6000, max: 12000 }): Event[] {
  const total = events.reduce((s, e) => s + estTokens(e), 0);
  if (total <= opts.max) return events;

  // Token-based cut: drop oldest events in (max-min) chunks until under max (monotonic cutoff).
  const chunk = Math.max(1, opts.max - opts.min);
  let i = 0;
  let running = total;
  while (running > opts.max && i < events.length) {
    let removed = 0;
    while (removed < chunk && i < events.length) {
      const t = estTokens(events[i]);
      removed += t;
      running -= t;
      i++;
    }
  }

  // Turn-aware snap: a valid provider conversation must OPEN ON A USER EVENT — never a bare
  // tool_result whose assistant turn was trimmed, never assistant-first, never empty (all of
  // which 400 the API). Snap the cut to the nearest user boundary at/after i; else fall back to
  // the last user boundary before i (keep at least the most recent turn).
  let start = events.findIndex((e, idx) => idx >= i && e.kind === "user");
  if (start === -1) {
    for (let j = Math.min(i, events.length) - 1; j >= 0; j--) {
      if (events[j].kind === "user") {
        start = j;
        break;
      }
    }
  }
  if (start === -1) start = 0; // no user events at all — return the whole (small) log
  return events.slice(start);
}
