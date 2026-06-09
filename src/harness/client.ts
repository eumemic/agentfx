// client.ts — the driver-side surface (the analog of aios's POST /messages → defer_wake):
// append a user event to the log, then publish a wake. The worker (any worker) picks it up.

import { WAKE_TOPIC, pub } from "./iii";
import { appendEvent, readLog, resetSession } from "./log";

/** Append a user message and wake the session. */
export async function sendUserMessage(sessionId: string, text: string): Promise<void> {
  await appendEvent(sessionId, { kind: "user", text });
  await pub(WAKE_TOPIC, { sessionId });
}

export { readLog, resetSession };
