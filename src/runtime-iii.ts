// runtime-iii.ts — the iii implementation of the distributing Backend, plus a generic
// executor. This is the production interpreter's "handler": it discharges Remote/Par
// effects onto iii's at-least-once durable queue + atomic state.

import { registerWorker } from "iii-sdk";
import type { Backend } from "./interpret";
import type { TaskDef } from "./effect";

const URL = process.env.III_URL ?? "ws://localhost:49134";
const BATCH_TOPIC = "aionfx.batch";
const BATCH_SCOPE = "aionfx_batch";

type Worker = ReturnType<typeof registerWorker>;
const trig = (w: Worker, fnId: string, payload: unknown): Promise<any> =>
  w.trigger({ function_id: fnId, payload }) as Promise<any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Driver-side Backend: turns Remote/Par into engine calls ───────────────
export function makeIIIBackend(): Backend & { close: () => void } {
  const w = registerWorker(URL, { workerName: "aionfx-driver" });

  return {
    async callRemote(fnId, args) {
      return trig(w, fnId, args);
    },

    async parRemote(jobs) {
      const batchId = crypto.randomUUID();
      await trig(w, "state::delete", { scope: BATCH_SCOPE, key: batchId });

      // fan-out: each job is a durable message (the queue caps concurrency, survives crashes)
      for (let idx = 0; idx < jobs.length; idx++) {
        const j = jobs[idx];
        await trig(w, "iii::durable::publish", {
          topic: BATCH_TOPIC,
          data: { batchId, idx, fnId: j.fnId, args: j.args, key: j.key },
        });
      }

      // join: poll until every result slot is filled
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const st = (await trig(w, "state::get", { scope: BATCH_SCOPE, key: batchId })) ?? {};
        const results: Record<string, unknown> = st.results ?? {};
        if (Object.keys(results).length >= jobs.length) {
          return jobs.map((_, i) => results[String(i)]);
        }
        await sleep(250);
      }
      throw new Error(`parRemote batch ${batchId} timed out`);
    },

    close() {
      // best-effort; iii-sdk holds a WS open
    },
  };
}

// ── Executor-side: register tasks + a generic batch subscriber ─────────────
export interface ExecutorOptions {
  concurrency?: number;
  onEvent?: (msg: string) => void;
}

/** Register every task (so callRemote can reach it directly) and one durable:subscriber
 *  that routes batch jobs to the right task impl by fnId. Long-lived; survives crashes. */
export function startExecutor(tasks: ReadonlyArray<TaskDef<any, any>>, opts: ExecutorOptions = {}): void {
  const concurrency = opts.concurrency ?? 3;
  const log = opts.onEvent ?? ((m: string) => console.log(m));
  const w = registerWorker(URL, { workerName: "aionfx-executor" });

  const impls = new Map<string, (args: unknown) => Promise<unknown>>();
  for (const t of tasks) {
    impls.set(t.fnId, t.impl as (args: unknown) => Promise<unknown>);
    // direct callable (for standalone Remote / callRemote)
    w.registerFunction(t.fnId, ((payload: unknown) => t.impl(payload)) as unknown as (
      p: unknown,
    ) => Promise<unknown>);
  }

  // one generic subscriber drains the batch queue, routing by fnId
  w.registerFunction(
    "aionfx::exec",
    (async (job: { batchId: string; idx: number; fnId: string; args: unknown }) => {
      const impl = impls.get(job.fnId);
      if (!impl) throw new Error(`no task registered for fnId=${job.fnId}`);
      log(`[exec] ▶ ${job.fnId}[${job.idx}]`);
      const result = await impl(job.args);
      await trig(w, "state::update", {
        scope: BATCH_SCOPE,
        key: job.batchId,
        ops: [{ type: "merge", path: "results", value: { [String(job.idx)]: result } }],
      });
      log(`[exec] ✔ ${job.fnId}[${job.idx}]`);
      return null;
    }) as unknown as (p: unknown) => Promise<unknown>,
  );

  w.registerTrigger({
    type: "durable:subscriber",
    function_id: "aionfx::exec",
    config: { topic: BATCH_TOPIC, queue_config: { concurrency } },
  } as unknown as Parameters<typeof w.registerTrigger>[0]);

  log(`executor ready — ${tasks.length} task(s), durable:subscriber on ${BATCH_TOPIC}, concurrency=${concurrency}`);
}
