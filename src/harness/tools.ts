// tools.ts — async tool dispatch. A tool runs as a durable queue job (TOOL_TOPIC); the handler
// runs the tool, appends a tool_result event, and re-wakes the session. Two dedup layers make
// this at-least-once-safe (mirrors aios):
//   • the tool_result event IS the idempotency record (existence ⇒ done — survives crashes),
//   • an in-process in-flight set prevents same-worker double-runs (a step re-dispatching an
//     already-in-flight sibling tool).
// On crash mid-tool the job is unacked → redelivered → re-run (at-least-once; non-idempotent
// real tools dedupe at their provider via a key). The step never blocks on a tool.

import type { Event, ToolCall } from "./events";
import { appendEvent, readLog } from "./log";
import { TOOL_TOPIC, WAKE_TOPIC, pub } from "./iii";
import { hasToolResult } from "./sweep";

/** A tool impl receives the input and a ctx whose idempotencyKey IS the toolCallId — a real
 *  (non-idempotent) tool can hand it to its provider to dedupe under at-least-once redelivery. */
export type ToolImpl = (input: unknown, ctx: { idempotencyKey: string }) => Promise<string>;

// Per-worker sets, both lost on crash (correctly — a dead worker runs nothing, so a fresh worker
// re-dispatches & re-runs). `published` dedupes the publish decision (so a re-wake in the
// publish→handler gap can't enqueue a duplicate job); `executing` dedupes concurrent execution.
const published = new Set<string>();
const executing = new Set<string>();

/** Publish a tool job unless it's already resolved or already published by this worker. */
export async function dispatchTool(sessionId: string, tc: ToolCall, events: Event[]): Promise<void> {
  if (hasToolResult(events, tc.id)) return; // already done (durable record)
  if (published.has(tc.id)) return; // this worker already enqueued it
  published.add(tc.id); // reserve BEFORE publish to close the publish→handler-start gap
  await pub(TOOL_TOPIC, { sessionId, toolCallId: tc.id, name: tc.name, input: tc.input });
}

export interface ToolHandlerDeps {
  impls: Record<string, ToolImpl>;
  log: (m: string) => void;
}

export async function handleToolJob(
  payload: { sessionId: string; toolCallId: string; name: string; input: unknown },
  deps: ToolHandlerDeps,
): Promise<void> {
  const { sessionId, toolCallId, name, input } = payload;

  if (hasToolResult(await readLog(sessionId), toolCallId)) {
    await pub(WAKE_TOPIC, { sessionId }); // already done (crash after append, before ack) — just re-wake
    return;
  }
  if (executing.has(toolCallId)) return; // a concurrent delivery in this worker owns it
  executing.add(toolCallId); // sync check+add (no await between) ⇒ serializes concurrent runs

  try {
    const impl = deps.impls[name];
    let result: string;
    let isError = false;
    if (!impl) {
      result = `error: unknown tool ${name}`;
      isError = true;
    } else {
      try {
        result = await impl(input, { idempotencyKey: toolCallId });
      } catch (err) {
        result = `error: ${String((err as Error)?.message ?? err)}`;
        isError = true;
      }
    }
    // Re-check before appending so a racing redelivery can't double-write the result.
    if (!hasToolResult(await readLog(sessionId), toolCallId)) {
      const seq = await appendEvent(sessionId, { kind: "tool_result", toolCallId, name, result, isError });
      deps.log(`tool: ${name}#${seq} → ${result}${isError ? " (error)" : ""}`);
    }
  } finally {
    executing.delete(toolCallId);
  }
  await pub(WAKE_TOPIC, { sessionId });
}
