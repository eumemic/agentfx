// sweep.ts — derive "what to do next" purely from the event log. No status column, no shared
// mutable state: the `reacting_to` watermark stamped on each assistant event is the only
// coordination primitive (mirrors aios). A user/tool event with seq > the watermark is
// "unreacted" → the model hasn't seen it → a step is needed. This is what makes mid-turn
// message injection free and step re-runs (after a crash/redelivery) idempotent.

import type { Event, ToolCall } from "./events";

/** Highest seq any assistant turn has already reacted to. */
export function maxReacting(events: Event[]): number {
  let m = 0;
  for (const e of events) if (e.kind === "assistant") m = Math.max(m, e.reacting_to ?? e.seq);
  return m;
}

/** Is there an unreacted stimulus (user/tool_result with seq beyond the watermark)? */
export function needsInference(events: Event[]): boolean {
  const mr = maxReacting(events);
  return events.some((e) => e.kind !== "assistant" && e.seq > mr);
}

/** Max stimulus seq visible in this (windowed) slice — stamped onto the assistant we produce. */
export function reactingTo(windowed: Event[]): number {
  let m = 0;
  for (const e of windowed) if (e.kind !== "assistant") m = Math.max(m, e.seq);
  return m;
}

/** Tool calls (from any assistant turn) that have no matching tool_result yet. */
export function unresolvedToolCalls(events: Event[]): ToolCall[] {
  const resolved = new Set<string>();
  for (const e of events) if (e.kind === "tool_result") resolved.add(e.toolCallId);
  const out: ToolCall[] = [];
  for (const e of events) if (e.kind === "assistant") for (const tc of e.toolCalls) if (!resolved.has(tc.id)) out.push(tc);
  return out;
}

/** The tool_result event IS the idempotency record — its existence means the tool completed. */
export function hasToolResult(events: Event[], toolCallId: string): boolean {
  return events.some((e) => e.kind === "tool_result" && e.toolCallId === toolCallId);
}
