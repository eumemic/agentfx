// worker.ts — the killable process body. Registers two durable subscribers on the iii queue:
//   • WAKE_TOPIC → run a step   (concurrency 1: serialize steps; coarse stand-in for aios's
//                                per-session lock — fine for the single-session demo)
//   • TOOL_TOPIC → run a tool   (concurrency 4: tools fan out in parallel)
// Crash this process and the engine redelivers any unacked wake/tool message to the next worker,
// which resumes from the file-backed log. That is the whole point.

import { TOOL_TOPIC, WAKE_TOPIC, getW } from "./iii";
import type { Model, ToolSpec } from "./model";
import { type StepDeps, runStep } from "./step";
import { type ToolImpl, handleToolJob } from "./tools";

const STEP_FN = "agentfx::harness::step";
const TOOL_FN = "agentfx::harness::tool";

export interface HarnessWorkerOpts {
  model: Model;
  tools: ToolSpec[];
  toolImpls: Record<string, ToolImpl>;
  system?: string;
  onEvent?: (m: string) => void;
}

export function startHarnessWorker(opts: HarnessWorkerOpts): void {
  const w = getW();
  const log = opts.onEvent ?? ((m: string) => console.log(m));
  const stepDeps: StepDeps = { model: opts.model, tools: opts.tools, system: opts.system, log };

  w.registerFunction(
    STEP_FN,
    (async (payload: { sessionId: string }) => {
      await runStep(payload.sessionId, stepDeps);
      return null;
    }) as unknown as (p: unknown) => Promise<unknown>,
  );

  w.registerFunction(
    TOOL_FN,
    (async (payload: { sessionId: string; toolCallId: string; name: string; input: unknown }) => {
      await handleToolJob(payload, { impls: opts.toolImpls, log });
      return null;
    }) as unknown as (p: unknown) => Promise<unknown>,
  );

  w.registerTrigger({
    type: "durable:subscriber",
    function_id: STEP_FN,
    config: { topic: WAKE_TOPIC, queue_config: { concurrency: 1 } },
  } as unknown as Parameters<typeof w.registerTrigger>[0]);

  w.registerTrigger({
    type: "durable:subscriber",
    function_id: TOOL_FN,
    config: { topic: TOOL_TOPIC, queue_config: { concurrency: 4 } },
  } as unknown as Parameters<typeof w.registerTrigger>[0]);

  log(`harness worker ready — step←${WAKE_TOPIC} (c=1), tool←${TOOL_TOPIC} (c=4)`);
}
