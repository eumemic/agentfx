// step.ts — ONE step of the agent. There is no loop here: this function is re-entered by the
// durable wake queue. A step (1) gates on the log, (2) either re-dispatches unresolved tools or
// calls the model once, (3) appends the assistant turn, (4) fires its tool calls fire-and-forget,
// and returns. The "loop" is wake → step → dispatch → tool → re-wake → step → … The model is
// never called with a half-finished tool batch, and every branch is idempotent under redelivery.

import { appendEvent, readLog } from "./log";
import { ATTEMPT_SCOPE, stUpdate } from "./iii";
import type { Model, ModelTurn, ToolSpec } from "./model";
import { needsInference, reactingTo, unresolvedToolCalls } from "./sweep";
import { dispatchTool } from "./tools";
import { selectWindow } from "./window";
import { sleep } from "../util";

export interface StepDeps {
  model: Model;
  tools: ToolSpec[];
  system?: string;
  log: (m: string) => void;
}

const MAX_MODEL_RETRIES = 3;

/** Durable, per-stimulus retry counter so transient model errors retry a bounded number of
 *  times (via wake redelivery) before the step records a durable error event and gives up. */
async function bumpAttempt(sessionId: string, reacting: number): Promise<number> {
  const r = await stUpdate(ATTEMPT_SCOPE, sessionId, [{ type: "increment", path: `s${reacting}`, by: 1 }]);
  return (r?.new_value?.[`s${reacting}`] as number) ?? 1;
}

export async function runStep(sessionId: string, deps: StepDeps): Promise<void> {
  const events = await readLog(sessionId);

  // (a) Outstanding tool calls? Make sure they're dispatched, then wait — do NOT infer on a
  //     half-finished batch. This also recovers a crash between assistant-append and dispatch.
  const unresolved = unresolvedToolCalls(events);
  if (unresolved.length > 0) {
    deps.log(`step: ${unresolved.length} unresolved tool(s) — (re)dispatch & wait`);
    for (const tc of unresolved) await dispatchTool(sessionId, tc, events);
    return;
  }

  // (b) Idempotent gate: only call the model if there's an unreacted stimulus.
  if (!needsInference(events)) {
    deps.log("step: idle (nothing unreacted)");
    return;
  }

  // (c) One inference over the windowed log. Stamp the watermark over the FULL log so it always
  //     advances past every current stimulus (no spin even if windowing trimmed an older one).
  //     Model errors get bounded retries (via redelivery), then a durable error event — so a
  //     4xx/5xx never becomes a silent infinite redelivery loop.
  const windowed = selectWindow(events);
  const reacting = reactingTo(events);
  let turn: ModelTurn;
  try {
    turn = await deps.model.step({ events: windowed, tools: deps.tools, system: deps.system });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    const attempts = await bumpAttempt(sessionId, reacting);
    if (attempts <= MAX_MODEL_RETRIES) {
      deps.log(`step: model error (attempt ${attempts}/${MAX_MODEL_RETRIES}) — retry via redelivery: ${msg}`);
      await sleep(400 * attempts);
      throw err; // unacked ⇒ the engine redelivers the wake ⇒ retry
    }
    deps.log(`step: model error — gave up after ${attempts}, recording durable error event: ${msg}`);
    await appendEvent(sessionId, { kind: "assistant", text: `[error: model call failed: ${msg}]`, toolCalls: [], reacting_to: reacting });
    return;
  }
  const seq = await appendEvent(sessionId, {
    kind: "assistant",
    text: turn.text,
    toolCalls: turn.toolCalls,
    reacting_to: reacting,
    raw: turn.raw,
  });
  const toolNames = turn.toolCalls.map((t) => t.name).join(", ");
  deps.log(`step: assistant#${seq} react=${reacting} tools=[${toolNames}]${turn.text ? ` "${turn.text.slice(0, 60)}"` : ""}`);

  // (d) Dispatch tools fire-and-forget (return without awaiting). No tools ⇒ turn is complete.
  if (turn.toolCalls.length === 0) {
    deps.log("step: turn complete");
    return;
  }
  const after = await readLog(sessionId);
  for (const tc of turn.toolCalls) await dispatchTool(sessionId, tc, after);
}
