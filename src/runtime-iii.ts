// runtime-iii.ts — the iii implementation of the distributing Backend, plus a generic
// executor. Discharges Remote/Par onto iii's at-least-once durable queue + atomic state.

import { registerWorker } from "iii-sdk";
import type { Backend } from "./interpret";
import type { TaskDef } from "./effect";
import { sleep, trigger } from "./util";

const URL = process.env.III_URL ?? "ws://localhost:49134";
// Single namespace — all worker names, the batch topic, the state scope, and the executor
// fn id derive from it. (These strings are a shared-engine wire contract; own your NS.)
const NS = "agentfx";
const BATCH_TOPIC = `${NS}.batch`;
const SCOPE = `${NS}_batch`;
const EXEC_FN = `${NS}::exec`;

type Worker = ReturnType<typeof registerWorker>;

interface BatchState {
  results?: Record<string, unknown>;
  errors?: Record<string, string>;
  done?: Record<string, "ok" | "err">;
}

const getBatch = async (w: Worker, batchId: string): Promise<BatchState> =>
  (await trigger(w, "state::get", { scope: SCOPE, key: batchId })) ?? {};

// ── Driver-side Backend ───────────────────────────────────────────────────
export function makeIIIBackend(): Backend & { close: () => void } {
  const w = registerWorker(URL, { workerName: `${NS}-driver` });

  return {
    async callRemote(fnId, args) {
      return trigger(w, fnId, args);
    },

    // Wave-based fan-out: at most `concurrency` jobs in flight, so runDist honors the Par's
    // concurrency the same way runMemory's pool does. Surfaces failures (no silent 60s hang).
    async parRemote(jobs, concurrency) {
      const batchId = crypto.randomUUID();
      await trigger(w, "state::delete", { scope: SCOPE, key: batchId });
      const conc = Math.max(1, concurrency);
      let st: BatchState = {};

      for (let start = 0; start < jobs.length; start += conc) {
        const chunk = jobs.slice(start, start + conc);
        await Promise.all(
          chunk.map((j, k) =>
            trigger(w, "iii::durable::publish", {
              topic: BATCH_TOPIC,
              data: { batchId, idx: start + k, fnId: j.fnId, args: j.args, key: j.key },
            }),
          ),
        );
        const wantIdx = chunk.map((_, k) => String(start + k));
        const deadline = Date.now() + 60_000;
        for (;;) {
          st = await getBatch(w, batchId);
          const done = st.done ?? {};
          if (wantIdx.every((i) => done[i] !== undefined)) break;
          if (Date.now() > deadline) throw new Error(`parRemote ${batchId} timed out at chunk @${start}`);
          await sleep(200);
        }
      }

      // `st` holds the final poll's snapshot (state is cumulative) — no extra round-trip.
      const done = st.done ?? {};
      const errors = st.errors ?? {};
      const results = st.results ?? {};
      const failedIdx = Object.keys(done).filter((i) => done[i] === "err");
      if (failedIdx.length > 0) {
        throw new Error(`parRemote: ${failedIdx.length} task(s) failed: ${JSON.stringify(failedIdx.map((i) => errors[i]))}`);
      }
      return jobs.map((_, i) => results[String(i)] ?? null);
    },

    close() {
      /* iii-sdk holds a WS open; best-effort no-op */
    },
  };
}

// ── Executor-side ──────────────────────────────────────────────────────────
export interface ExecutorOptions {
  concurrency?: number;
  onEvent?: (msg: string) => void;
}

/** Register every task (so callRemote can reach it) + one durable:subscriber that routes
 *  batch jobs to task impls by fnId. Long-lived; survives crashes (at-least-once redelivery). */
export function startExecutor(tasks: ReadonlyArray<TaskDef<any, any, any>>, opts: ExecutorOptions = {}): void {
  const concurrency = opts.concurrency ?? 8; // governs queue parallelism; driver waves throttle below this
  const log = opts.onEvent ?? ((m: string) => console.log(m));
  const w = registerWorker(URL, { workerName: `${NS}-executor` });

  const impls = new Map(tasks.map((t) => [t.fnId, t.impl] as const));
  for (const t of tasks) {
    w.registerFunction(
      t.fnId,
      ((payload: unknown) => t.impl(payload, { idempotencyKey: t.keyOf(payload as any) })) as unknown as (
        p: unknown,
      ) => Promise<unknown>,
      // publish the schema (request_format/response_format) when the task carries one
      {
        description: `agentfx task ${t.fnId}`,
        request_format: t.requestFormat,
        response_format: t.responseFormat,
      } as unknown as Parameters<typeof w.registerFunction>[2],
    );
  }

  w.registerFunction(
    EXEC_FN,
    (async (job: { batchId: string; idx: number; fnId: string; args: unknown; key: string }) => {
      const { batchId, idx, fnId, args, key } = job;
      const impl = impls.get(fnId);
      if (!impl) throw new Error(`no task registered for fnId=${fnId}`);

      // idempotent: skip a job whose slot already finished (redelivery of a completed job). A
      // job that crashed mid-flight left no `done` marker, so it re-runs — at-least-once recovery.
      const cur = await getBatch(w, batchId);
      if ((cur.done ?? {})[String(idx)] !== undefined) {
        log(`[exec] ↩ ${fnId}[${idx}] already done — skip`);
        return null;
      }

      try {
        const result = await impl(args, { idempotencyKey: key });
        await trigger(w, "state::update", {
          scope: SCOPE,
          key: batchId,
          ops: [
            { type: "merge", path: "results", value: { [String(idx)]: result === undefined ? null : result } },
            { type: "merge", path: "done", value: { [String(idx)]: "ok" } },
          ],
        });
        log(`[exec] ✔ ${fnId}[${idx}]`);
      } catch (err) {
        await trigger(w, "state::update", {
          scope: SCOPE,
          key: batchId,
          ops: [
            { type: "merge", path: "errors", value: { [String(idx)]: String((err as Error)?.message ?? err) } },
            { type: "merge", path: "done", value: { [String(idx)]: "err" } },
          ],
        });
        log(`[exec] ✗ ${fnId}[${idx}] failed: ${(err as Error)?.message ?? err}`);
      }
      return null;
    }) as unknown as (p: unknown) => Promise<unknown>,
  );

  w.registerTrigger({
    type: "durable:subscriber",
    function_id: EXEC_FN,
    config: { topic: BATCH_TOPIC, queue_config: { concurrency } },
  } as unknown as Parameters<typeof w.registerTrigger>[0]);

  log(`executor ready — ${tasks.length} task(s), durable:subscriber on ${BATCH_TOPIC}, concurrency=${concurrency}`);
}
